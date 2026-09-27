import { Errors, FS } from '@shared'
import { Deferred, Expect, mkTestDir, Test } from '@shared/test'
import { runInstantReview } from '../dev-cli-src/instantdb/InstantReviewCommand'

type Environment = NonNullable<Parameters<typeof runInstantReview>[1]>

const APP_ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b'
const TOKEN = 'private-admin-token'
const SOURCE = [
  'app AuthReviewInstant = AuthReview with {',
  '   Auth InstantAuth { AppId "REPLACE_WITH_INSTANT_APP_ID" }',
  '   Datasource InstantDB { AppId "REPLACE_WITH_INSTANT_APP_ID" }',
  '}',
].join('\n')

type Run = { args: readonly string[]; env?: Readonly<Record<string, string>>; captureOutput: boolean; source: string }

async function fixture() {
  const root = await mkTestDir('instant-review-')
  const runs: Run[] = []
  const output: string[] = []
  const stops: string[] = []
  const handlers = new Map<string, () => void>()
  const exitCodes: Record<string, number> = { instantdb: 0, dev: 0 }
  const environment: Environment = {
    secrets: async () => ({ AUTH_REVIEW_INSTANT_APP_ID: APP_ID, AUTH_REVIEW_INSTANT_ADMIN_TOKEN: TOKEN }),
    source: async () => SOURCE,
    project: async () => root,
    writeOwnership: FS.writeJson,
    runTao: (args, options) => {
      const entry = args[args[0] === 'dev' ? 1 : 2]!
      return {
        result: (async () => {
          runs.push({ ...options, args, source: await FS.readText(entry) })
          // A push that echoes both values proves the command redacts what its child prints.
          return { exitCode: exitCodes[args[0]!]!, output: `InstantDB app ${APP_ID} with ${TOKEN}\n` }
        })(),
        stop: signal => {
          stops.push(signal)
        },
      }
    },
    write: message => {
      output.push(message)
    },
    onSignal: (signal, handler) => {
      handlers.set(signal, handler)
      return () => {
        handlers.delete(signal)
      }
    },
  }
  return { root, runs, output, stops, handlers, exitCodes, environment }
}

Test('review pushes with the token only in the push child, then runs tao dev on the substituted copy', async () => {
  const f = await fixture()
  Expect(await runInstantReview({ device: 'roPhone' }, f.environment)).toBe(0)
  Expect(f.runs.map(run => run.args.filter(arg => !arg.endsWith('.tao')))).toEqual([
    ['instantdb', 'push', '--app', 'AuthReviewInstant'],
    ['dev', '--app', 'AuthReviewInstant', '--device', 'roPhone'],
  ])
  Expect(f.runs[0]!.env).toEqual({ INSTANT_APP_ADMIN_TOKEN: TOKEN })
  Expect(f.runs[0]!.captureOutput).toBe(true)
  Expect(f.runs[1]!.env).toBeUndefined()
  Expect(f.runs[1]!.captureOutput).toBe(false)
  Expect(f.runs[1]!.source.split(APP_ID).length - 1).toBe(2)
  Expect(f.runs[1]!.source).not.toContain('REPLACE_WITH_INSTANT_APP_ID')
  Expect(f.runs[1]!.source).not.toContain(TOKEN)
  const printed = f.output.join('\n')
  Expect(printed).toContain('3f2a9c1e…')
  Expect(printed).not.toContain(APP_ID)
  Expect(printed).not.toContain(TOKEN)
  Expect(await FS.exists(f.root)).toBe(false)
  Expect(f.handlers.size).toBe(0)
})

Test('dry run plans the push and starts no dev loop', async () => {
  const f = await fixture()
  Expect(await runInstantReview({ dryRun: true }, f.environment)).toBe(0)
  Expect(f.runs.map(run => run.args[0])).toEqual(['instantdb'])
  Expect(f.runs[0]!.args).toContain('--dry-run')
  Expect(await FS.exists(f.root)).toBe(false)
})

Test('force reaches the push and not the dev loop', async () => {
  const f = await fixture()
  Expect(await runInstantReview({ force: true, device: 'roPhone' }, f.environment)).toBe(0)
  Expect(f.runs.map(run => [run.args[0], run.args.includes('--force')])).toEqual([['instantdb', true], ['dev', false]])
})

Test('skip push starts tao dev directly and forwards the simulator and web targets', async () => {
  const f = await fixture()
  Expect(await runInstantReview({ skipPush: true, ios: true, web: true }, f.environment)).toBe(0)
  Expect(f.runs.map(run => run.args.filter(arg => !arg.endsWith('.tao')))).toEqual([
    ['dev', '--app', 'AuthReviewInstant', '--ios', '--web'],
  ])
})

Test('a failed push returns its exit code, skips tao dev, and removes the copy', async () => {
  const f = await fixture()
  f.exitCodes['instantdb'] = 2
  Expect(await runInstantReview({}, f.environment)).toBe(2)
  Expect(f.runs.map(run => run.args[0])).toEqual(['instantdb'])
  Expect(f.output.join('\n')).toContain('push to Instant app 3f2a9c1e… failed')
  Expect(await FS.exists(f.root)).toBe(false)
  Expect(f.handlers.size).toBe(0)
})

