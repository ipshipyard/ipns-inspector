import { createHeliaHTTP, Helia } from '@helia/http'
import { ipns as ipnsConstructor } from '@helia/ipns'
import { type IPNSResolveResult, type IPNS } from '@helia/ipns'
import { type IPNSRecordV1V2, type IPNSRecordV2 } from 'ipns'
import { setup, fromPromise, assign } from 'xstate'
import { getPeerIdFromString } from './peer-id'
// import { createIPNSRecord } from 'ipns'
// import { generateKeyPair } from '@libp2p/crypto/keys'

export const DEFAULT_TTL = 24 * 60 * 60 // 24 hours in seconds

export type Mode = 'inspect' | 'create'

export type Events =
  | { type: 'INSPECT_NAME' }
  | { type: 'UPDATE_MODE'; value: Mode }
  | { type: 'UPDATE_FORM'; field: string; value: string }
  | { type: 'UPDATE_NAME_TO_INSPECT'; value: string }

export interface Context {
  error: string | null
  nameValidationError: string | null
  nameInspecting: string
  nameToInspect: string
  record?: IPNSRecordV1V2 | IPNSRecordV2
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
      value: '',
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
    UPDATE_NAME_TO_INSPECT: {
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
          actions: assign({
            ipns: ({ event }) => event.output.ipns,
            heliaInstance: ({ event }) => event.output.helia,
          }),
          target: 'inspect',
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
      },
    },
    // creating: {
    //   entry: assign({ error: null }),
    //   invoke: {
    //     src: async (context) => {
    //       const validationErrors = validateRecord(context.formData)
    //       if (validationErrors.length > 0) {
    //         throw new Error(validationErrors.join(', '))
    //       }
    //       const newRecord = await context.heliaInstance.publish(context.formData.value, {
    //         ttl: context.formData.ttl,
    //         validity: context.formData.validity,
    //         sequence: context.formData.sequence,
    //       })
    //       return newRecord
    //     },
    //     onDone: {
    //       target: 'idle',
    //       actions: assign({
    //         record: (_, event) => event.data,
    //         error: null,
    //       }),
    //     },
    //     onError: {
    //       target: 'idle',
    //       actions: assign({
    //         error: (_, event) => event.data.message,
    //       }),
    //     },
    //   },
    // },
  },
})
