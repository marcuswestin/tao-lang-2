import { Langium } from '@parser'
import { CLI, Errors, FS, Platform, ProjectIdentity } from '@shared'
import { Expect, Test, until, withTaoFiles } from '@shared/test'

type LspMessage = {
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { message: string }
}

type Diagnostic = { message: string; severity?: number }

Test('packaged language server serves hover, definition, and Tao diagnostics over LSP', async () => {
  await withTaoFiles(
    'tao-packaged-lsp-',
    {
      'Definitions.tao': `
        /** A greeting declared in another Tao file. */
        project let Greeting = "Hello"
      `,
      'Main.tao': `
        use Greeting from ./Definitions
        let Caption = Greeting
        let Broken = Missing
      `,
    },
    async (paths, root) => {
      Expect(ProjectIdentity.read(root)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
      const bundle = FS.resolvePath('../_gen_ide-extension/language/main.cjs', import.meta.dir)
      Expect(await FS.isFile(bundle)).toBe(true)
      const node = await CLI.commandPath('node')
      Expect(node).toBeDefined()

      const messages: LspMessage[] = []
      let pending = Buffer.alloc(0)
      let stderr = ''
      let protocolError: string | undefined
      const env: Platform.ProcessEnv = { ...Platform.runtimeProcess.env, TAO_WORKSPACE_ROOT: root }
      delete env['TAO_STDLIB_ROOT']
      delete env['TAO_RESOURCES']
      const child = CLI.start(node!, {
        args: [bundle, '--stdio'],
        cwd: root,
        env,
        processPolicy: 'server',
        stdio: ['pipe', 'pipe', 'pipe'],
        onOutput(stream, chunk) {
          if (stream === 'stderr') {
            stderr += chunk.toString('utf8')
            return
          }
          pending = Buffer.concat([pending, chunk])
          while (true) {
            const headerEnd = pending.indexOf('\r\n\r\n')
            if (headerEnd < 0) {
              return
            }
            const header = pending.subarray(0, headerEnd).toString('utf8')
            const length = /^Content-Length:\s*(\d+)\s*$/im.exec(header)
            if (!length) {
              protocolError = `Unframed language-server output: ${header}`
              return
            }
            const bodyStart = headerEnd + 4
            const bodyEnd = bodyStart + Number(length[1])
            if (pending.length < bodyEnd) {
              return
            }
            messages.push(JSON.parse(pending.subarray(bodyStart, bodyEnd).toString('utf8')) as LspMessage)
            pending = pending.subarray(bodyEnd)
          }
        },
      })

      const send = (message: LspMessage): void => {
        const body = JSON.stringify({ jsonrpc: '2.0', ...message })
        Expect(child.writeStdin(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)).toBe(true)
      }
      const waitFor = async <T>(description: string, read: () => T | undefined): Promise<T> =>
        await until(() => {
          if (protocolError) {
            Errors.throwUnexpected(protocolError)
          }
          if (child.error || child.exitCode !== null) {
            Errors.throwHostEnvironment(`Packaged language server exited before ${description}: ${stderr}`)
          }
          return read()
        }, { description, timeoutMs: 30_000 }) as T
      const response = async (id: number): Promise<LspMessage> =>
        await waitFor(`packaged language-server response ${id}`, () => messages.find(message => message.id === id))

      try {
        const mainUri = Langium.URI.file(paths['Main.tao']).toString()
        const definitionUri = Langium.URI.file(paths['Definitions.tao']).toString()
        send({
          id: 1,
          method: 'initialize',
          params: {
            capabilities: {},
            processId: null,
            rootUri: Langium.URI.file(root).toString(),
            workspaceFolders: null,
          },
        })
        const initialized = await response(1)
        Expect(initialized.error).toBeUndefined()
        const capabilities = (initialized.result as { capabilities?: Record<string, unknown> }).capabilities
        Expect(capabilities?.['hoverProvider']).toBeTruthy()
        Expect(capabilities?.['definitionProvider']).toBeTruthy()

        send({ method: 'initialized', params: {} })
        send({
          method: 'textDocument/didOpen',
          params: {
            textDocument: {
              languageId: 'tao',
              text: await FS.readText(paths['Main.tao']),
              uri: mainUri,
              version: 1,
            },
          },
        })
        const diagnosticPublication = await waitFor('a packaged Tao diagnostic', () =>
          messages.find(message => {
            if (message.method !== 'textDocument/publishDiagnostics') {
              return undefined
            }
            const params = message.params as { uri: string; diagnostics: Diagnostic[] }
            return params.uri === mainUri
              && params.diagnostics.some(diagnostic => diagnostic.message.includes('Missing'))
          }))
        const diagnostics = (diagnosticPublication.params as { diagnostics: Diagnostic[] }).diagnostics
        Expect(diagnostics.some(diagnostic => diagnostic.severity === 1 && diagnostic.message.includes('Missing')))
          .toBe(true)

        const position = { line: 1, character: 16 }
        send({ id: 2, method: 'textDocument/hover', params: { textDocument: { uri: mainUri }, position } })
        const hover = await response(2)
        Expect(hover.error).toBeUndefined()
        Expect(JSON.stringify(hover.result)).toContain('A greeting declared in another Tao file.')

        send({ id: 3, method: 'textDocument/definition', params: { textDocument: { uri: mainUri }, position } })
        const definition = await response(3)
        Expect(definition.error).toBeUndefined()
        Expect(JSON.stringify(definition.result)).toContain(definitionUri)
      } finally {
        child.kill()
        await child.waitForClose()
        child.dispose()
      }
    },
  )
})
