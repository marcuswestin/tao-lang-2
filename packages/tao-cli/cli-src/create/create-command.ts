import { Errors, FS, HCI } from '@shared'
import Workspace from '@workspace'
import type { Readable, Writable } from 'node:stream'
import { TaoAppModules } from '../app-modules'
import { runFix } from '../source-commands'
import { findTaoTestFiles } from '../test-command'
import { buildCreationBrief, type BuildCreationBriefOptions, type CreationBrief } from './creation-brief'
import {
  type CreationLane,
  type CreationLaneKind,
  creationLaneKinds,
  detectCreationLanes,
  type DetectCreationLanesOptions,
  type OpenedLane,
} from './creation-lanes'
import { humanize, lowerCreationPlan, writeCreationFiles } from './creation-lowering'
import { planCreation } from './creation-pipeline'
import { type CreationPlan, deterministicPlan, projectIdIssues, validateCreationPlan } from './creation-plan'

/** CreateAiOption is the `--ai` flag: pick the first lane, a named lane, or no model at all. */
export type CreateAiOption = 'auto' | 'none' | CreationLaneKind

export const createAiOptions: readonly CreateAiOption[] = ['auto', ...creationLaneKinds, 'none']

type TerminalStreams = {
  input?: Readable
  interactive?: boolean
  output?: Writable
}

/** CreationPrompts asks the person the three questions create may ask; tests script the answers. */
export type CreationPrompts = {
  confirm(message: string, defaultValue: boolean): Promise<boolean>
  text(message: string, defaultValue: string, validate: (value: string) => string | undefined): Promise<string>
}

export type CreateCommandOptions = TerminalStreams & {
  ai?: CreateAiOption
  brief?: Pick<BuildCreationBriefOptions, 'fetch' | 'paletteFromImage' | 'urlTimeoutMs'>
  cwd?: string
  id?: string
  /** Lanes to offer, or a detector; the CLI detects what the machine has. */
  lanes?: readonly CreationLane[] | ((options: DetectCreationLanesOptions) => Promise<CreationLane[]>)
  prompts?: CreationPrompts
  /** Runs the new project's tests. The CLI runs `tao test`; `false` skips them. */
  runTests?: false | ((directory: string) => Promise<void>)
  yes?: boolean
}

export type CreateCommandResult = {
  created: boolean
  directory: string
  plan: CreationPlan
}

type ShapedPlan = {
  plan: CreationPlan
  /** The lane that shaped the plan, or undefined when the plain starter is used. */
  shapedBy?: string
}

/**
 * runCreate turns a description into a runnable Tao project: read what the description points at,
 * let an available model shape a plan when the person agrees, confirm the id and the plan, then lower,
 * format, validate, and test the result. Without a model the plain starter is created instead.
 */
export async function runCreate(description: string, options: CreateCommandOptions = {}): Promise<CreateCommandResult> {
  const cwd = FS.resolvePath(options.cwd ?? '.')
  const streams = terminalStreams(options)
  const prompts = options.prompts ?? terminalPrompts(streams)
  const say = (message: string) => HCI.writeLine(message, streams)
  if (description.trim().length === 0) {
    Errors.throwUserInput('Describe the app in a sentence, for example: tao create "A shared grocery list".')
  }
  if (options.id !== undefined) {
    const issue = idIssueAt(options.id, cwd)
    if (issue !== undefined) {
      Errors.throwUserInput(issue)
    }
  }

  const brief = await buildCreationBrief(description, { cwd, ...options.brief })
  reportSources(brief, say)

  const lane = await chooseLane(brief, options, streams, prompts, say)
  const { plan, shapedBy } = lane === undefined
    ? { plan: plainPlan(brief, options) }
    : await shapeWithLane(lane, brief, options, say)

  if (options.id === undefined && options.yes !== true && HCI.isInteractive(streams)) {
    plan.id = await prompts.text('Project id (also the directory name)', plan.id, value => idIssueAt(value, cwd))
  }
  const issues = validateCreationPlan(plan)
  if (issues.length > 0) {
    Errors.throwUnexpected(`The creation plan is not valid: ${issues.join(' ')}`)
  }

  say('')
  say(proposalSummary(plan, shapedBy))
  const directory = FS.resolvePath(plan.id, cwd)
  if (await FS.exists(directory)) {
    Errors.throwUserInput(
      `Cannot create project '${plan.id}': ${
        FS.displayPath(directory)
      } already exists. Pass --id to choose another id.`,
    )
  }
  if (options.yes !== true && HCI.isInteractive(streams)) {
    const confirmed = await prompts.confirm(`Create ${FS.displayPath(directory)}?`, true)
    if (!confirmed) {
      say('Nothing created.')
      return { created: false, directory, plan }
    }
  }

  const files = lowerCreationPlan(plan, { description: brief.description })
  await writeCreationFiles(directory, files)
  await TaoAppModules.ensureProject(directory)
  await runFix(directory, { cwd })
  const problems = await validateProject(directory)
  if (problems.length > 0) {
    for (const problem of problems) {
      HCI.writeErrorLine(problem, streams)
    }
    Errors.throwUnexpected(
      `tao create wrote a project that does not validate. The files in ${
        FS.displayPath(directory)
      } were kept so the problem can be inspected.`,
    )
  }
  say('')
  say(`Wrote ${FS.displayPath(directory)}:`)
  for (const path of Object.keys(files).sort()) {
    say(`  ${path}`)
  }

  if (options.runTests !== false) {
    say('')
    say("Running the new project's tests.")
    // Lowering always writes one behavior test. Discovery walks Git's view of the tree, so a project
    // created under an ignored folder would otherwise "pass" without a single test having run.
    const tests = await findTaoTestFiles(directory)
    if (tests.length === 0) {
      Errors.throwUnexpected(
        `The new project's tests were not found under ${FS.displayPath(directory)}; refusing to report it created.`,
      )
    }
    await (options.runTests ?? runProjectTests)(directory)
  }
  say('')
  HCI.writeSuccess(`Created ${FS.displayPath(directory)}\n`, streams)
  say('Next:')
  say(`  tao dev ${quoteForCommand(FS.relativePath(cwd, directory))}`)
  say(`  tao test ${quoteForCommand(FS.relativePath(cwd, directory))}`)
  return { created: true, directory, plan }
}