Test('a child failure is reported by stage without its private message', async () => {
  const f = await fixture()
  f.environment.runTao = () => ({ result: Errors.throwHostEnvironment(`${APP_ID} ${TOKEN}`), stop: () => {} })
  Expect(await runInstantReview({}, f.environment)).toBe(1)
  Expect(f.output.join('\n')).toContain('push InstantDB schema and rules')
  Expect(f.output.join('\n')).not.toContain(TOKEN)
  Expect(f.output.join('\n')).not.toContain(APP_ID)
  Expect(await FS.exists(f.root)).toBe(false)
})

Test('interrupting tao dev forwards the signal, waits for it, and cleans up', async () => {
  const f = await fixture()
  const started = Deferred()
  const exited = Deferred<{ exitCode: number; output: string }>()
  const runTao = f.environment.runTao
  f.environment.runTao = (args, options) => {
    if (args[0] !== 'dev') {
      return runTao(args, options)
    }
    started.resolve()
    return {
      result: exited.promise,
      stop: signal => {
        f.stops.push(signal)
        exited.resolve({ exitCode: 130, output: '' })
      },
    }
  }
  const running = runInstantReview({}, f.environment)
  await started.promise
  f.handlers.get('SIGHUP')!()
  Expect(await running).toBe(129)
  Expect(f.stops).toEqual(['SIGTERM'])
  Expect(await FS.exists(f.root)).toBe(false)
  Expect(f.handlers.size).toBe(0)
})

Test('interruption during the push never starts tao dev', async () => {
  const f = await fixture()
  const runTao = f.environment.runTao
  f.environment.runTao = (args, options) => {
    f.handlers.get('SIGINT')!()
    return runTao(args, options)
  }
  Expect(await runInstantReview({}, f.environment)).toBe(130)
  Expect(f.runs.map(run => run.args[0])).toEqual(['instantdb'])
  Expect(await FS.exists(f.root)).toBe(false)
})

Test('missing or malformed credentials fail before preparing a copy, naming keys but never values', async () => {
  const f = await fixture()
  f.environment.project = async () => Errors.throwUnexpected('Must not prepare a project')
  try {
    f.environment.secrets = async () => ({ AUTH_REVIEW_INSTANT_APP_ID: APP_ID })
    await Expect(runInstantReview({}, f.environment)).rejects.toThrow(
      'needs AUTH_REVIEW_INSTANT_ADMIN_TOKEN. Store each with just secrets add <KEY>, then materialize them with just secrets.',
    )
    f.environment.secrets = async () => ({})
    await Expect(runInstantReview({}, f.environment)).rejects.toThrow(
      'AUTH_REVIEW_INSTANT_APP_ID and AUTH_REVIEW_INSTANT_ADMIN_TOKEN',
    )
    f.environment.secrets = async () => ({
      AUTH_REVIEW_INSTANT_APP_ID: 'not-a-uuid-value',
      AUTH_REVIEW_INSTANT_ADMIN_TOKEN: TOKEN,
    })
    const refusal = await runInstantReview({}, f.environment).catch((error: Error) => error.message)
    Expect(refusal).toContain('is not an Instant App ID')
    Expect(refusal).not.toContain('not-a-uuid-value')
    f.environment.secrets = async () => Errors.throwHostEnvironment(TOKEN)
    const unreadable = await runInstantReview({}, f.environment).catch((error: Error) => error.message)
    Expect(unreadable).toContain('run just secrets')
    Expect(unreadable).not.toContain(TOKEN)
    Expect(f.runs).toEqual([])
  } finally {
    await FS.remove(f.root)
  }
})

Test('source that no longer names the placeholder exactly twice is refused', async () => {
  const f = await fixture()
  try {
    f.environment.source = async () => SOURCE.replace('REPLACE_WITH_INSTANT_APP_ID', APP_ID)
    await Expect(runInstantReview({}, f.environment)).rejects.toThrow('found 1')
    Expect(f.runs).toEqual([])
  } finally {
    await FS.remove(f.root)
  }
})

Test('conflicting or empty flags are refused before reading credentials', async () => {
  const f = await fixture()
  f.environment.secrets = async () => Errors.throwUnexpected('Must not load credentials')
  try {
    await Expect(runInstantReview({ device: ' ' }, f.environment)).rejects.toThrow('device name or identifier')
    await Expect(runInstantReview({ dryRun: true, skipPush: true }, f.environment)).rejects.toThrow('pass only one')
    await Expect(runInstantReview({ force: true, skipPush: true }, f.environment)).rejects.toThrow('pass only one')
    await Expect(runInstantReview({ dryRun: true, web: true }, f.environment)).rejects.toThrow('starts no dev loop')
  } finally {
    await FS.remove(f.root)
  }
})
