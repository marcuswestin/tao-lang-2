import { CLI, Errors, FS, HCI, Platform, Repo, SecretsFile } from '@shared'

const APP_NAME = 'AuthReviewInstant'
/** The variant signed in through Clerk, which InstantDB verifies with the app's registered Clerk client. */
const CLERK_APP_NAME = 'AuthReviewInstantClerk'
const PUBLISHABLE_KEY_SECRET = 'CLERK_PUBLISHABLE_KEY'
const PUBLISHABLE_KEY_PLACEHOLDER = 'pk_test_REPLACE_WITH_YOUR_KEY'
const APP_ID_SECRET = 'AUTH_REVIEW_INSTANT_APP_ID'
const TOKEN_SECRET = 'AUTH_REVIEW_INSTANT_ADMIN_TOKEN'
/** The variable `tao instantdb push` reads its admin token from. */
const PUSH_TOKEN_VARIABLE = 'INSTANT_APP_ADMIN_TOKEN'
const PLACEHOLDER = 'REPLACE_WITH_INSTANT_APP_ID'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ReviewOptions = {
  clerk?: boolean
  device?: string
  ios?: boolean
  web?: boolean
  dryRun?: boolean
  force?: boolean
  skipPush?: boolean
}
type TaoRunOptions = { env?: Readonly<Record<string, string>>; captureOutput: boolean }
type TaoChild = {
  result: Promise<{ exitCode: number; output: string }>
  stop: (signal: Platform.ProcessSignal) => void
}
type ReviewEnvironment = {
  secrets: typeof SecretsFile.readDecryptedSecrets
  source: () => Promise<string>
  project: () => Promise<string>
  writeOwnership: (path: string, ownership: Record<string, unknown>) => Promise<void>
  runTao: (args: readonly string[], options: TaoRunOptions) => TaoChild
  write: (message: string) => void
  onSignal: typeof Platform.onProcessSignal
}

function liveEnvironment(): ReviewEnvironment {
  return {
    secrets: SecretsFile.readDecryptedSecrets,
    source: async () => await FS.readText(Repo.resolvePath('Apps/Test Apps/Auth Review/Auth Review.tao')),
    // Source discovery honors Git ignores, so this source cannot live under .artifacts.
    project: async () => await FS.mkTmpDir('tao-instant-review-'),
    writeOwnership: FS.writeJson,
    runTao: (args, options) => {
      const chunks: Buffer[] = []
      // The server policy signals only the direct child, so the dev loop's own SIGINT/SIGTERM
      // teardown runs instead of an escalation to SIGKILL.
      const child = CLI.start(Repo.resolvePath('tao'), {
        args,
        cwd: Repo.getRoot(),
        env: options.env,
        stdio: options.captureOutput ? 'pipe' : 'inherit',
        processPolicy: 'server',
        onOutput: (_stream, chunk) => {
          chunks.push(chunk)
        },
      })
      return {
        result: child.waitForClose().then(({ exitCode }) => ({
          exitCode: exitCode ?? 1,
          output: Buffer.concat(chunks).toString('utf8'),
        })),
        stop: signal => {
          child.kill(signal)
        },
      }
    },
    write: message => HCI.writeLine(message),
    onSignal: Platform.onProcessSignal,
  }
}

/**
 * Own a foreground Auth Review against the Developer's Instant Cloud app. The App ID is written only
 * into a disposable copy of the source, the admin token only into the push child's environment, and
 * output names the app by a short fingerprint of its ID. `clerk` runs the variant signed in through
 * Clerk, with the stored publishable key written into the same copy.
 */
