import { Langium } from '@parser'
import { Expect, Test, until, withTaoFiles } from '@shared/test'
import { StudioLsp } from '../studio-src/StudioLsp'

Test('Studio LSP transports initialize and formatting over raw WebSocket frames', async () => {
  await withTaoFiles(
    'tao-studio-lsp-',
    {
      'Garden.tao': `
        use Text from @tao/ui
        app Garden { view MainView }
        view MainView() { render Text("Hello") }
      `,
    },
    async (paths, root) => {
      const messages: Array<{ id?: number; result?: unknown }> = []
      let close: { code?: number; reason?: string } | undefined
      const session = StudioLsp.createSession(root, {
        close(code, reason) {
          close = { code, reason }
        },
        send(message) {
          messages.push(JSON.parse(message) as typeof messages[number])
        },
      })
      try {
        const initialize = JSON.stringify({
          id: 1,
          jsonrpc: '2.0',
          method: 'initialize',
          params: {
            capabilities: {},
            processId: null,
            rootUri: Langium.URI.file(root).toString(),
            workspaceFolders: null,
          },
        })
        session.accept(new TextEncoder().encode(initialize))
        const response = await waitFor(() => messages.find(message => message.id === 1))
        const capabilities = (response.result as { capabilities?: Record<string, unknown> } | undefined)?.capabilities

        Expect(close).toBe(undefined)
        Expect(capabilities?.['textDocumentSync'] === undefined).toBe(false)
        Expect(capabilities?.['codeActionProvider'] === undefined).toBe(false)
        Expect(capabilities?.['completionProvider'] === undefined).toBe(false)
        Expect(capabilities?.['definitionProvider'] === undefined).toBe(false)
        Expect(capabilities?.['documentFormattingProvider'] === undefined).toBe(false)
        Expect(capabilities?.['hoverProvider'] === undefined).toBe(false)
        Expect(capabilities?.['referencesProvider'] === undefined).toBe(false)

        const uri = Langium.URI.file(paths['Garden.tao']!).toString()
        session.accept(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }))
        session.accept(JSON.stringify({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              languageId: 'tao',
              text: 'app Garden { view MainView }\nview MainView() { }\n',
              uri,
              version: 0,
            },
          },
        }))
        session.accept(JSON.stringify({
          id: 2,
          jsonrpc: '2.0',
          method: 'textDocument/formatting',
          params: {
            options: { insertSpaces: true, tabSize: 2 },
            textDocument: { uri },
          },
        }))
        const formatting = await waitFor(() => messages.find(message => message.id === 2))
        Expect(Array.isArray(formatting.result)).toBe(true)
      } finally {
        session.close()
      }
    },
  )
})

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  return await until(read, { description: 'a Studio LSP response', timeoutMs: 5_000 }) as T
}
