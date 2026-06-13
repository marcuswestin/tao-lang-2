import { FS } from '@shared'
import { type AST, Langium } from 'tao-parser'
import SourceActions, { type SourceActionOptions } from 'tao-source-actions'
import Workspace from 'tao-workspace'
import * as vscode from 'vscode'
import type { ExecutableOptions, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node'
import { LanguageClient, TransportKind } from 'vscode-languageclient/node'

let client: LanguageClient | undefined

/** activate starts the bundled Tao language server client. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  registerTaoSourceActionCommands(context)
  client = new LanguageClient(
    'tao',
    'Tao Language Server',
    serverOptions(context),
    clientOptions(),
  )
  await client.start()
}

/** deactivate stops the Tao language server client. */
export function deactivate(): Thenable<void> | undefined {
  return client?.stop()
}

function serverOptions(context: vscode.ExtensionContext): ServerOptions {
  const module = context.asAbsolutePath(FS.joinPath('_gen_ide-extension/language/main.cjs'))
  const options = serverExecutableOptions()
  return {
    run: { module, transport: TransportKind.ipc, options },
    debug: { module, transport: TransportKind.ipc, options },
  }
}

function clientOptions(): LanguageClientOptions {
  return {
    documentSelector: [{ scheme: '*', language: 'tao' }],
  }
}

type TaoSourceActionCommand = {
  command: string
  run: (document: AST.Document, options: SourceActionOptions) => Promise<string | undefined>
}

const taoSourceActionCommands: readonly TaoSourceActionCommand[] = [
  { command: 'tao.fixSource', run: SourceActions.fixSource },
  { command: 'tao.organizeSource', run: document => SourceActions.organizeSource(document) },
  { command: 'tao.removeUnusedImports', run: document => SourceActions.removeUnusedImports(document) },
  { command: 'tao.moveRendersLast', run: document => SourceActions.moveRendersLast(document) },
]

function registerTaoSourceActionCommands(context: vscode.ExtensionContext): void {
  for (const command of taoSourceActionCommands) {
    context.subscriptions.push(vscode.commands.registerCommand(command.command, () => runTaoSourceAction(command)))
  }
}

async function runTaoSourceAction(command: TaoSourceActionCommand): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    await vscode.window.showWarningMessage('Open a Tao file before running this command.')
    return
  }
  if (editor.document.languageId !== 'tao') {
    await vscode.window.showWarningMessage('The active editor is not a Tao file.')
    return
  }

  try {
    const currentText = editor.document.getText()
    const documentUri = Langium.URI.parse(editor.document.uri.toString())
    const workspace = await Workspace.open(workspaceRootForDocument(editor.document))
    const parsed = await workspace.parseSource(currentText, documentUri)
    const nextText = await command.run(parsed.entry.document, {
      parseUpdatedDocument: async (document, text) => {
        return (await workspace.parseSource(text, document.uri)).entry.document
      },
    })
    if (nextText === undefined || nextText === currentText) {
      await vscode.window.showInformationMessage('No Tao source changes available.')
      return
    }
    const applied = await editor.edit(edit => edit.replace(fullDocumentRange(editor.document), nextText))
    if (!applied) {
      await vscode.window.showErrorMessage('Could not apply Tao source changes.')
    }
  } catch (error) {
    await vscode.window.showErrorMessage(`Could not run Tao source action: ${errorMessage(error)}`)
  }
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function serverExecutableOptions(): ExecutableOptions {
  return {
    env: {
      ...process.env,
      TAO_WORKSPACE_ROOT: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
    },
  }
}

function workspaceRootForDocument(document: vscode.TextDocument): string {
  return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
    ?? (document.uri.scheme === 'file' ? FS.dirname(document.uri.fsPath) : process.cwd())
}