export async function runInstantReview(
  options: ReviewOptions = {},
  environment: ReviewEnvironment = liveEnvironment(),
): Promise<number> {
  if (options.device !== undefined && options.device.trim() === '') {
    Errors.throwUserInput('--device requires a device name or identifier.')
  }
  const targets = [
    ...(options.device === undefined ? [] : ['--device', options.device]),
    ...(options.ios === true ? ['--ios'] : []),
    ...(options.web === true ? ['--web'] : []),
  ]
  if (options.dryRun === true && options.skipPush === true) {
    Errors.throwUserInput('--dry-run plans the push and --skip-push skips it; pass only one.')
  }
  if (options.force === true && options.skipPush === true) {
    Errors.throwUserInput('--force forces the push and --skip-push skips it; pass only one.')
  }
  if (options.dryRun === true && targets.length > 0) {
    Errors.throwUserInput('--dry-run only plans the push and starts no dev loop; drop --device, --ios, and --web.')
  }
  const appName = options.clerk === true ? CLERK_APP_NAME : APP_NAME
  const { appId, publishableKey, token } = await loadCredentials(environment, options.clerk === true)
  const fingerprint = appId.slice(0, 8)
  const source = await environment.source()
  const placeholders = source.split(PLACEHOLDER).length - 1
  if (placeholders !== 2) {
    Errors.throwUnexpected(
      `Auth Review must name ${PLACEHOLDER} exactly twice (Auth and Datasource of ${APP_NAME}); found ${placeholders}.`,
    )
  }
  if (publishableKey !== undefined && !source.includes(PUBLISHABLE_KEY_PLACEHOLDER)) {
    Errors.throwUnexpected(`Auth Review must name ${PUBLISHABLE_KEY_PLACEHOLDER} in ${CLERK_APP_NAME}.`)
  }
  const redact = (text: string) => text.replaceAll(token, '[admin token]').replaceAll(appId, `${fingerprint}…`)

  let stage = 'prepare disposable Auth Review project'
  let projectRoot: string | undefined
  let running: TaoChild | undefined
  let signalCode: number | undefined
  const removeSignals = (['SIGHUP', 'SIGINT', 'SIGTERM'] as const).map((signal, index) =>
    environment.onSignal(signal, () => {
      signalCode = [129, 130, 143][index]
      // The dev loop tears down Metro on SIGINT and SIGTERM; SIGHUP would kill it without that.
      running?.stop(signal === 'SIGHUP' ? 'SIGTERM' : signal)
    })
  )
  const checkpoint = () => {
    if (signalCode !== undefined) {
      Errors.throwHostEnvironment('Instant review was cancelled.')
    }
  }
  const run = async (args: readonly string[], runOptions: TaoRunOptions) => {
    checkpoint()
    // Assigned synchronously after the checkpoint, so a signal either cancels or reaches the child.
    running = environment.runTao(args, runOptions)
    try {
      return await running.result
    } finally {
      running = undefined
    }
  }
  const ownershipPath = Repo.resolvePath(`.artifacts/auth/instant-review/${Platform.randomUUID()}.json`)
  let ownership: Record<string, unknown> | undefined
  let exitCode = 1
  try {
    projectRoot = await environment.project()
    await FS.chmod(projectRoot, 0o700)
    ownership = {
      path: projectRoot,
      owner: 'instant-review',
      purpose: 'Disposable Auth Review source naming the Instant Cloud app',
      cleanup: 'Removed when the foreground review exits.',
      appIdFingerprint: fingerprint,
      state: 'active',
    }
    await environment.writeOwnership(ownershipPath, ownership)
    const entryPath = FS.resolvePath('Auth Review.tao', projectRoot)
    const substituted = source.replaceAll(PLACEHOLDER, appId)
    await FS.writeText(
      entryPath,
      publishableKey === undefined
        ? substituted
        : substituted.replaceAll(PUBLISHABLE_KEY_PLACEHOLDER, publishableKey),
    )
    await FS.writeText(
      FS.resolvePath('Project.tao', projectRoot),
      'project { id "tao-instant-review" name "Instant review" }\n',
    )
    environment.write(`Instant review: ${appName} against Instant app ${fingerprint}…`)
    if (options.skipPush !== true) {
      stage = options.dryRun === true ? 'plan InstantDB push' : 'push InstantDB schema and rules'
      const pushed = await run(
        [
          'instantdb',
          'push',
          entryPath,
          '--app',
          appName,
          ...(options.dryRun === true ? ['--dry-run'] : []),
          ...(options.force === true ? ['--force'] : []),
        ],
        { env: { [PUSH_TOKEN_VARIABLE]: token }, captureOutput: true },
      )
      const output = redact(pushed.output).trimEnd()
      if (output !== '') {
        environment.write(output)
      }
      if (pushed.exitCode !== 0) {
        environment.write(`Instant review stopped: the push to Instant app ${fingerprint}… failed.`)
        exitCode = pushed.exitCode
        return signalCode ?? exitCode
      }
    }
    if (options.dryRun === true) {
      exitCode = 0
      return signalCode ?? exitCode
    }
    environment.write('Press Ctrl+C to stop the dev loop and remove this review project.')
    stage = 'run tao dev'
    exitCode = (await run(['dev', entryPath, '--app', appName, ...targets], { captureOutput: false })).exitCode
  } catch {
    if (signalCode === undefined) {
      // Child and filesystem failures can embed the App ID or token.
      environment.write(`Instant review failed during: ${stage}. Private error details were omitted.`)
    }
  } finally {
    let cleanupFailed = false
    try {
      if (projectRoot !== undefined) {
        await FS.remove(projectRoot)
      }
    } catch {
      exitCode = 1
      cleanupFailed = true
      environment.write(`Instant review cleanup failed; inspect the ownership record at ${ownershipPath}.`)
    }
    try {
      if (ownership !== undefined) {
        await environment.writeOwnership(ownershipPath, {
          ...ownership,
          state: cleanupFailed || await FS.exists(projectRoot!) ? 'cleanup-required' : 'removed',
        })
      }
    } catch {
      exitCode = 1
      environment.write(
        `Instant review could not finalize its ownership record at ${ownershipPath}; private error details were omitted.`,
      )
    } finally {
      for (const remove of removeSignals) {
        remove()
      }
    }
  }
  return signalCode ?? exitCode
}

