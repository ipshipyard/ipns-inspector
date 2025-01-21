import { createHeliaHTTP, Helia } from '@helia/http'
import { ipns as ipnsConstructor } from '@helia/ipns'
import { type IPNSResolveResult, type IPNS } from '@helia/ipns'
import { type IPNSRecordV1V2, type IPNSRecordV2 } from 'ipns'
import { setup, fromPromise, assign } from 'xstate'
import { getPeerIdFromString } from './peer-id'
// import { createIPNSRecord } from 'ipns'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { Ed25519PrivateKey } from '@libp2p/interface'
import 'core-js/modules/esnext.uint8-array.to-base64'

export const DEFAULT_TTL = 24 * 60 * 60 // 24 hours in seconds

export type Mode = 'inspect' | 'create'

export type Events =
  | { type: 'INSPECT_NAME' }
  | { type: 'UPDATE_MODE'; value: Mode }
  | { type: 'UPDATE_FORM'; field: string; value: string }
  | { type: 'UPDATE_NAME'; value: string }
  | { type: 'GENERATE_NEW_KEY' }

export interface Context {
  error: string | null
  nameValidationError: string | null
  nameInspecting: string
  nameToInspect: string
  record?: IPNSRecordV1V2 | IPNSRecordV2
  keypair?: Ed25519PrivateKey
  formData: {
    value: string
    ttl: number
    validity: number
    sequence: number
  }
  fetchingRecord: boolean
  heliaInstance?: Helia
  ipns?: IPNS
}

// Simplified machine
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
          if (!peerId.publicKey) {
            throw new Error()
          }
        } catch (error) {
          console.error(error)
          throw new Error('Invalid IPNS Name. IPNS names must be base36 encoded CIDs')
        }

        return ipns.resolve(peerId.publicKey, { nocache: true })
      },
    ),
    createRecord: fromPromise<IPNSRecordV1V2 | IPNSRecordV2, { formData: RecordData; ipns: IPNS }>(
      async ({ input: { formData, ipns } }) => {
        return ipns.publish(formData.value, {
          ttl: formData.ttl,
          validity: formData.validity,
          sequence: formData.sequence,
        })
      },
    ),
  },
}).createMachine({
  id: 'ipns-inspector',
  initial: 'init',
  context: {
    nameToInspect: '',
    nameInspecting: '',
    error: null,
    nameValidationError: null,
    fetchingRecord: false,
    formData: {
      value: '/ipfs/bafybeicklkqcnlvtiscr2hzkubjwnwjinvskffn4xorqeduft3wq7vm5u4',
      ttl: DEFAULT_TTL,
      validity: DEFAULT_TTL,
      sequence: 0,
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
          nameToInspect: ({ event }) => event.value,
          nameValidationError: ({ event }) => {
            try {
              const peerId = getPeerIdFromString(event.value)
              if (!peerId.publicKey) {
                return 'Invalid IPNS Name: Missing public key'
              }
              return null
            } catch (_) {
              return 'Invalid IPNS Name. IPNS names must be base36 encoded CIDs'
            }
          }
        }),
      ],
    },
  },
  states: {
    init: {
      invoke: {
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
    },
    inspect: {
      on: {
        INSPECT_NAME: {
          target: 'verifyAndFetch',
        },
        UPDATE_MODE: {
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
        input: ({ context }) => ({ name: context.nameToInspect, ipns: context.ipns! }),
        onDone: {
          actions: assign({
            record: ({ event }) => event.output.record,
            nameInspecting: ({ context }) => context.nameToInspect,
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
        error: null,
        nameInspecting: '',
        record: undefined,
      }),
      on: {
        UPDATE_MODE: {
          target: 'inspect',
        },
        GENERATE_NEW_KEY: {
          actions: assign({
            keypair: undefined,
          }),
          target: 'generatingKey',
        }
      },
      invoke: {
        src: 'generateKey',
        onDone: {
          target: 'create',
          actions: assign({
            keypair: ({ event }) => event.output.keypair,
          }),
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
  },
})
