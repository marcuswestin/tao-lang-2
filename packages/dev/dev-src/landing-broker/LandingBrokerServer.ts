import { CLI, Errors, FS, HCI, LocalSocket, Platform } from '@shared'
import {
  archiveBranch,
  isCommitSha,
  isInspectableBranch,
  isLandableBranch,
  LANDING_BROKER_HOST,
  LANDING_BROKER_VERSION,
  type LandingBrokerConfig,
  type LandingBrokerPushRequest,
  type LandingBrokerRepository,
  type LandingBrokerRequest,
  type LandingBrokerResponse,
} from './LandingBrokerProtocol'

const MAIN_BRANCH = 'main'

/** runLandingBroker serves the installed, credential-bearing half of Tao's landing protocol. */
async function runLandingBroker(configPath: string): Promise<void> {
  const config = await readConfig(configPath)
  const server = await LocalSocket.serve<LandingBrokerRequest, LandingBrokerResponse>(
    { host: config.host, port: config.port },
    async request => await handleLandingBrokerRequest(config, request),
  )
  HCI.writeLine(`Tao landing broker listening at ${config.host}:${config.port}.`)

  await new Promise<void>(resolve => {
    const stop = () => resolve()
    Platform.onProcessSignal('SIGINT', stop)
    Platform.onProcessSignal('SIGTERM', stop)
  })
  await server.close()
  Platform.runtimeProcess.exit(0)
}

if (import.meta.main) {
  const [, , command, configPath] = Platform.runtimeProcess.argv
  if (command !== 'serve' || configPath === undefined) {
    HCI.writeErrorLine('Usage: tao-landing-broker serve <config-path>')
    Platform.runtimeProcess.exit(2)
  }
  try {
    await runLandingBroker(configPath as string)
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.exit(1)
  }
}

/** handleLandingBrokerRequest is the policy boundary shared by the socket server and integration test. */
export async function handleLandingBrokerRequest(
  config: LandingBrokerConfig,
  request: LandingBrokerRequest,
): Promise<LandingBrokerResponse> {
  if (!isObject(request) || request.version !== LANDING_BROKER_VERSION || typeof request.operation !== 'string') {
    return { error: 'Unsupported landing-broker request.', ok: false }
  }
  if (request.operation === 'ping') {
    return { ok: true, operation: 'ping' }
  }
  const repository = await registeredRepository(config, request.repositoryGitDir)
  if (request.operation === 'inspect') {
    if (!Array.isArray(request.branches) || request.branches.length === 0 || request.branches.length > 4) {
      return { error: 'Inspect requests must name between one and four branches.', ok: false }
    }
    if (request.branches.some(branch => typeof branch !== 'string' || !isInspectableBranch(branch))) {
      return { error: 'Inspect request contains a branch outside the landing policy.', ok: false }
    }
    return { ok: true, operation: 'inspect', refs: await refreshRemoteRefs(config, repository, request.branches) }
  }
  if (request.operation === 'push') {
    return { ok: true, operation: 'push', refs: await pushLanding(config, repository, request) }
  }
  return { error: 'Unknown landing-broker operation.', ok: false }
}

async function registeredRepository(
  config: LandingBrokerConfig,
  requestedGitDir: string,
): Promise<LandingBrokerRepository> {
  if (typeof requestedGitDir !== 'string' || !FS.isAbsolute(requestedGitDir)) {
    Errors.throwUserInput('Landing requests must name an absolute Git common directory.')
  }
  const canonical = await FS.realPath(requestedGitDir).catch(() => FS.resolvePath(requestedGitDir))
  const repository = config.repositories.find(candidate => candidate.gitCommonDir === canonical)
  if (repository === undefined) {
    Errors.throwUserInput(`The landing broker is not registered for ${canonical}.`)
  }
  return repository
}

