import { FS } from '@shared'
import * as vscode from 'vscode'
import type { LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node'
import { LanguageClient, TransportKind } from 'vscode-languageclient/node'

let client: LanguageClient | undefined

/** activate starts the bundled Tao language server client. */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
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
  return {
    run: { module, transport: TransportKind.ipc },
    debug: { module, transport: TransportKind.ipc },
  }
}

function clientOptions(): LanguageClientOptions {
  return {
    documentSelector: [{ scheme: '*', language: 'tao' }],
  }
}
