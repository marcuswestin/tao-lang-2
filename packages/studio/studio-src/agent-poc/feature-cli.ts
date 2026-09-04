// Semantic agent PoC: plan a feature headlessly. `bun packages/studio/studio-src/agent-poc/feature-cli.ts <projectRoot> <entry.tao> <App> "<request>" [--shape '{json}']`
//
// Validation happens in Studio: applying compiles the real project and restores every file when it fails.
// A copied project under `.artifacts/` cannot be validated instead — folder imports such as `@data` do not
// resolve outside the repository tree, so an untouched copy already reports unresolved references.
import { FS } from '@shared'
import { Workspace } from '@workspace'
import { type FeatureShape, lowerFeature, planFeature } from './FeaturePlan'
import { buildSemanticSnapshot } from './SemanticSnapshot'

const [projectRoot, entry, appName, request, flag, shapeJson] = process.argv.slice(2)
const workspace = await Workspace.open(projectRoot!)
const result = await workspace.validate(entry!)
const snapshot = buildSemanticSnapshot(projectRoot!, appName!, result.files, result.diagnostics)
const readFile = async (path: string) => await FS.readText(FS.resolvePath(path, projectRoot!))
if (flag === '--shape') {
  const problems: string[] = []
  const lowered = await lowerFeature(snapshot, JSON.parse(shapeJson!) as FeatureShape, readFile, problems)
  console.log(JSON.stringify({ problems, steps: lowered.steps }, null, 1))
  for (const edit of lowered.edits) {
    console.log(`\n===== ${edit.path}\n${edit.after}`)
  }
} else {
  const plan = await planFeature(snapshot, request!, readFile)
  console.log(
    JSON.stringify(
      {
        explanation: plan.explanation,
        kind: plan.kind,
        model: { elapsedMs: plan.model.elapsedMs, status: plan.model.status, message: plan.model.message },
        problems: plan.problems,
        shape: plan.shape,
        steps: plan.steps,
      },
      null,
      1,
    ),
  )
  for (const edit of plan.edits) {
    console.log(`\n===== ${edit.path}\n${edit.after}`)
  }
}
