import { createHeliaHTTP, Helia } from '@helia/http'
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string'
import { ipns as ipnsConstructor } from '@helia/ipns'
import { type IPNSResolveResult, type IPNS } from '@helia/ipns'
import { CID } from 'multiformats/cid'
import { type IPNSRecord } from 'ipns'
import { setup, fromPromise, assign } from 'xstate'
import { getIPNSNameFromKeypair } from './peer-id'
import { unmarshalIPNSRecord } from 'ipns'
import { ipnsValidator, validate } from 'ipns/validator'
import { generateKeyPair, privateKeyFromProtobuf, publicKeyFromRaw } from '@libp2p/crypto/keys'
import { peerIdFromString } from '@libp2p/peer-id'
import type { PeerId, Ed25519PrivateKey } from '@libp2p/interface'
import 'core-js/modules/esnext.uint8-array.to-base64'
import { base36 } from 'multiformats/bases/base36'
export const DEFAULT_LIFETIME_MS = 24 * 60 * 60 * 1000 // 24 hours in seconds

export type Mode = 'inspect' | 'create'

export type Events =
  | { type: 'INSPECT_NAME' }
  | { type: 'UPDATE_MODE'; value: Mode }
  | { type: 'UPDATE_FORM'; field: string; value: string }
  | { type: 'UPDATE_NAME'; value: string; validate?: boolean }
  | { type: 'GENERATE_NEW_KEY' }
  | { type: 'CREATE_RECORD' }
  | { type: 'PUBLISH_RECORD' }
  | { type: 'IMPORT_RECORD'; file?: File }
  | { type: 'IMPORT_PRIVATE_KEY'; value: string }
  | { type: 'UPDATE_PRIVATE_KEY_INPUT'; value: string }
  | { type: 'OPEN_IMPORT_DIALOG' }
  | { type: 'CLOSE_IMPORT_DIALOG' }

export interface Context {
  error: string | Error | null // general error
  nameValidationError: boolean // name validation error
  nameInput: string // name input field
  name: string // The IPNS name either inspecting (either fetched or created)
  record?: IPNSRecord // the record fetched or created
  keypair?: Ed25519PrivateKey // the keypair used to create the record
  privateKeyInput: string // private key input field
  privateKeyError: string | null // private key input error
  importDialogOpen: boolean // whether the import dialog is open
  formData: {
    value: string // the value field for the IPNS record to publish
    lifetime: number // the lifetime field for the IPNS record to publish
    ttlMs: number // Add TTL field
  }
  fetchingRecord: boolean
  publishingRecord: boolean
  publishSuccess: boolean
  heliaInstance?: Helia
  ipns?: IPNS
}

