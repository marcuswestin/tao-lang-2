// Semantic agent PoC: print the snapshot for one app. `bun packages/studio/studio-src/agent-poc/snapshot-cli.ts <projectRoot> <entry.tao> <AppName> [query...]`
import { Workspace } from '@workspace'
import { buildSemanticSnapshot, fieldStory, inspect, overview, snapshotToJson, trace } from './SemanticSnapshot'

const [projectRoot, entry, appName, command, ...args] = process.argv.slice(2)
const workspace = await Workspace.open(projectRoot!)
const result = await workspace.validate(entry!)
const snapshot = buildSemanticSnapshot(projectRoot!, appName!, result.files, result.diagnostics)
const output = command === 'inspect'
  ? inspect(snapshot, args[0]!)
  : command === 'trace'
  ? trace(snapshot, args[0]!, args[1]!)
  : command === 'field'
  ? fieldStory(snapshot, args[0]!)
  : command === 'dump'
  ? snapshotToJson(snapshot)
  : overview(snapshot)
console.log(JSON.stringify(output, null, 1))
