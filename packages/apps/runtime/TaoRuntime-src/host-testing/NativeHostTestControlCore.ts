import { validateAdvance, validateRunId } from '../core/Effects'
import { ErrorControls } from '../TR-errors'
import {
  type HostTestEnvironment,
  type HostTestEnvironmentSnapshot,
} from './HostTestEnvironment'

const CONTROL_HOST = 'control'
const CONTROL_PATH = ''

type NativeLinking = Readonly<{
  addEventListener: (
    type: 'url',
    listener: (event: Readonly<{ url: string }>) => void,
  ) => Readonly<{ remove: () => void }>
  getInitialURL: () => Promise<string | null>
}>

export type NativeHostTestControl = Readonly<{
  ready: Promise<void>
  receive: (url: string) => HostTestEnvironmentSnapshot
  dispose: () => void
}>

export type NativeHostTestControlOptions = Readonly<{
  /** Called after a matching control advance has updated the host-test environment. */
  onAdvance?: (snapshot: HostTestEnvironmentSnapshot) => void
}>

export function attachNativeHostTestControl(
  environment: HostTestEnvironment,
  linking: NativeLinking,
  options: NativeHostTestControlOptions = {},
): NativeHostTestControl {
  const controlProtocol = `taohostpoc-${environment.config.runId}:`
  if (!/^[a-z][a-z0-9+.-]*:$/u.test(controlProtocol)) {
    return ErrorControls.failInput('Native host-test run IDs must form a lowercase URL scheme.')
  }
  const receive = (url: string): HostTestEnvironmentSnapshot => {
    const command = parseControlUrl(url, controlProtocol)
    const snapshot = environment.advanceControl(command.runId, command.advanceMs)
    options.onAdvance?.(snapshot)
    return snapshot
  }
  const subscription = linking.addEventListener('url', event => {
    receive(event.url)
  })
  const ready = linking.getInitialURL().then(url => {
    if (url !== null) {
      receive(url)
    }
  })
  return Object.freeze({
    ready,
    receive,
    dispose(): void {
      subscription.remove()
    },
  })
}

function parseControlUrl(url: string, controlProtocol: string): Readonly<{ runId: string; advanceMs: number }> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return ErrorControls.failInput(`Host-test control URL is invalid: '${url}'.`)
  }
  if (
    parsed.protocol !== controlProtocol
    || parsed.hostname !== CONTROL_HOST
    || parsed.pathname !== CONTROL_PATH
    || parsed.username !== ''
    || parsed.password !== ''
    || parsed.port !== ''
    || parsed.hash !== ''
  ) {
    return ErrorControls.failInput(
      `Host-test control URL must be '${controlProtocol}//${CONTROL_HOST}?runId=…&advanceMs=…'.`,
    )
  }
  const keys = [...parsed.searchParams.keys()]
  const runIds = parsed.searchParams.getAll('runId')
  const advances = parsed.searchParams.getAll('advanceMs')
  if (keys.length !== 2 || new Set(keys).size !== 2 || runIds.length !== 1 || advances.length !== 1) {
    return ErrorControls.failInput(
      'Host-test control URL must contain exactly one runId and one advanceMs query parameter.',
    )
  }
  const runId = runIds[0]
  const advanceText = advances[0]
  if (runId === undefined || advanceText === undefined) {
    return ErrorControls.failInvariant('Host-test control URL query values were unavailable after validation.')
  }
  validateRunId(runId)
  if (!/^(0|[1-9][0-9]*)$/.test(advanceText)) {
    return ErrorControls.failInput(`Host-test advanceMs '${advanceText}' must be a decimal integer.`)
  }
  const advanceMs = Number(advanceText)
  validateAdvance(advanceMs)
  return { runId, advanceMs }
}