/**
 * shapeWithLane opens the chosen lane and lets its model shape the plan. Anything that keeps the lane
 * from answering — it will not start, it is unavailable, it throws — ends in the plain starter, said out
 * loud, never in an aborted command.
 */
async function shapeWithLane(
  lane: CreationLane,
  brief: CreationBrief,
  options: CreateCommandOptions,
  say: (message: string) => void,
): Promise<ShapedPlan> {
  say(`Shaping the project with ${lane.label}.`)
  let opened: OpenedLane | undefined
  try {
    opened = await lane.open()
    const availability = await opened.provider.availability()
    if (availability.status === 'unavailable') {
      say(`${lane.label} is not available: ${availability.reason} The plain starter is used instead.`)
      return { plan: plainPlan(brief, options) }
    }
    const result = await planCreation({
      brief,
      ...idOption(options),
      provider: opened.provider,
      report: message => say(`  ${message}`),
      window: lane.window,
    })
    for (const note of result.notes) {
      say(`  ${note}`)
    }
    return result.shapedByModel ? { plan: result.plan, shapedBy: lane.label } : { plan: result.plan }
  } catch (error) {
    say(`${lane.label} could not be used (${Errors.formatForUser(error)}). The plain starter is used instead.`)
    return { plan: plainPlan(brief, options) }
  } finally {
    await opened?.stop?.()
  }
}

/** plainPlan is the starter written without a model; a palette read from an image still applies. */
function plainPlan(brief: CreationBrief, options: CreateCommandOptions): CreationPlan {
  return deterministicPlan(brief.description, {
    ...idOption(options),
    ...(brief.palette === undefined ? {} : { palette: brief.palette }),
  })
}

async function chooseLane(
  brief: CreationBrief,
  options: CreateCommandOptions,
  streams: TerminalStreams,
  prompts: CreationPrompts,
  say: (message: string) => void,
): Promise<CreationLane | undefined> {
  const ai = options.ai ?? 'auto'
  if (ai === 'none') {
    return undefined
  }
  const detect = typeof options.lanes === 'function'
    ? options.lanes
    : options.lanes === undefined
    ? detectCreationLanes
    : async () => [...options.lanes as readonly CreationLane[]]
  const lanes = await detect({
    allowWeb: brief.sources.some(source => source.kind === 'url'),
    attachments: brief.sources.flatMap(source => source.kind === 'image' ? [source.path] : []),
  })
  if (ai !== 'auto') {
    const lane = lanes.find(candidate => candidate.kind === ai)
    if (lane === undefined) {
      Errors.throwUserInput(
        `The '${ai}' AI lane is not available on this machine. Available: ${
          lanes.length === 0 ? 'none' : lanes.map(candidate => candidate.kind).join(', ')
        }.`,
      )
    }
    return lane
  }
  if (lanes.length === 0) {
    say('No AI lane found (Claude Code, Codex, Ollama, or Apple Intelligence). The plain starter is used.')
    return undefined
  }
  const interactive = HCI.isInteractive(streams)
  for (const lane of lanes) {
    if (options.yes === true) {
      return lane
    }
    if (!interactive) {
      say(`${lane.label} is available; pass --yes or --ai ${lane.kind} to use it. The plain starter is used.`)
      return undefined
    }
    if (await prompts.confirm(lane.consent, true)) {
      return lane
    }
  }
  say('No AI lane accepted. The plain starter is used.')
  return undefined
}

