import { Platform } from '@shared'
import { LSPWorkspace } from 'tao-compiler/workspace'
import { TaoFormatter } from 'tao-formatter'
import { Langium } from 'tao-parser'
import { TaoCodeActionProvider } from 'tao-source-actions/langium-code-actions'
import { requireMatchingEditorRelease } from './release-profile'

const connection = Langium.createConnection(Langium.ProposedFeatures.all)
const workspaceRoot = Platform.runtimeProcess.env['TAO_WORKSPACE_ROOT'] ?? Platform.runtimeProcess.cwd()

void startLanguageServer()

async function startLanguageServer(): Promise<void> {
  await requireMatchingEditorRelease(workspaceRoot)
  const workspace = await LSPWorkspace.open(workspaceRoot, { connection, ...Langium.NodeFileSystem }, {
    lspFormatter: () => new TaoFormatter(),
    lspCodeActionProvider: () => new TaoCodeActionProvider(),
  })
  workspace.startLanguageServer()
}
