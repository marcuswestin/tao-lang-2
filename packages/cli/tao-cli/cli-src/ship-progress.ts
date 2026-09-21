import { Errors, FS, HCI, Text } from '@shared'

export type ShipProgressPhaseId =
  | 'app-store-connect'
  | 'apple-processing'
  | 'app-review'
  | 'bundle-export'
  | 'checkpoint'
  | 'compile'
  | 'ios-archive'
  | 'ios-dependencies'
  | 'ios-project'
  | 'testflight'
  | 'update-publish'
  | 'upload'

export type ShipProgressPhase = Readonly<{
  id: ShipProgressPhaseId
  label: string
}>

export type ShipProgressPlanInput = Readonly<{
  beta: boolean
  buildId?: string
  noWait: boolean
  rollback: boolean
  reuseBuild: boolean
  update: boolean
}>

/** planShipProgress owns the stable phase contract consumed by terminals and Studio. */
export function planShipProgress(input: ShipProgressPlanInput): readonly ShipProgressPhase[] {
  if (input.update) {
    if (input.rollback) {
      return [
        { id: 'update-publish', label: 'Roll back to the previous update' },
        { id: 'checkpoint', label: 'Record the published update' },
      ]
    }
    return [
      { id: 'compile', label: 'Compile the release app' },
      { id: 'bundle-export', label: 'Export and verify the update bundle' },
      { id: 'update-publish', label: 'Publish the compatible update' },
      { id: 'checkpoint', label: 'Record the published update' },
    ]
  }

  const phases: ShipProgressPhase[] = [
    { id: 'app-store-connect', label: 'Connect to App Store Connect' },
  ]
  if (!input.reuseBuild) {
    phases.push(
      { id: 'compile', label: 'Compile the release app' },
      { id: 'bundle-export', label: 'Export and verify the release bundle' },
      { id: 'ios-project', label: 'Generate the iOS project' },
      { id: 'ios-dependencies', label: 'Install iOS dependencies' },
      { id: 'ios-archive', label: 'Archive and sign the iOS app' },
      { id: 'upload', label: 'Upload the build to App Store Connect' },
    )
  }
  const stopsAfterUpload = input.noWait && !input.reuseBuild
  if (!stopsAfterUpload && (!input.reuseBuild || input.buildId === undefined)) {
    phases.push({ id: 'apple-processing', label: 'Wait for Apple to process the build' })
  }
  if (!stopsAfterUpload) {
    phases.push(
      input.beta
        ? { id: 'testflight', label: 'Configure TestFlight distribution' }
        : { id: 'app-review', label: 'Submit the build for App Store review' },
    )
  }
  phases.push({ id: 'checkpoint', label: 'Record the ship result' })
  return phases
}

/** ShipProgress emits one concise, grep-stable line whenever a phase begins. */
export class ShipProgress {
  #index = 0
  #phase?: ShipProgressPhase

  constructor(
    private readonly phases: readonly ShipProgressPhase[],
    private readonly output: HCI.OutputOptions = {},
  ) {}

  get currentLabel(): string | undefined {
    return this.#phase?.label
  }

  step(id: ShipProgressPhaseId): void {
    const phase = this.phases[this.#index]
    if (phase?.id !== id) {
      Errors.throwUnexpected(
        `Expected ship progress phase '${phase?.id ?? 'complete'}', received '${id}'.`,
      )
    }
    this.#phase = phase
    this.#index += 1
    HCI.writeLine(`[ship ${this.#index}/${this.phases.length}] ${phase.label}…`, this.output)
  }
}

/** shipCommandFailure keeps terminal errors actionable while the full vendor output stays in a log. */
export function shipCommandFailure(error: unknown, phase: string | undefined, logPath: string): Error {
  if (!(error instanceof Errors.CommandExecutionError)) {
    return Errors.asError(error)
  }
  const output = Text.stripAnsi(`${error.result.stderr}\n${error.result.stdout}`)
  const diagnostic = output
    .split(/\r?\n/u)
    .map(line => line.trim())
    .find(line => /(?:\berror:|STATE_ERROR|ENTITY_ERROR)/iu.test(line))
  const summary = `${phase ?? 'Ship command'} failed${diagnostic ? `: ${diagnostic}` : '.'}`
  return new Errors.HostEnvironmentError(`${summary}\nDetailed log: ${FS.displayPath(logPath)}`, { cause: error })
}
