import { CLI, FS, Repo, Time } from '@shared'
import { randomUUID } from 'node:crypto'
import { AppleFoundationModelsProvider } from './apple-foundation-models-provider'
import type { GenerationAvailability, GenerationProvider, GenerationRun, JsonValue } from './generation-contract'

const HELPER_SOURCE = 'packages/generation/generation-native/AppleFoundationModelsServer.swift'
const HELPER_BINARY = '.artifacts/build/foundation-models/tao-foundation-models-server'
const SWIFT_CACHE = '.artifacts/cache/swift/foundation-models'
const START_TIMEOUT_MS = 15_000

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

  const token = randomUUID()
  let output = ''
  let ready: ((port: number) => void) | undefined
  let fail: ((error: Error) => void) | undefined
  const readiness = new Promise<number>((resolve, reject) => {
    ready = resolve
    fail = reject
  })
  const child = CLI.start(binary, {
    args: ['--port', '0', '--token', token],
    onOutput: (_stream, chunk) => {
      output += String(chunk)
      const match = output.match(/(?:^|\n)READY (\d+)(?:\n|$)/)
      if (match?.[1]) {
        ready?.(Number(match[1]))
      }
    },
  })
  child.onceError(error => fail?.(error))
  child.onceClose((exitCode, signal) => {
    fail?.(new Error(`Foundation Models helper exited before ready: code=${exitCode} signal=${signal}. ${output}`))
  })

  try {
    const port = await Promise.race([
      readiness,
      Time.sleep(START_TIMEOUT_MS).then(() => {
        throw new Error(`Foundation Models helper did not start within ${START_TIMEOUT_MS}ms. ${output}`)
      }),
    ])
    return {
      provider: new AppleFoundationModelsProvider({ token, url: `http://127.0.0.1:${port}` }),
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
    return unavailableService(errorMessage(error))
  }
}

function unavailableService(reason: string): AppleFoundationModelsService {
  return {
    provider: new UnavailableGenerationProvider(reason),
    async stop() {},
  }
}

export class UnavailableGenerationProvider implements GenerationProvider {
  constructor(readonly reason: string) {}

  async availability(): Promise<GenerationAvailability> {
    return { status: 'unavailable', reason: this.reason }
  }

  generate<Value extends JsonValue>(): GenerationRun<Value> {
    return {
      partials: empty(),
      final: Promise.resolve({ status: 'failure', code: 'model_unavailable', message: this.reason }),
    }
  }
}

async function* empty(): AsyncIterable<never> {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