async function refreshRemoteRefs(
  config: LandingBrokerConfig,
  repository: LandingBrokerRepository,
  branches: readonly string[],
): Promise<Record<string, string>> {
  const refs = await readRemoteRefs(config, repository, branches)
  const presentBranches = branches.filter(branch => refs[branch] !== undefined)
  if (presentBranches.length > 0) {
    await git(config, repository, [
      'fetch',
      '--quiet',
      '--no-tags',
      repository.remoteUrl,
      ...presentBranches.map(branch => `+refs/heads/${branch}:refs/tao-landing/${branch}`),
    ])
  }
  return refs
}

async function readRemoteRefs(
  config: LandingBrokerConfig,
  repository: LandingBrokerRepository,
  branches: readonly string[],
): Promise<Record<string, string>> {
  const result = await git(config, repository, [
    'ls-remote',
    '--heads',
    repository.remoteUrl,
    ...branches.map(branch => `refs/heads/${branch}`),
  ])
  const refs: Record<string, string> = {}
  for (const line of result.stdout.trim().split('\n').filter(Boolean)) {
    const match = /^([0-9a-f]{40,64})\s+refs\/heads\/(.+)$/u.exec(line)
    if (match !== null && branches.includes(match[2]!)) {
      refs[match[2]!] = match[1]!
    }
  }
  return refs
}

async function pushLanding(
  config: LandingBrokerConfig,
  repository: LandingBrokerRepository,
  request: LandingBrokerPushRequest,
): Promise<Record<string, string>> {
  validateLandingBrokerPush(request)
  const archive = archiveBranch(request.branch)
  const before = await refreshRemoteRefs(config, repository, [MAIN_BRANCH, request.branch, archive])
  if (before[MAIN_BRANCH] !== request.expectedRemoteMainHead) {
    Errors.throwUserInput(
      `Remote main moved to ${shortSha(before[MAIN_BRANCH])}; expected ${shortSha(request.expectedRemoteMainHead)}.`,
    )
  }
  const expectedFeature = request.expectedRemoteFeatureHead ?? undefined
  if (before[request.branch] !== expectedFeature) {
    Errors.throwUserInput(`Remote ${request.branch} changed after landing preflight.`)
  }
  if (before[archive] !== undefined) {
    Errors.throwUserInput(`Remote archive branch '${archive}' already exists.`)
  }

  await assertCommit(config, repository, request.landedHead)
  await assertCommit(config, repository, request.featureHead)
  const parents = (await git(config, repository, ['show', '-s', '--format=%P', request.landedHead])).stdout.trim()
  if (parents !== request.expectedRemoteMainHead) {
    Errors.throwUserInput('The proposed main commit does not have the expected remote main as its sole parent.')
  }
  const [landedTree, featureTree] = await Promise.all([
    git(config, repository, ['rev-parse', `${request.landedHead}^{tree}`]).then(result => result.stdout.trim()),
    git(config, repository, ['rev-parse', `${request.featureHead}^{tree}`]).then(result => result.stdout.trim()),
  ])
  if (landedTree !== featureTree) {
    Errors.throwUserInput('The proposed main commit does not carry the finalized feature tree.')
  }
  const containsMain = await git(config, repository, [
    'merge-base',
    '--is-ancestor',
    request.expectedRemoteMainHead,
    request.featureHead,
  ], [0, 1])
  if (containsMain.exitCode !== 0) {
    Errors.throwUserInput('The archived feature head does not contain the expected remote main.')
  }

  const pushArgs = [
    'push',
    '--porcelain',
    '--atomic',
    `--force-with-lease=refs/heads/${MAIN_BRANCH}:${request.expectedRemoteMainHead}`,
    `--force-with-lease=refs/heads/${archive}:`,
  ]
  if (request.expectedRemoteFeatureHead !== null) {
    pushArgs.push(`--force-with-lease=refs/heads/${request.branch}:${request.expectedRemoteFeatureHead}`)
  }
  pushArgs.push(
    repository.remoteUrl,
    `${request.landedHead}:refs/heads/${MAIN_BRANCH}`,
    `${request.featureHead}:refs/heads/${archive}`,
  )
  if (request.expectedRemoteFeatureHead !== null) {
    pushArgs.push(`:refs/heads/${request.branch}`)
  }
  await git(config, repository, pushArgs)

  const after = await readRemoteRefs(config, repository, [MAIN_BRANCH, request.branch, archive])
  if (
    after[MAIN_BRANCH] !== request.landedHead
    || after[archive] !== request.featureHead
    || request.expectedRemoteFeatureHead !== null && after[request.branch] !== undefined
  ) {
    Errors.throwHostEnvironment('GitHub accepted the landing command but its refs do not match the requested result.')
  }
  return after
}