function reportSources(brief: CreationBrief, say: (message: string) => void): void {
  for (const source of brief.sources) {
    if (source.kind === 'url') {
      say(
        source.text === undefined
          ? `Could not read ${source.url}: ${source.error ?? 'unknown reason'}.`
          : `Read ${source.url}${source.title === undefined ? '' : ` (${source.title})`}.`,
      )
    } else {
      say(
        source.palette === undefined
          ? `Could not read colors from ${FS.displayPath(source.path)}: ${source.error ?? 'unknown reason'}.`
          : `Read colors from ${FS.displayPath(source.path)}.`,
      )
    }
  }
}

/** proposalSummary is the plan in plain words, shown before anything is written. */
function proposalSummary(plan: CreationPlan, shapedBy: string | undefined): string {
  const lines = [
    `${plan.name} (id ${plan.id}): ${plan.summary}`,
    `  ${shapedBy === undefined ? 'Plain starter, no model involved.' : `Shaped by ${shapedBy}.`}`,
  ]
  for (const entity of plan.entities) {
    const fields = entity.fields.map(field => {
      const type = field.type === 'yesno' ? 'yes/no' : field.type
      return field.title ? `${field.name} (${type}, title)` : `${field.name} (${type})`
    })
    const rows = plan.samples[entity.plural]?.length ?? 0
    lines.push(
      `  ${entity.plural} / ${entity.singular}: ${fields.join(', ')}; ${rows} sample ${rows === 1 ? 'row' : 'rows'}`,
    )
  }
  lines.push(`  Colors: canvas ${plan.palette.canvas}, ink ${plan.palette.ink}, accent ${plan.palette.accent}`)
  lines.push(`  Screens: ${plan.entities.map(entity => `${humanize(entity.plural)} list and detail`).join(', ')}`)
  return lines.join('\n')
}

/**
 * validateProject validates from the two entry files a project has — the app file and its test file —
 * which is how `tao dev` and `tao test` see it; every other file is reached from those. Validating a
 * feature file as its own entry would misreport the app as declared outside the entry.
 */
async function validateProject(directory: string): Promise<string[]> {
  const workspace = await Workspace.open(directory)
  const problems = new Set<string>()
  const entries: string[] = [FS.resolvePath('App.tao', directory)]
  for await (const path of FS.walk(directory, { extensions: ['.tao'] })) {
    if (path.endsWith('.test.tao')) {
      entries.push(path)
    }
  }
  for (const entry of entries) {
    const result = await workspace.validate(entry)
    for (const diagnostic of result.diagnostics) {
      if (diagnostic.severity === 'error') {
        const file = diagnostic.filePath === undefined ? entry : FS.resolvePath(diagnostic.filePath, directory)
        problems.add(`${FS.relativePath(directory, file)}: ${diagnostic.message}`)
      }
    }
  }
  return [...problems]
}

async function runProjectTests(directory: string): Promise<void> {
  const { runTestCommand } = await import('../test-command')
  await runTestCommand(directory)
}

/** idIssueAt says why an id cannot be used here: it is malformed, or a directory of that name exists. */
function idIssueAt(id: string, cwd: string): string | undefined {
  const issue = projectIdIssues(id)[0]
  if (issue !== undefined) {
    return issue
  }
  return FS.existsSync(FS.resolvePath(id, cwd))
    ? `Cannot create project '${id}': ${FS.displayPath(FS.resolvePath(id, cwd))} already exists. Choose another id.`
    : undefined
}

function terminalPrompts(streams: TerminalStreams): CreationPrompts {
  return {
    confirm: (message, defaultValue) => HCI.askConfirm({ ...streams, message, defaultValue }),
    text: (message, defaultValue, validate) => HCI.askText({ ...streams, message, defaultValue, validate }),
  }
}

function terminalStreams(options: CreateCommandOptions): TerminalStreams {
  return {
    ...(options.input === undefined ? {} : { input: options.input }),
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.interactive === undefined ? {} : { interactive: options.interactive }),
  }
}

function idOption(options: CreateCommandOptions): { id?: string } {
  return options.id === undefined ? {} : { id: options.id }
}

function quoteForCommand(value: string): string {
  return /\s/u.test(value) ? JSON.stringify(value) : value
}