async function loadCredentials(
  environment: ReviewEnvironment,
  clerk: boolean,
): Promise<{ appId: string; publishableKey: string | undefined; token: string }> {
  let stored: Record<string, string>
  try {
    stored = await environment.secrets()
  } catch {
    Errors.throwHostEnvironment('Could not read the materialized secrets; run just secrets and retry.')
  }
  const appId = stored[APP_ID_SECRET]?.trim() ?? ''
  const token = stored[TOKEN_SECRET]?.trim() ?? ''
  const publishableKey = clerk ? stored[PUBLISHABLE_KEY_SECRET]?.trim() ?? '' : undefined
  const required: [string, string][] = [
    [APP_ID_SECRET, appId],
    [TOKEN_SECRET, token],
    ...(publishableKey === undefined ? [] : [[PUBLISHABLE_KEY_SECRET, publishableKey] as [string, string]]),
  ]
  const missing = required.filter(([, value]) => value === '').map(([name]) => name)
  if (missing.length > 0) {
    Errors.throwUserInput(
      `Instant review needs ${
        new Intl.ListFormat('en', { type: 'conjunction' }).format(missing)
      }. Store each with just secrets add <KEY>, then materialize them with just secrets.`,
    )
  }
  if (!UUID.test(appId)) {
    Errors.throwUserInput(
      `${APP_ID_SECRET} is not an Instant App ID (a UUID). Store it again with just secrets add ${APP_ID_SECRET}, then run just secrets.`,
    )
  }
  if (publishableKey !== undefined) {
    // Auth Review runs against a development instance only, as the Clerk review does.
    const decoded = publishableKey.startsWith('pk_test_')
      ? Buffer.from(publishableKey.slice(8), 'base64').toString('utf8')
      : ''
    if (!/^[a-z0-9-]+\.clerk\.accounts\.dev\$$/.test(decoded)) {
      Errors.throwUserInput(
        `${PUBLISHABLE_KEY_SECRET} is not a development Clerk publishable key. Configure Clerk with just setup-clerk, then run just secrets.`,
      )
    }
  }
  return { appId, publishableKey, token }
}
