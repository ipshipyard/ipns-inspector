import { createHeliaHTTP, Helia } from '@helia/http'
import { ipns as ipnsConstructor } from '@helia/ipns'
import { type IPNSResolveResult, type IPNS } from '@helia/ipns'
import { CID } from 'multiformats/cid'
import { type IPNSRecord } from 'ipns'
import { setup, fromPromise, assign } from 'xstate'
import { getIPNSNameFromKeypair, getPeerIdFromString } from './peer-id'
// import { createIPNSRecord } from 'ipns'
import { generateKeyPair } from '@libp2p/crypto/keys'
import type { PeerId, Ed25519PrivateKey } from '@libp2p/interface'
import 'core-js/modules/esnext.uint8-array.to-base64'

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

export interface Context {
  error: string | Error | null // general error
  nameValidationError: boolean // name validation error
  nameInput: string // name input field
  name: string // The IPNS name either inspecting (either fetched or created)
  record?: IPNSRecord // the record fetched or created
  keypair?: Ed25519PrivateKey // the keypair used to create the record
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
          peerId = getPeerIdFromString(name)
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
              getPeerIdFromString(event.value)
              return false
            } catch (error) {
              console.error(error)
              return true
            }
          },
        }),
      ],
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
            record: undefined,
          }),
          target: 'create',
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
          target: 'inspect',
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
    }
  },
})
