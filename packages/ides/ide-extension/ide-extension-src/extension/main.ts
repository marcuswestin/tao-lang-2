import { Errors, FS, Platform } from '@shared'
import Workspace from 'tao-compiler/workspace'
import { type AST, Langium } from 'tao-parser'
import SourceActions, { type SourceActionOptions } from 'tao-source-actions'
import * as vscode from 'vscode'
import {
  type ExecutableOptions,
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node'
import { requireMatchingEditorRelease } from '../language/release-profile'
import { startProjectTooling } from './project-tooling-integration'
import { workspaceServerPlan } from './workspace-server-roots'

let clients = new Map<string, LanguageClient>()
let clientSequence = 0
let clientReconciliation: Promise<void> = Promise.resolve()
let stopProjectTooling: (() => Promise<void>) | undefined

/** activate starts the bundled Tao language server client. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  registerTaoSourceActionCommands(context)
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    void reconcileLanguageClients(context).catch(async error => {
      await vscode.window.showErrorMessage(`Could not update Tao language servers: ${Errors.messageOf(error)}`)
    })
  }))
  await reconcileLanguageClients(context)
  stopProjectTooling = await startProjectTooling(context)
}

async function reconcileLanguageClients(context: vscode.ExtensionContext): Promise<void> {
  clientReconciliation = clientReconciliation.catch(() => undefined).then(async () => {
    const folders = vscode.workspace.workspaceFolders ?? []
    const plan = workspaceServerPlan(
      [...clients.keys()],
      folders.map(folder => folder.uri.fsPath),
      Platform.runtimeProcess.cwd(),
    )
    const additions = plan.add.map(async root => {
      await requireMatchingEditorRelease(root)
      const client = new LanguageClient(
        `tao-${++clientSequence}`,
        folders.length > 1 ? `Tao Language Server (${FS.basename(root)})` : 'Tao Language Server',
        serverOptions(context, root),
        clientOptions(folders.find(folder => FS.resolvePath(folder.uri.fsPath) === root)),
      )
      clients.set(root, client)
      return client.start().catch(error => {
        clients.delete(root)
        throw error
      })
    })
    // One folder refusing its editor release must not strand the other folders' starts or the removals.
    const started = await Promise.allSettled(additions)
    const removed = plan.remove.flatMap(root => {
      const client = clients.get(root)
      return client === undefined ? [] : [[root, client] as const]
    })
    await Promise.all(removed.map(([, client]) => client.stop()))
    for (const [root] of removed) {
      clients.delete(root)
    }
    const failures = started.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (failures.length === 1) {
      throw failures[0]
    }
    if (failures.length) {
      throw new AggregateError(failures, failures.map(failure => Errors.formatForUser(failure)).join('\n'))
    }
  })
  return await clientReconciliation
}

/** deactivate stops the Tao language server client. */
export function deactivate(): Thenable<void> | undefined {
  if (clients.size === 0 && stopProjectTooling === undefined) {
    return undefined
  }
  const stopping = clientReconciliation.then(async () => {
    await Promise.all([
      ...[...clients.values()].map(client => client.stop()),
      stopProjectTooling?.(),
    ])
    clients.clear()
    stopProjectTooling = undefined
  })
  return stopping
}

function serverOptions(context: vscode.ExtensionContext, workspaceRoot: string): ServerOptions {
  const module = context.asAbsolutePath(FS.joinPath('_gen_ide-extension/language/main.cjs'))
  const options = serverExecutableOptions(workspaceRoot)
  return {
    run: { module, transport: TransportKind.ipc, options },
    debug: { module, transport: TransportKind.ipc, options },
  }
}

function clientOptions(folder: vscode.WorkspaceFolder | undefined): LanguageClientOptions {
  return {
    documentSelector: [
      folder === undefined
        ? { scheme: 'file', language: 'tao' }
        : {
          scheme: 'file',
          language: 'tao',
          pattern: { baseUri: folder.uri.toString(), pattern: '**/*.tao' },
        },
    ],
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
    await requireMatchingEditorRelease(
      editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : workspaceRootForDocument(editor.document),
    )
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
    await vscode.window.showErrorMessage(`Could not run Tao source action: ${Errors.messageOf(error)}`)
  }
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length))
}

function serverExecutableOptions(workspaceRoot: string): ExecutableOptions {
  return {
    env: {
      ...Platform.runtimeProcess.env,
      TAO_WORKSPACE_ROOT: workspaceRoot,
    },
  }
}

function workspaceRootForDocument(document: vscode.TextDocument): string {
  return vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath
    ?? (document.uri.scheme === 'file' ? FS.dirname(document.uri.fsPath) : Platform.runtimeProcess.cwd())
}
