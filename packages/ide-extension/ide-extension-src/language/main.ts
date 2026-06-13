import { TaoFormatter } from 'tao-formatter'
import { Langium } from 'tao-parser'
import { TaoCodeActionProvider } from 'tao-source-actions/langium-code-actions'
import { LSPWorkspace } from 'tao-workspace'

const connection = Langium.createConnection(Langium.ProposedFeatures.all)
const workspaceRoot = process.env['TAO_WORKSPACE_ROOT'] ?? process.cwd()

void startLanguageServer()

async function startLanguageServer(): Promise<void> {
  const workspace = await LSPWorkspace.open(workspaceRoot, { connection, ...Langium.NodeFileSystem }, {
    lspFormatter: () => new TaoFormatter(),
    lspCodeActionProvider: () => new TaoCodeActionProvider(),
  })
  workspace.startLanguageServer()
}
