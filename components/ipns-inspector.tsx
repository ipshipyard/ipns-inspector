import React from 'react'
import { useMachine } from '@xstate/react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { createBrowserInspector } from '@statelyai/inspect'
import { ipnsMachine, Mode } from '../lib/ipns-machine'
import { Spinner } from './ui/spinner'
import { KeyRound, InfoIcon, CheckCircle2 } from 'lucide-react'
import { getIPNSNameFromKeypair } from '@/lib/peer-id'
import { TooltipContent, TooltipProvider, TooltipTrigger } from '@radix-ui/react-tooltip'
import { Tooltip } from '@radix-ui/react-tooltip'

const MAX_VALIDITY = 365 * 24 * 60 * 60 // 1 year in seconds
const DAY_MS = 24 * 60 * 60 * 1000

export const NAME_VALIDATION_ERROR = 'IPNS names must be base36 encoded CIDs or base58 encoded libp2p PeerIDs'

const inspector = createBrowserInspector({
  autoStart: false,
})

interface RecordFieldProps {
  label: string
  value: string
  monospace?: boolean
}

// Simplified component
export default function IPNSInspector() {
  const [state, send] = useMachine(ipnsMachine, {
    inspect: inspector?.inspect,
  })
  const isLoading = state.value === 'init'
  console.log(state.value, state.context)
  const mode =
    state.value === 'create' || state.value === 'creatingRecord' || state.value === 'publishingRecord'
      ? 'create'
      : 'inspect'
  const { error } = state.context

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>IPNS Record Inspector & Creator</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={mode} onValueChange={(value) => send({ type: 'UPDATE_MODE', value: value as Mode })}>
          <TabsList className="mb-4">
            <TabsTrigger value="inspect">Inspect Record</TabsTrigger>
            <TabsTrigger value="create">Create Record</TabsTrigger>
          </TabsList>

          {state.value === 'init' && <div>Loading...</div>}

          <TabsContent value="inspect">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium">IPNS Name</label>
                <div className="flex gap-2">
                  <Input
                    value={state.context.nameInput}
                    onChange={(e) => send({ type: 'UPDATE_NAME', value: e.target.value })}
                    onBlur={(e) => send({ type: 'UPDATE_NAME', validate: true, value: e.target.value })}
                    placeholder="k51... or 12D..."
                  />
                  {
                    <Button
                      onClick={() => send({ type: 'INSPECT_NAME' })}
                      disabled={
                        isLoading ||
                        !state.context.nameValidationError ||
                        state.context.nameInput?.length === 0
                      }
                    >
                      Fetch Record {state.context.fetchingRecord ? <Spinner /> : null}
                    </Button>
                  }
                </div>
                {state.context.nameValidationError && (
                  <Alert variant="destructive" className="mt-4">
                    <AlertDescription>{NAME_VALIDATION_ERROR}</AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="create">
            <div className="space-y-2 mb-4">
              <label className="block text-sm font-medium">Private Key (base64)</label>
              <div className="flex gap-2 items-center">
                <pre className="p-3 bg-muted rounded-md text-sm overflow-x-auto flex-1">
                  <span>{state.context.keypair?.raw.toBase64() ?? 'Generate key first'}</span>
                </pre>
                <Button variant="outline" onClick={() => send({ type: 'GENERATE_NEW_KEY' })}>
                  <KeyRound className="w-4 h-4 mr-2" />
                  Generate
                </Button>
              </div>
              {state.context?.keypair && (
                <div className="space-y-2">
                  <div className="flex gap-2 items-center">
                    <label className="block text-sm font-medium">IPNS Name</label>
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild={false}>
                          <InfoIcon className="w-4 h-4 text-blue-700" />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p className="text-sm m-2 p-2 bg-black text-white rounded-md">
                            The IPNS name is a base36 CID derived from the public key
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="flex gap-2 items-center">
                    <pre className="p-3 bg-muted rounded-md text-sm overflow-x-auto flex-1">
                      <span>{getIPNSNameFromKeypair(state.context.keypair)}</span>
                    </pre>
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex gap-2 items-center">
                  <label className="block text-sm font-medium">Value</label>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild={false}>
                        <InfoIcon className="w-4 h-4 text-blue-700" />
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <p className="text-sm m-2 p-2 bg-black text-white rounded-md">
                          CID to publish, e.g. <code className="text-xs">bafy...</code>
                          {/* CID or path to publish, e.g.{' '}
                          <code className="text-xs">bafy... or bafy.../assets/image.png</code> */}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <Input
                  value={state.context.formData.value}
                  onChange={(e) => send({ type: 'UPDATE_FORM', field: 'value', value: e.target.value })}
                  placeholder="bafy..."
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-row justify-around">
                  <label className="block text-sm font-medium">Validity / Lifetime (milliseconds)</label>
                  <label className="block text-sm font-medium ">Presets</label>
                </div>
                <div className="flex gap-1 items-center">
                  <Input
                    type="number"
                    value={state.context.formData.lifetime}
                    onChange={(e) => send({ type: 'UPDATE_FORM', field: 'lifetime', value: e.target.value })}
                    min="1"
                    max={MAX_VALIDITY}
                  />

                  <Button
                    variant="outline"
                    onClick={() => send({ type: 'UPDATE_FORM', field: 'lifetime', value: DAY_MS.toString() })}
                  >
                    1 day
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      send({ type: 'UPDATE_FORM', field: 'lifetime', value: (7 * DAY_MS).toString() })
                    }
                  >
                    1 week
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      send({ type: 'UPDATE_FORM', field: 'lifetime', value: (365 * DAY_MS).toString() })
                    }
                  >
                    1 year
                  </Button>
                </div>
              </div>

              {/* <div className="space-y-2">
                <label className="block text-sm font-medium">TTL (seconds)</label>
                <Input
                  type="number"
                  value={state.context.formData.ttl}
                  onChange={(e) => send({ type: 'UPDATE_FORM', field: 'ttl', value: e.target.value })}
                  min="1"
                />
              </div> */}

              {/* <div className="space-y-2">
                <label className="block text-sm font-medium">Sequence Number</label>
                <Input
                  type="number"
                  value={state.context.formData.sequence}
                  onChange={(e) => send({ type: 'UPDATE_FORM', field: 'sequence', value: e.target.value })}
                  min={MIN_SEQUENCE}
                />
              </div> */}

              <div className="flex gap-2">
                <Button
                  onClick={() => send({ type: 'CREATE_RECORD' })}
                  disabled={isLoading || state.context.keypair == null}
                  className="w-full"
                >
                  Create and Ispect Record
                </Button>
                <Button
                  onClick={() => send({ type: 'PUBLISH_RECORD' })}
                  disabled={state.context.record == null || state.context.publishingRecord}
                  className="w-full"
                >
                  Publish Record
                  {state.context.publishingRecord ? <Spinner /> : null}
                </Button>
              </div>
            </div>
          </TabsContent>

          {error && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error.toString()}</AlertDescription>
            </Alert>
          )}
          {state.context.publishSuccess && (
            <Alert className="mt-4 bg-green-50 border-green-200">
              <div className="flex gap-2 items-center">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-green-800">IPNS record published to the DHT successfully!</span>
                <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild={false}>
                          <InfoIcon className="w-4 h-4 text-blue-700" />
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          <p className="text-sm m-2 p-2 bg-black text-white rounded-md">
                            The IPNS name should be resolvable for the next 48 hours(the DHT expiration interval)
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
              </div>
            </Alert>
          )}

          {state.context.record && (
            <div className="mt-4 p-4 bg-amber-50 rounded">
              <h3 className="font-medium mb-2 break-all">
                IPNS Name: <span className="text-amber-600">{state.context.name}</span>
              </h3>
              <h3 className="font-medium mb-2">
                IPNS Record Version: {state.context.record.hasOwnProperty('signatureV1') ? 'V1+V2' : 'V2'}
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <RecordField label="Value" value={state.context.record.value} />
                <RecordField label="Validity Type" value={state.context.record.validityType} />
                <RecordField label="Validity" value={state.context.record.validity} />
                <RecordField label="Sequence" value={state.context.record.sequence.toString()} />
                <RecordField
                  label="TTL"
                  value={
                    state.context.record.ttl
                      ? (Number(state.context.record.ttl) / 1e9).toString() + ' seconds'
                      : 'Not set'
                  }
                />
                <RecordField
                  label="Signature V2"
                  value={state.context.record.signatureV2.toBase64()}
                  monospace
                />
                <RecordField label="Data" value={state.context.record.data.toBase64()} monospace />
              </div>
            </div>
          )}
        </Tabs>
      </CardContent>
    </Card>
  )
}

const RecordField: React.FC<RecordFieldProps> = ({ label, value, monospace }) => (
  <div className="border rounded p-3 bg-white">
    <div className="text-sm font-medium text-gray-500 mb-1">{label}</div>
    <div className={`break-all ${monospace ? 'font-mono text-sm' : ''}`}>{value}</div>
  </div>
)
