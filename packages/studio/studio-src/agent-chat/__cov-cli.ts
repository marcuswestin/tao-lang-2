import { FS } from '@shared'
import { Workspace } from '@workspace'
import { buildSemanticSnapshot, resolveTarget } from '../agent-poc/SemanticSnapshot'
import { parseChecks, viewCoverage } from './AgentChatCoverage'
const [projectRoot, entry, appName, view, ...tests] = process.argv.slice(2)
const workspace = await Workspace.open(projectRoot!)
const result = await workspace.validate(entry!)
const snapshot = buildSemanticSnapshot(projectRoot!, appName!, result.files, result.diagnostics)
const checks = (await Promise.all(tests.map(async t => parseChecks(await FS.readText(t))))).flat()
console.log(
  JSON.stringify(
    {
      checkNames: checks.map(c => `${c.suite}/${c.name}`),
      coverage: viewCoverage(snapshot, resolveTarget(snapshot, view!)!, checks),
    },
    null,
    1,
  ),
)