export const ipnsMachine = setup({
  types: {
    context: {} as Context,
    events: {} as Events,
  },
  actors: {
    initHelia: fromPromise(async () => {
      const helia = await createHeliaHTTP()
      const ipns = ipnsConstructor(helia)
      return { helia, ipns }
    }),
    generateKey: fromPromise(async () => {
      const keypair = await generateKeyPair('Ed25519')
      return { keypair }
    }),
    fetchRecord: fromPromise<IPNSResolveResult, { name: string; ipns: IPNS }>(
      async ({ input: { name, ipns } }) => {
        let peerId: PeerId
        try {
          peerId = peerIdFromString(name)
        } catch (error) {
          console.error(error)
          throw new Error('Invalid IPNS name')
        }

        return ipns.resolve(peerId.publicKey || peerId.toMultihash(), { nocache: true })
      },
    ),
    createRecord: fromPromise<
      IPNSRecord,
      { keypair: Ed25519PrivateKey; formData: Context['formData']; ipns: IPNS; publish: boolean }
    >(async ({ input: { keypair, formData, ipns, publish } }) => {
      const cid = CID.parse(formData.value)

      return ipns.publish(keypair, cid, {
        lifetime: formData.lifetime,
        offline: !publish,
        ttl: formData.ttlMs,
      })
    }),
    importRecord: fromPromise<{ record: IPNSRecord; name: string }, { file?: File }>(
      async ({ input: { file } }) => {
        if (!file) {
          throw new Error('No file provided')
        }
        let ipnsName = file.name.split('.')[0]
        const buffer = await file.arrayBuffer()
        const record = unmarshalIPNSRecord(new Uint8Array(buffer))
        if (record.pubKey) {
          // if the pubkey is embedded, we should infer the IPNS name from the pubkey
          await ipnsValidator(record.pubKey, record.data)
          const pubKey = publicKeyFromRaw(record.pubKey)
          ipnsName = pubKey.toCID().toString(base36)
        } else {
          try {
            const pubKey = peerIdFromString(ipnsName).publicKey
            if (!pubKey) {
              throw new Error(`Couldn't infer IPNS name from file: ${file.name}`)
            }
            await validate(pubKey, new Uint8Array(buffer))
          } catch (error) {
            if (error instanceof Error && error.message.includes('Non-base36')) {
              throw new Error(`Couldn't infer IPNS name from file: ${file.name}`)
            }
            throw error
          }
        }
        return { record, name: ipnsName }
      },
    ),
    republishRecord: fromPromise<void, Partial<{ record: IPNSRecord; name: string; ipns: IPNS }>>(
      async ({ input: { record, name, ipns } }) => {
        if (!record || !name || !ipns) {
          throw new Error('Missing required parameters')
        }
        return ipns.republishRecord(name, record)
      },
    ),
    importPrivateKey: fromPromise<{ keypair: Ed25519PrivateKey }, { value: string }>(
      async ({ input: { value } }) => {
        try {
          const keypair = privateKeyFromProtobuf(uint8ArrayFromString(value, 'base64'))
          if (keypair.type !== 'Ed25519') {
            throw new Error('Only libp2p Ed25519 keys are supported')
          }
          return { keypair };
        } catch (error) {
          throw new Error('Invalid private key');
        }
      },
    ),
  },
}).createMachine({
  id: 'ipns-inspector',
  initial: 'init',
  context: {
    name: '',
    nameInput: '',
    error: null,
    nameValidationError: false,
    fetchingRecord: false,
    publishingRecord: false,
    publishSuccess: false,
    privateKeyInput: '',
    privateKeyError: null,
    importDialogOpen: false,
    formData: {
      value: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      lifetime: DEFAULT_LIFETIME_MS,
      ttlMs: 60 * 1000, // Default TTL of 60 seconds in milliseconds
    },
  },
  on: {
    UPDATE_FORM: {
      actions: assign({
        formData: ({ context, event }) => ({
          ...context.formData,
          [event.field]: event.field === 'value' ? event.value : Number(event.value),
        }),
      }),
    },
    UPDATE_NAME: {
      actions: [
        assign({
          nameInput: ({ event }) => event.value,
          nameValidationError: ({ event }) => {
            if (!event.validate) {
              return false
            }
            try {
              peerIdFromString(event.value)
              return false
            } catch (error) {
              console.error(error)
              return true
            }
          },
        }),
      ],
    },
    UPDATE_PRIVATE_KEY_INPUT: {
      actions: assign({
        privateKeyInput: ({ event }) => event.value,
        privateKeyError: null,
      }),
    },
    OPEN_IMPORT_DIALOG: {
      actions: assign({
        importDialogOpen: true,
        privateKeyError: null,
      }),
    },
    CLOSE_IMPORT_DIALOG: {
      actions: assign({
        importDialogOpen: false,
      }),
    },
  },
  states: {
    init: {
      invoke: [
        {
          src: 'initHelia',
          onDone: {
            target: 'inspect',
            actions: assign({
              ipns: ({ event }) => event.output.ipns,
              heliaInstance: ({ event }) => event.output.helia,
            }),
          },
          onError: {
            target: 'inspect',
            actions: assign({
              error: ({ event }) => event.error as string,
            }),
          },
        },
      ],
    },
    inspect: {
      on: {
        INSPECT_NAME: {
          target: 'verifyAndFetch',
        },
        UPDATE_MODE: {
          actions: assign({
            nameInput: '',
            nameValidationError: false,
            // 👇 Only clear the record on transition change if the inspected record was not created by the current keypair
            record: ({ context }) => context.name === getIPNSNameFromKeypair(context.keypair) ? context.record : undefined,
          }),
          target: 'create',
        },
        IMPORT_RECORD: {
          actions: assign({
            nameInput: '',
            nameValidationError: false,
            record: undefined,
            publishSuccess: false
          }),
          target: 'importingRecord',
        },
        PUBLISH_RECORD: {
          target: 'republishingRecord',
          guard: ({ context }: { context: Context }) => !!context.record,
        },
      },
    },
    verifyAndFetch: {
      entry: assign({
        error: null,
        fetchingRecord: true,
      }),
      exit: assign({
        fetchingRecord: false,
      }),
      invoke: {
        src: 'fetchRecord',
        input: ({ context }) => ({ name: context.nameInput, ipns: context.ipns! }),
        onDone: {
          actions: assign({
            record: ({ event }) => event.output.record,
            name: ({ context }) => context.nameInput,
          }),
          target: 'inspect',
        },
        onError: {
          actions: assign({
            fetchingRecord: false,
            error: ({ event }) => event.error as string,
          }),
          target: 'inspect',
        },
      },
    },
    create: {
      entry: assign({
        nameValidationError: false,
        publishSuccess: false,
      }),
      on: {
        CREATE_RECORD: {
          target: 'creatingRecord',
        },
        PUBLISH_RECORD: {
          // creating state will also publish based on the event.type
          target: 'publishingRecord',
        },
        UPDATE_MODE: {
          target: 'inspect',
        },
        GENERATE_NEW_KEY: {
          actions: assign({
            keypair: undefined,
            record: undefined,
          }),
          target: 'generatingKey',
        },
        IMPORT_PRIVATE_KEY: [
          {
            target: 'create',
            guard: ({ context }: { context: Context }) => !context.privateKeyInput.trim(),
            actions: assign({
              privateKeyError: 'Private key cannot be empty',
            }),
          },
          {
            target: 'importingPrivateKey',
            actions: assign({
              privateKeyError: null,
            }),
          },
        ],
      },
    },
    generatingKey: {
      invoke: {
        src: 'generateKey',
        onDone: {
          target: 'create',
          actions: assign({
            keypair: ({ event }) => event.output.keypair,
          }),
        },
        onError: {
          target: 'create',
          actions: assign({
            error: ({ event }) => event.error as string,
          }),
        },
      },
    },
    creatingRecord: {
      invoke: {
        src: 'createRecord',
        input: ({ context }) => ({
          keypair: context.keypair!,
          formData: context.formData!,
          ipns: context.ipns!,
          publish: false,
        }),
        onDone: {
          target: 'create',
          actions: assign({
            record: ({ event }) => event.output,
            // update the name from the keypair since it's not contained in the record
            name: ({ context }) => getIPNSNameFromKeypair(context.keypair),
            error: null,
            publishSuccess: false,
          }),
        },
        onError: {
          target: 'create',
          actions: assign({
            error: ({ event }) => event.error as string,
            record: undefined, // clear the record to avoid a
          }),
        },
      },
    },
    publishingRecord: {
      entry: assign({
        publishingRecord: true,
      }),
      exit: assign({
        publishingRecord: false,
      }),
      invoke: {
        src: 'createRecord',
        input: ({ context }) => ({
          keypair: context.keypair!,
          formData: context.formData!,
          ipns: context.ipns!,
          publish: true,
        }),
        onDone: {
          target: 'create',
          actions: assign({
            record: ({ event }) => event.output,
            publishSuccess: true,
            error: null,
          }),
        },
        onError: {
          target: 'create',
          actions: assign({
            error: ({ event }) => event.error as Error,
            publishSuccess: false,
          }),
        },
      },
    },
    importingRecord: {
      invoke: {
        src: 'importRecord',
        input: ({ event }) => ({
          file: (event as Extract<Events, { type: 'IMPORT_RECORD' }>).file,
        }),
        onDone: {
          target: 'inspect',
          actions: assign({
            record: ({ event }) => event.output.record,
            name: ({ event }) => event.output.name,
            error: null,
          }),
        },
        onError: {
          target: 'inspect',
          actions: assign({
            error: ({ event }) => event.error as Error,
            record: undefined,
          }),
        },
      },
    },
    importingPrivateKey: {
      invoke: {
        src: 'importPrivateKey',
        input: ({ context }: { context: Context }) => ({
          value: context.privateKeyInput.trim()
        }),
        onDone: {
          target: 'create',
          actions: assign({
            keypair: ({ event }) => event?.output?.keypair,
            error: null,
            privateKeyInput: '',
            privateKeyError: null,
            importDialogOpen: false,
          }),
        },
        onError: {
          target: 'create',
          actions: assign({
            privateKeyError: 'Invalid private key format',
          }),
        },
      },
    },
    republishingRecord: {
      entry: assign({
        publishingRecord: true,
      }),
      exit: assign({
        publishingRecord: false,
      }),
      invoke: {
        src: 'republishRecord',
        input: ({ context }) => ({
          record: context.record,
          name: context.name,
          ipns: context.ipns,
        }),
        onDone: {
          target: 'inspect',
          actions: assign({
            publishSuccess: true,
            error: null,
          }),
        },
        onError: {
          target: 'inspect',
          actions: assign({
            error: ({ event }) => event.error as Error,
            publishSuccess: false,
          }),
        },
      },
    },
  },
})