/** validateLandingBrokerPush rejects every request outside the fixed branch-and-commit protocol. */
export function validateLandingBrokerPush(request: LandingBrokerPushRequest): void {
  if (!isLandableBranch(request.branch)) {
    Errors.throwUserInput('Landing branch is outside the broker policy.')
  }
  if (!isCommitSha(request.expectedRemoteMainHead)) {
    Errors.throwUserInput('Expected main is not a commit SHA.')
  }
  if (!isCommitSha(request.featureHead)) {
    Errors.throwUserInput('Feature head is not a commit SHA.')
  }
  if (!isCommitSha(request.landedHead)) {
    Errors.throwUserInput('Landed head is not a commit SHA.')
  }
  if (request.expectedRemoteFeatureHead !== null && !isCommitSha(request.expectedRemoteFeatureHead)) {
    Errors.throwUserInput('Expected feature head is not a commit SHA.')
  }
}

async function assertCommit(
  config: LandingBrokerConfig,
  repository: LandingBrokerRepository,
  sha: string,
): Promise<void> {
  await git(config, repository, ['cat-file', '-e', `${sha}^{commit}`])
}

async function git(
  config: LandingBrokerConfig,
  repository: LandingBrokerRepository,
  args: readonly string[],
  allowedExitCodes: readonly number[] = [0],
): Promise<CLI.CommandResult> {
  const helper = `!${shellQuote(config.ghPath)} auth git-credential`
  const result = await CLI.run(config.gitPath, {
    args: [
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'credential.helper=',
      '-c',
      `credential.https://github.com.helper=${helper}`,
      ...args,
    ],
    cwd: repository.mirrorGitDir,
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_DIR: repository.mirrorGitDir,
      GIT_OBJECT_DIRECTORY: repository.objectDirectory,
      GIT_TERMINAL_PROMPT: '0',
    },
    stdio: 'pipe',
  })
  if (
    result.error !== undefined
    || result.signal !== null
    || result.exitCode === null
    || !allowedExitCodes.includes(result.exitCode)
  ) {
    Errors.throwHostEnvironment(`The landing broker's Git operation failed: ${sanitizedDetail(result)}`, {
      cause: result.error,
      details: { args: args.slice(0, 2), exitCode: result.exitCode, signal: result.signal },
    })
  }
  return result
}

async function readConfig(configPath: string): Promise<LandingBrokerConfig> {
  const config = await FS.readJson<LandingBrokerConfig>(configPath)
  if (
    config.version !== LANDING_BROKER_VERSION
    || !FS.isAbsolute(config.gitPath)
    || !FS.isAbsolute(config.ghPath)
    || config.host !== LANDING_BROKER_HOST
    || !Number.isInteger(config.port)
    || config.port < 1
    || config.port > 65_535
    || !Array.isArray(config.repositories)
  ) {
    Errors.throwHostEnvironment(`Landing broker configuration is invalid: ${configPath}`)
  }
  return config
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function sanitizedDetail(result: CLI.CommandResult): string {
  const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode ?? result.signal ?? 'unknown'}`
  return detail.slice(-2_000)
}

function shortSha(value: string | undefined): string {
  return value?.slice(0, 8) ?? '<missing>'
}
