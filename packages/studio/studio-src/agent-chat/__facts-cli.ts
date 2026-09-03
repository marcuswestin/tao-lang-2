import { Workspace } from '@workspace'
import { buildSemanticSnapshot } from '../agent-poc/SemanticSnapshot'
import { fileOutlines, improvementFacts } from './AgentChatFacts'
const [projectRoot, entry, appName] = process.argv.slice(2)
const workspace = await Workspace.open(projectRoot!)
const result = await workspace.validate(entry!)
const snapshot = buildSemanticSnapshot(projectRoot!, appName!, result.files, result.diagnostics)
console.log(JSON.stringify(improvementFacts(snapshot), null, 1))
