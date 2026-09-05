import { CLI, Errors, FS, Repo, Time } from '@shared'
import { randomUUID } from 'node:crypto'
import { AppleFoundationModelsProvider } from './apple-foundation-models-provider'
import type { GenerationProvider } from './generation-contract'
import { UnavailableGenerationProvider } from './unavailable-generation-provider'

const HELPER_SOURCE = 'packages/generation/generation-native/AppleFoundationModelsServer.swift'
const HELPER_BINARY = '.artifacts/build/foundation-models/tao-foundation-models-server'
const SWIFT_CACHE = '.artifacts/cache/swift/foundation-models'
const START_TIMEOUT_MS = 15_000
const MAX_HELPER_OUTPUT_BYTES = 65_536

export type AppleFoundationModelsService = {
  readonly provider: GenerationProvider
  stop(): Promise<void>
}

/** startAppleFoundationModelsService compiles and supervises the stable Swift localhost helper. */
export async function startAppleFoundationModelsService(): Promise<AppleFoundationModelsService> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    return unavailableService('Apple Foundation Models requires an Apple Silicon Mac.')
  }

  const binary = Repo.resolvePath(HELPER_BINARY)
  const source = Repo.resolvePath(HELPER_SOURCE)
  const moduleCache = Repo.resolvePath(SWIFT_CACHE)
  await FS.mkdir(FS.dirname(binary))
  await FS.mkdir(moduleCache)
  if (await helperNeedsCompilation(source, binary)) {
    const compiled = await CLI.run('xcrun', {
      args: [
        'swiftc',
        '-parse-as-library',
        '-O',
        '-module-cache-path',
        moduleCache,
        source,
        '-o',
        binary,
      ],
    })
    if (compiled.exitCode !== 0) {
      return unavailableService(
        `Foundation Models helper did not compile: ${compiled.stderr.trim() || compiled.stdout.trim()}`,
      )
    }
  }

  const token = randomUUID()
  let stdout = ''
  let stderr = ''
  let helperFailure: string | undefined
  let readyPort: number | undefined
  let ready: ((port: number) => void) | undefined
  let fail: ((error: Error) => void) | undefined
  const readiness = new Promise<number>((resolve, reject) => {
    ready = resolve
    fail = reject
  })
  const child = CLI.start(binary, {
    args: ['--port', '0'],
    stdin: `${token}\n`,
    onOutput: (stream, chunk) => {
      if (stream === 'stderr') {
        stderr = appendBounded(stderr, String(chunk))
        return
      }
      if (readyPort === undefined && Buffer.byteLength(stdout + String(chunk), 'utf8') > MAX_HELPER_OUTPUT_BYTES) {
        fail?.(new Error('Foundation Models helper exceeded its startup output limit.'))
        return
      }
      stdout = appendBounded(stdout, String(chunk))
      if (readyPort === undefined) {
        const newline = stdout.indexOf('\n')
        if (newline < 0) {
          return
        }
        const line = stdout.slice(0, newline)
        const trailing = stdout.slice(newline + 1)
        const match = /^READY ([1-9]\d{0,4})$/.exec(line)
        const port = match?.[1] === undefined ? 0 : Number(match[1])
        if (port <= 0 || port > 65_535 || trailing.length > 0) {
          fail?.(new Error(`Foundation Models helper returned invalid startup output: ${JSON.stringify(stdout)}`))
          return
        }
        readyPort = port
        ready?.(port)
      }
    },
  })
  child.onceError(error => fail?.(error))
  child.onceClose((exitCode, signal) => {
    const reason = helperExitMessage(exitCode, signal, stderr)
    if (readyPort === undefined) {
      fail?.(new Error(reason))
    } else {
      helperFailure = reason
    }
  })

  try {
    const port = await Promise.race([
      readiness,
      Time.sleep(START_TIMEOUT_MS).then(() => {
        Errors.throwHostEnvironment(`Foundation Models helper did not start within ${START_TIMEOUT_MS}ms. ${stderr}`)
      }),
    ])
    return {
      provider: new AppleFoundationModelsProvider({
        helperFailure: () => helperFailure,
        token,
        url: `http://127.0.0.1:${port}`,
      }),
      async stop() {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM')
        }
        await child.waitForClose()
        await child.closeOutput()
      },
    }
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
    }
    await child.waitForClose()
    await child.closeOutput()
    return unavailableService(Errors.messageOf(error))
  }
}

function unavailableService(reason: string): AppleFoundationModelsService {
  return {
    provider: new UnavailableGenerationProvider(reason),
    async stop() {},
  }
}

async function helperNeedsCompilation(source: string, binary: string): Promise<boolean> {
  if (!await FS.isFile(binary)) {
    return true
  }
  return await FS.modifiedTimeMs(source) > await FS.modifiedTimeMs(binary)
}

function helperExitMessage(exitCode: number | null, signal: string | null, stderr: string): string {
  const detail = stderr.trim()
  return `Foundation Models helper exited: code=${exitCode} signal=${signal}.${detail.length > 0 ? ` ${detail}` : ''}`
}

function appendBounded(current: string, chunk: string): string {
  const combined = Buffer.from(current + chunk, 'utf8')
  if (combined.byteLength <= MAX_HELPER_OUTPUT_BYTES) {
    return combined.toString('utf8')
  }
  return combined.subarray(combined.byteLength - MAX_HELPER_OUTPUT_BYTES).toString('utf8')
}
