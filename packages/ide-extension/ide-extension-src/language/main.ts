import { Langium } from 'tao-parser'
import { LSPWorkspace } from 'tao-workspace'

const connection = Langium.createConnection(Langium.ProposedFeatures.all)
const workspaceRoot = process.env['TAO_WORKSPACE_ROOT'] ?? process.cwd()

void startLanguageServer()

async function startLanguageServer(): Promise<void> {
  const workspace = await LSPWorkspace.open(workspaceRoot, { connection, ...Langium.NodeFileSystem })
  workspace.startLanguageServer()
}
