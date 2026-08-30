import { TaoFormatter } from '@formatter'
import { Langium } from '@parser'
import { Errors, HCI } from '@shared'
import { TaoCodeActionProvider } from '@source-actions/langium-code-actions'
import { LSPWorkspace } from '@workspace'

type CreateConnectionArguments = Parameters<typeof Langium.createConnection>
type LspConnection = NonNullable<Langium.DefaultSharedModuleContext['connection']>
type LspMessageReader = CreateConnectionArguments[1]
type LspMessageWriter = CreateConnectionArguments[2]
type LspReaderCallback = Parameters<LspMessageReader['listen']>[0]
type LspReaderMessage = Parameters<LspReaderCallback>[0]
type LspWriterMessage = Parameters<LspMessageWriter['write']>[0]

export type StudioLspSocket = {
  close: (code?: number, reason?: string) => void
  send: (message: string) => unknown
}

export type StudioLspSession = {
  accept: (message: unknown) => void
  close: () => void
}

/** StudioLsp bridges raw WebSocket frames to the shared Tao Langium LSPWorkspace. */
export const StudioLsp = {
  createSession,
} as const

function createSession(projectRoot: string, socket: StudioLspSocket): StudioLspSession {
  const reader = new StudioLspMessageReader()
  const writer = new StudioLspMessageWriter(socket)
  const connection = Langium.createConnection(Langium.ProposedFeatures.all, reader, writer) as LspConnection
  let active = true

  // The reader buffers frames until startLanguageServer installs its listener, so initialize and any
  // immediately following client notifications preserve their original order while the workspace opens.
  void startLanguageServer(projectRoot, connection, () => active).catch(error => {
    if (!active) {
      return
    }
    HCI.logProcessError('studio-lsp', Errors.formatForLog(error))
    try {
      socket.close(1011, 'Studio LSP failed')
    } catch {
      // The browser may close while project documents are still loading.
    }
  })

  return {
    accept(message) {
      reader.accept(message)
    },
    close() {
      active = false
      // Langium can still finish an in-flight document build after the WebSocket closes. Detaching
      // keeps that work from writing to the socket without marking the protocol connection closed.
      reader.detach()
      writer.detach()
    },
  }
}

async function startLanguageServer(
  projectRoot: string,
  connection: LspConnection,
  isActive: () => boolean,
): Promise<void> {
  const workspace = await LSPWorkspace.open(projectRoot, { connection, ...Langium.NodeFileSystem }, {
    lspCodeActionProvider: () => new TaoCodeActionProvider(),
    lspFormatter: () => new TaoFormatter(),
  })
  if (isActive()) {
    workspace.startLanguageServer()
  }
}

class StudioLspMessageReader implements LspMessageReader {
  readonly #closeEmitter = new Langium.Emitter<void>()
  readonly #errorEmitter = new Langium.Emitter<Error>()
  readonly #partialMessageEmitter = new Langium.Emitter<{ messageToken: number; waitingTime: number }>()
  readonly #pending: LspReaderMessage[] = []
  #callback: LspReaderCallback | undefined
  #closed = false

  get onClose(): LspMessageReader['onClose'] {
    return this.#closeEmitter.event
  }

  get onError(): LspMessageReader['onError'] {
    return this.#errorEmitter.event
  }

  get onPartialMessage(): LspMessageReader['onPartialMessage'] {
    return this.#partialMessageEmitter.event
  }

  listen(callback: LspReaderCallback): ReturnType<LspMessageReader['listen']> {
    this.#callback = callback
    for (const message of this.#pending.splice(0)) {
      callback(message)
    }
    return {
      dispose: () => {
        if (this.#callback === callback) {
          this.#callback = undefined
        }
      },
    }
  }

  accept(rawMessage: unknown): void {
    if (this.#closed) {
      return
    }
    try {
      const message = JSON.parse(messageText(rawMessage)) as LspReaderMessage
      if (this.#callback === undefined) {
        this.#pending.push(message)
      } else {
        this.#callback(message)
      }
    } catch (error) {
      this.#errorEmitter.fire(error instanceof Error ? error : new Error(String(error)))
    }
  }

  close(): void {
    if (this.#closed) {
      return
    }
    this.#closed = true
    this.#pending.length = 0
    this.#closeEmitter.fire(undefined)
  }

  detach(): void {
    this.#closed = true
    this.#pending.length = 0
    this.#callback = undefined
  }

  dispose(): void {
    this.close()
    this.#errorEmitter.dispose()
    this.#closeEmitter.dispose()
    this.#partialMessageEmitter.dispose()
  }
}

class StudioLspMessageWriter implements LspMessageWriter {
  readonly #closeEmitter = new Langium.Emitter<void>()
  readonly #errorEmitter = new Langium.Emitter<[
    Error,
    LspWriterMessage | undefined,
    number | undefined,
  ]>()
  #closed = false
  #errorCount = 0

  constructor(private readonly socket: StudioLspSocket) {}

  get onClose(): LspMessageWriter['onClose'] {
    return this.#closeEmitter.event
  }

  get onError(): LspMessageWriter['onError'] {
    return this.#errorEmitter.event
  }

  async write(message: LspWriterMessage): Promise<void> {
    if (this.#closed) {
      return
    }
    try {
      this.socket.send(JSON.stringify(message))
    } catch (error) {
      this.#errorCount += 1
      const writeError = error instanceof Error ? error : new Error(String(error))
      this.#errorEmitter.fire([writeError, message, this.#errorCount])
      throw writeError
    }
  }

  end(): void {
    if (this.#closed) {
      return
    }
    this.#closed = true
    this.#closeEmitter.fire(undefined)
  }

  detach(): void {
    this.#closed = true
  }

  dispose(): void {
    this.end()
    this.#errorEmitter.dispose()
    this.#closeEmitter.dispose()
  }
}

function messageText(message: unknown): string {
  if (typeof message === 'string') {
    return message
  }
  if (message instanceof ArrayBuffer) {
    return new TextDecoder().decode(message)
  }
  if (ArrayBuffer.isView(message)) {
    const view = message as ArrayBufferView
    return new TextDecoder().decode(new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength))
  }
  return String(message)
}
