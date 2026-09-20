import { Errors } from '@shared'
import {
  improvementFacts,
  loadSemanticSnapshot,
  parseChecks,
  readProjectTaoSources,
  resolveTarget,
  viewCoverage,
} from '@workspace'

const FACTS_FORMAT = 'tao-semantic-facts-v1'
const COVERAGE_FORMAT = 'tao-semantic-coverage-v1'

export type SemanticCommandOptions = Readonly<{ appName: string; entryPath: string; projectRoot: string }>

/** runSemanticFacts reports the semantic facts Studio's agent uses, in a versioned JSON envelope. */
export async function runSemanticFacts(options: SemanticCommandOptions): Promise<unknown> {
  const snapshot = await loadSemanticSnapshot(options)
  requireApp(snapshot, options.appName)
  const files = await readProjectTaoSources(snapshot.projectRoot)
  return {
    app: snapshot.appName,
    diagnostics: snapshot.diagnostics,
    facts: improvementFacts(snapshot, undefined, files),
    format: FACTS_FORMAT,
    version: 1,
  }
}

/** runSemanticCoverage reports the textual behavior-test coverage Studio shows for one view. */
export async function runSemanticCoverage(options: SemanticCommandOptions & { view: string }): Promise<unknown> {
  const snapshot = await loadSemanticSnapshot(options)
  requireApp(snapshot, options.appName)
  const view = resolveTarget(snapshot, options.view)
  if (view === undefined || view.kind !== 'view') {
    Errors.throwUserInput(`No view named '${options.view}' exists in ${snapshot.appName}.`)
  }
  const sources = await readProjectTaoSources(snapshot.projectRoot, path => path.endsWith('.test.tao'))
  return {
    coverage: viewCoverage(snapshot, view, sources.flatMap(source => parseChecks(source.content))),
    diagnostics: snapshot.diagnostics,
    format: COVERAGE_FORMAT,
    version: 1,
  }
}

function requireApp(snapshot: Awaited<ReturnType<typeof loadSemanticSnapshot>>, appName: string): void {
  if (snapshot.nodes.get(`app:${appName}`)?.kind !== 'app') {
    Errors.throwUserInput(`No app named '${appName}' exists in the selected project.`)
  }
}
