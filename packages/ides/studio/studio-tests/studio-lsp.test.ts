import { Langium } from '@parser'
import { Expect, Test, until, withTaoFiles } from '@shared/test'
import { StudioLsp } from '../studio-src/StudioLsp'

Test('Studio LSP accepts binary and string frames for initialize and formatting', async () => {
  await withTaoFiles(
    'tao-studio-lsp-',
    {
      'Garden.tao': `
        use Text from @tao/ui
        app Garden { id "garden" version "1.0.0" name "Garden" view MainView }
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
        Expect(capabilities?.['documentFormattingProvider'] === undefined).toBe(false)

        const uri = Langium.URI.file(paths['Garden.tao']!).toString()
        session.accept(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }))
        session.accept(JSON.stringify({
          jsonrpc: '2.0',
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              languageId: 'tao',
              text: 'app Garden { id "garden" version "1.0.0" name "Garden" view MainView }\nview MainView() { }\n',
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

// A character typed and deleted at the end of a file: the editor syncs the shorter text before the
// diagnostics for the longer one arrive, and only their version lets it discard them instead of
// mapping a position one past its end.
Test('Studio LSP labels diagnostics with the document version they were computed from', async () => {
  const source = 'use Text from @tao/ui\napp Garden { id "garden" version "1.0.0" name "Garden" view MainView }\n'
    + 'view MainView() { render Text("Hello") }\n'
  await withTaoFiles('tao-studio-lsp-versions-', { 'Garden.tao': source }, async (paths, root) => {
    type Publication = { method?: string; params?: { diagnostics: Diagnostic[]; uri: string; version?: number } }
    type Diagnostic = { range: { end: Position; start: Position } }
    type Position = { character: number; line: number }
    const messages: Publication[] = []
    const session = StudioLsp.createSession(root, {
      close() {},
      send(message) {
        messages.push(JSON.parse(message) as Publication)
      },
    })
    try {
      const uri = Langium.URI.file(paths['Garden.tao']!).toString()
      const texts = [source, `${source}x`, source]
      session.accept(JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          capabilities: {},
          processId: null,
          rootUri: Langium.URI.file(root).toString(),
          workspaceFolders: null,
        },
      }))
      await waitFor(() => messages.find(message => (message as { id?: number }).id === 1))
      session.accept(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }))
      session.accept(JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: { textDocument: { languageId: 'tao', text: texts[0], uri, version: 0 } },
      }))
      for (const version of [1, 2]) {
        session.accept(JSON.stringify({
          jsonrpc: '2.0',
          method: 'textDocument/didChange',
          params: { contentChanges: [{ text: texts[version] }], textDocument: { uri, version } },
        }))
      }
      const publications = () =>
        messages.flatMap(message =>
          message.method === 'textDocument/publishDiagnostics' && message.params?.uri === uri ? [message.params] : []
        )
      await waitFor(() => publications().find(publication => publication.version === 2))

      for (const publication of publications()) {
        Expect(typeof publication.version).toBe('number')
        const lines = texts[publication.version!]!.split('\n')
        for (const { range } of publication.diagnostics) {
          for (const position of [range.start, range.end]) {
            Expect(position.character).toBeLessThanOrEqual(lines[position.line]?.length ?? -1)
          }
        }
      }
    } finally {
      session.close()
    }
  })
})

async function waitFor<T>(read: () => T | undefined): Promise<T> {
  return await until(read, { description: 'a Studio LSP response', timeoutMs: 30_000 }) as T
}
