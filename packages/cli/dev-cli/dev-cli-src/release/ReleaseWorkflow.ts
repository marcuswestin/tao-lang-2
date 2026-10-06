import { CLI, Errors, FS, HCI, Platform, ReleaseCapabilities, type ReleasePhase, Repo, Time } from '@shared'

/** Human release commands behind the four `just` prepare/publish recipes. */

const STUDIO_OUTPUT = '.artifacts/build/studio-native'
const IDE_VSIX = '.artifacts/build/tao-ide-extension.vsix'
const IDE_STAMP = '.artifacts/build/tao-ide-extension.release.json'
const STUDIO_STAMP = '.artifacts/build/studio-native/prepared-release.json'

type Asset = { name: string; sha256: string }
type StudioStamp = {
  releasePhase: ReleasePhase
  releaseFingerprint: string
  appPath: string
  assets: Asset[]
  baseUrl: string
  commit: string
  dmgPath: string
  firstRelease: boolean
  repo: string
  version: string
}
type IdeStamp = {
  releasePhase: ReleasePhase
  releaseFingerprint: string
  commit: string
  name: string
  publisher: string
  sha256: string
  version: string
}
type ExtensionManifest = { name?: unknown; publisher?: unknown; version?: unknown }

function requireGitHubRepo(repo: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo)) {
    Errors.throwUserInput('Supply a GitHub repository as owner/name.')
  }
}

function studioBaseUrl(repo: string): string {
  requireGitHubRepo(repo)
  return `https://github.com/${repo}/releases/latest/download`
}

function requireVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    Errors.throwUserInput(`Expected a three-part Studio version, received '${version}'.`)
  }
}

async function run(command: string, args: readonly string[], cwd = Repo.getRoot(), stream = false): Promise<string> {
  const result = await CLI.run(command, { args, cwd, stdio: stream ? 'stream' : 'pipe' })
  if (result.error !== undefined || result.exitCode !== 0) {
    const detail = result.error?.message ?? (result.stderr.trim() || result.stdout.trim())
    Errors.throwHostEnvironment(`${command} ${args[0] ?? ''} failed: ${detail || `exit ${result.exitCode}`}`)
  }
  return result.stdout.trim()
}

async function commit(): Promise<string> {
  return await run('git', ['rev-parse', 'HEAD'])
}

async function requireCleanSource(stampedCommit: string): Promise<void> {
  const dirty = await run('git', ['status', '--porcelain=v1', '--untracked-files=all'])
  if (dirty !== '') {
    Errors.throwUserInput('Commit or remove uncommitted source changes before publishing.')
  }
  if (await commit() !== stampedCommit) {
    Errors.throwUserInput('The source commit changed after preparation; prepare a fresh release.')
  }
}

async function requirePublishedMain(stampedCommit: string): Promise<void> {
  const remote = await run('git', ['ls-remote', 'origin', 'refs/heads/main'])
  const remoteCommit = remote.split(/\s+/)[0]
  if (remoteCommit !== stampedCommit) {
    Errors.throwUserInput('Publish from the current GitHub main commit; land changes and prepare again if main moved.')
  }
}

async function fileHash(path: string): Promise<string> {
  const output = await run('shasum', ['-a', '256', path])
  const hash = /^[a-f0-9]{64}/.exec(output)?.[0]
  if (hash === undefined) {
    Errors.throwHostEnvironment(`shasum did not report a SHA-256 hash for ${path}.`)
  }
  return hash
}

async function artifactFiles(root: string): Promise<string[]> {
  if (!await FS.isDirectory(root)) {
    Errors.throwUserInput(`No artifact directory at ${root}.`)
  }
  const files: string[] = []
  for await (const path of FS.walk(root)) {
    if (FS.dirname(path) === root) {
      files.push(path)
    }
  }
  return files.sort()
}

async function studioPaths(): Promise<
  { appPath: string; artifactsRoot: string; dmgPath: string; payloadRoot: string }
> {
  const output = Repo.resolvePath(STUDIO_OUTPUT)
  const artifactsRoot = FS.resolvePath('project/artifacts', output)
  const payloadRoot = FS.resolvePath('service-stage/payload', output)
  const dmgs = (await artifactFiles(artifactsRoot)).filter(path => path.endsWith('.dmg'))
  if (dmgs.length !== 1) {
    Errors.throwUserInput(`Expected one Studio DMG in ${artifactsRoot}; found ${dmgs.length}.`)
  }
  const buildRoot = FS.resolvePath('project/build', output)
  const apps: string[] = []
  if (await FS.isDirectory(buildRoot)) {
    for await (const path of FS.walk(buildRoot, { includeDirectories: true })) {
      if (path.endsWith('.app') && await FS.isDirectory(FS.resolvePath('Contents', path))) {
        apps.push(path)
      }
    }
  }
  const topLevelApps = apps.filter(path => !apps.some(other => other !== path && FS.pathIsWithin(path, other)))
  if (topLevelApps.length !== 1) {
    Errors.throwUserInput(`Expected one built Studio .app under ${buildRoot}; found ${topLevelApps.length}.`)
  }
  return { appPath: topLevelApps[0]!, artifactsRoot, dmgPath: dmgs[0]!, payloadRoot }
}

async function checkStudio(
  paths: Awaited<ReturnType<typeof studioPaths>>,
  baseUrl: string,
  firstRelease: boolean,
): Promise<void> {
  await run(
    './dev',
    [
      'studio-release-check',
      '--payload-root',
      paths.payloadRoot,
      '--artifacts-root',
      paths.artifactsRoot,
      '--app',
      paths.appPath,
      '--dmg',
      paths.dmgPath,
      '--release-base-url',
      baseUrl,
      ...(firstRelease ? ['--first-release'] : []),
    ],
    Repo.getRoot(),
    true,
  )
}

async function readManifest(root: string): Promise<{ artifact: { file: string }; version: string }> {
  const raw = await FS.readJson<unknown>(FS.resolvePath('stable-macos-arm64-update.json', root))
  if (typeof raw !== 'object' || raw === null || !('version' in raw) || !('artifact' in raw)) {
    Errors.throwUserInput('The Studio update manifest is missing its version or artifact.')
  }
  const manifest = raw as { artifact?: { file?: unknown }; version?: unknown }
  if (typeof manifest.version !== 'string' || typeof manifest.artifact?.file !== 'string') {
    Errors.throwUserInput('The Studio update manifest has an invalid version or artifact name.')
  }
  return { artifact: { file: manifest.artifact.file }, version: manifest.version }
}

async function currentAssets(root: string): Promise<Asset[]> {
  const assets: Asset[] = []
  for (const path of await artifactFiles(root)) {
    assets.push({ name: FS.basename(path), sha256: await fileHash(path) })
  }
  return assets
}

async function readStudioStamp(): Promise<StudioStamp> {
  if (!await FS.isFile(Repo.resolvePath(STUDIO_STAMP))) {
    Errors.throwUserInput('Run `just studio-release-prepare` before publishing.')
  }
  return await FS.readJson<StudioStamp>(Repo.resolvePath(STUDIO_STAMP))
}

async function prepareStudio(repo: string, version: string, phase: ReleasePhase = 3): Promise<void> {
  const profile = publicProfile(phase)
  ReleaseCapabilities.require('studio', profile)
  const baseUrl = studioBaseUrl(repo)
  requireVersion(version)
  await requirePublicRepo(repo)
  const firstRelease = !await studioHasPredecessor(repo, version)
  await run(
    './dev',
    [
      'package-studio-native',
      '--phase',
      String(phase),
      '--release-base-url',
      baseUrl,
      '--channel',
      'stable',
      '--output-root',
      STUDIO_OUTPUT,
      '--version',
      version,
    ],
    Repo.getRoot(),
    true,
  )
  const paths = await studioPaths()
  await checkStudio(paths, baseUrl, firstRelease)
  const manifest = await readManifest(paths.artifactsRoot)
  if (manifest.version !== version) {
    Errors.throwUnexpected('The Studio build version does not match its update manifest.')
  }
  await FS.writeJson(
    Repo.resolvePath(STUDIO_STAMP),
    {
      releasePhase: phase,
      releaseFingerprint: ReleaseCapabilities.fingerprint(profile),
      appPath: paths.appPath,
      assets: await currentAssets(paths.artifactsRoot),
      baseUrl,
      commit: await commit(),
      dmgPath: paths.dmgPath,
      firstRelease,
      repo,
      version,
    } satisfies StudioStamp,
  )
  HCI.writeLine(`Prepared Studio ${version} for ${repo}; inspect ${paths.artifactsRoot} before publishing.`)
}

async function requirePreparedStudio(
  repo: string,
): Promise<{ paths: Awaited<ReturnType<typeof studioPaths>>; stamp: StudioStamp }> {
  const stamp = await readStudioStamp()
  requireReleaseStamp(stamp)
  ReleaseCapabilities.require('studio', publicProfile(stamp.releasePhase))
  if (stamp.repo !== repo || stamp.baseUrl !== studioBaseUrl(repo)) {
    Errors.throwUserInput('The prepared Studio release targets a different GitHub repository.')
  }
  await requireCleanSource(stamp.commit)
  await requirePublishedMain(stamp.commit)
  const paths = await studioPaths()
  if (paths.appPath !== stamp.appPath || paths.dmgPath !== stamp.dmgPath) {
    Errors.throwUserInput('The Studio build paths changed after preparation.')
  }
  if (JSON.stringify(await currentAssets(paths.artifactsRoot)) !== JSON.stringify(stamp.assets)) {
    Errors.throwUserInput('Studio artifacts changed after preparation; prepare again.')
  }
  const manifest = await readManifest(paths.artifactsRoot)
  if (manifest.version !== stamp.version) {
    Errors.throwUserInput('The Studio manifest version changed after preparation.')
  }
  await checkStudio(paths, stamp.baseUrl, stamp.firstRelease)
  return { paths, stamp }
}

async function requirePublicRepo(repo: string): Promise<void> {
  HCI.writeLine(
    `GitHub prerequisite: open the existing public repository at https://github.com/${repo};`
      + ` the two URL segments after github.com are owner/name (${repo}).`
      + ' Use an account with repository write access to publish releases.'
      + ' Install GitHub CLI from https://cli.github.com if needed, then run `gh auth login --hostname github.com`'
      + ' and sign in with that account before continuing (https://cli.github.com/manual/gh_auth_login).',
  )
  await run('gh', ['auth', 'status'])
  const raw = await run('gh', ['repo', 'view', repo, '--json', 'visibility'])
  const visibility = JSON.parse(raw) as { visibility?: string }
  if (visibility.visibility?.toUpperCase() !== 'PUBLIC') {
    Errors.throwUserInput(`${repo} must be public for unauthenticated Studio updates.`)
  }
}

async function studioHasPredecessor(repo: string, version: string): Promise<boolean> {
  const raw = await run('gh', [
    'release',
    'list',
    '--repo',
    repo,
    '--json',
    'tagName,isDraft,isPrerelease',
    '--limit',
    '1000',
  ])
  const releases = JSON.parse(raw) as { isDraft?: boolean; isPrerelease?: boolean; tagName?: string }[]
  if (!Array.isArray(releases)) {
    Errors.throwHostEnvironment('GitHub did not return a release list.')
  }
  return releases.some(release =>
    release.tagName?.startsWith('studio-v') === true
    && release.tagName !== `studio-v${version}`
    && release.isDraft !== true
    && release.isPrerelease !== true
  )
}

async function ghReleaseIsDraft(repo: string, tag: string): Promise<boolean | undefined> {
  const result = await CLI.run('gh', {
    args: ['release', 'view', tag, '--repo', repo, '--json', 'isDraft,isPrerelease'],
    cwd: Repo.getRoot(),
    stdio: 'pipe',
  })
  if (result.exitCode !== 0) {
    return undefined
  }
  const release = JSON.parse(result.stdout) as { isDraft?: boolean; isPrerelease?: boolean }
  if (release.isPrerelease === true) {
    Errors.throwUserInput('Stable Studio updates cannot use a prerelease.')
  }
  return release.isDraft === true
}

async function verifyHostedAssets(baseUrl: string, root: string, assets: readonly Asset[]): Promise<void> {
  const download = Repo.resolvePath('.artifacts/build/studio-native/hosted-asset-check')
  try {
    for (const asset of assets) {
      const local = FS.resolvePath(asset.name, root)
      let matched = false
      for (let attempt = 0; attempt < 6; attempt++) {
        const response = await CLI.run('curl', {
          args: [
            '--fail',
            '--location',
            '--silent',
            '--show-error',
            '--output',
            download,
            `${baseUrl}/${encodeURIComponent(asset.name)}`,
          ],
          cwd: Repo.getRoot(),
          stdio: 'pipe',
        })
        if (response.exitCode === 0) {
          matched = await fileHash(download) === asset.sha256 && await fileHash(local) === asset.sha256
          if (matched) {
            break
          }
        }
        await Time.sleep(2_000)
      }
      if (!matched) {
        Errors.throwHostEnvironment(`GitHub did not serve the prepared bytes for ${asset.name}.`)
      }
      HCI.writeLine(`Verified public download: ${asset.name}`)
    }
  } finally {
    await FS.remove(download)
  }
}

async function publishStudio(repo: string): Promise<void> {
  requireGitHubRepo(repo)
  const { paths, stamp } = await requirePreparedStudio(repo)
  await requirePublicRepo(repo)
  const firstReleaseNow = !await studioHasPredecessor(repo, stamp.version)
  if (stamp.firstRelease !== firstReleaseNow) {
    Errors.throwUserInput('The published Studio release history changed after preparation; prepare again.')
  }
  const tag = `studio-v${stamp.version}`
  const draft = await ghReleaseIsDraft(repo, tag)
  if (draft === undefined) {
    await run(
      'gh',
      [
        'release',
        'create',
        tag,
        '--repo',
        repo,
        '--target',
        'main',
        '--draft',
        '--title',
        `Tao Studio ${stamp.version}`,
        '--notes',
        `Built from tao-lang commit ${stamp.commit}.`,
      ],
      Repo.getRoot(),
      true,
    )
  } else if (!draft) {
    await verifyHostedAssets(stamp.baseUrl, paths.artifactsRoot, stamp.assets)
    HCI.writeLine(`Studio ${stamp.version} is already published with matching assets.`)
    return
  }
  await run(
    'gh',
    [
      'release',
      'upload',
      tag,
      ...stamp.assets.map(asset => FS.resolvePath(asset.name, paths.artifactsRoot)),
      '--repo',
      repo,
      '--clobber',
    ],
    Repo.getRoot(),
    true,
  )
  await run('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest'], Repo.getRoot(), true)
  await verifyHostedAssets(stamp.baseUrl, paths.artifactsRoot, stamp.assets)
  HCI.writeLine(`Published Studio ${stamp.version}: https://github.com/${repo}/releases/tag/${tag}`)
}

async function extensionManifest(): Promise<{ name: string; publisher: string; version: string }> {
  const raw = await FS.readJson<ExtensionManifest>(Repo.resolvePath('packages/ides/ide-extension/package.json'))
  if (typeof raw.name !== 'string' || typeof raw.publisher !== 'string' || typeof raw.version !== 'string') {
    Errors.throwUserInput('The IDE extension manifest needs a name, publisher, and version.')
  }
  return { name: raw.name, publisher: raw.publisher, version: raw.version }
}

async function vscodeCli(): Promise<string> {
  const explicit = Platform.runtimeProcess.env['TAO_VSCODE_CLI']
  if (explicit !== undefined && explicit !== '') {
    return explicit
  }
  const macApp = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
  if (await FS.isFile(macApp)) {
    return macApp
  }
  return 'code'
}

async function prepareIde(phase: ReleasePhase = 1): Promise<void> {
  const profile = publicProfile(phase)
  const manifest = await extensionManifest()
  await run('./agent', ['ide-extension-package', manifest.version, String(phase)], Repo.getRoot(), true)
  const vsix = Repo.resolvePath(IDE_VSIX)
  if (!await FS.isFile(vsix)) {
    Errors.throwUserInput(`The IDE package did not write ${vsix}.`)
  }
  const isolatedRoot = Repo.resolvePath(`.artifacts/tests/ide-release/${Date.now()}`)
  const args = [
    '--user-data-dir',
    FS.resolvePath('user', isolatedRoot),
    '--extensions-dir',
    FS.resolvePath('extensions', isolatedRoot),
  ]
  const code = await vscodeCli()
  await run(code, [...args, '--install-extension', vsix, '--force'])
  const installed = await run(code, [...args, '--list-extensions', '--show-versions'])
  const identity = `${manifest.publisher}.${manifest.name}@${manifest.version}`
  if (!installed.split('\n').some(line => line.trim().toLowerCase() === identity.toLowerCase())) {
    Errors.throwHostEnvironment(`VS Code did not list ${identity} in the isolated profile.`)
  }
  await FS.writeJson(
    Repo.resolvePath(IDE_STAMP),
    {
      commit: await commit(),
      releasePhase: phase,
      releaseFingerprint: ReleaseCapabilities.fingerprint(profile),
      name: manifest.name,
      publisher: manifest.publisher,
      sha256: await fileHash(vsix),
      version: manifest.version,
    } satisfies IdeStamp,
  )
  HCI.writeLine(`Prepared ${identity} from a clean VS Code installation. Inspect activation in ${isolatedRoot}.`)
}

async function publishIde(target: 'all' | 'marketplace' | 'open-vsx'): Promise<void> {
  if (!['all', 'marketplace', 'open-vsx'].includes(target)) {
    Errors.throwUserInput('The IDE publication target must be all, marketplace, or open-vsx.')
  }
  const path = Repo.resolvePath(IDE_STAMP)
  if (!await FS.isFile(path)) {
    Errors.throwUserInput('Run `just ide-extension-release-prepare` first.')
  }
  const stamp = await FS.readJson<IdeStamp>(path)
  requireReleaseStamp(stamp)
  await requireCleanSource(stamp.commit)
  await requirePublishedMain(stamp.commit)
  const manifest = await extensionManifest()
  if (manifest.name !== stamp.name || manifest.publisher !== stamp.publisher || manifest.version !== stamp.version) {
    Errors.throwUserInput('The IDE extension identity changed after preparation; prepare again.')
  }
  const vsix = Repo.resolvePath(IDE_VSIX)
  if (await fileHash(vsix) !== stamp.sha256) {
    Errors.throwUserInput('The VSIX changed after preparation; prepare again.')
  }
  if (target === 'all' || target === 'marketplace') {
    if (!Platform.runtimeProcess.env['VSCE_PAT']) {
      Errors.throwUserInput(
        'Set VSCE_PAT locally before Marketplace publication.'
          + ' Sign in with your Microsoft account and select or create an Azure DevOps organization at https://dev.azure.com/.'
          + ` Reuse publisher '${stamp.publisher}' at https://marketplace.visualstudio.com/manage`
          + ' with the same Microsoft account allowed to publish; create it only if it does not exist.'
          + ' In Azure DevOps: User settings > Personal access tokens > New Token;'
          + ' choose All accessible organizations and Custom defined > Show all scopes > Marketplace > Manage.'
          + ' Store the generated token in the local VSCE_PAT environment variable and retry.'
          + ' Steps: https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token',
      )
    }
    await run(
      'bunx',
      ['@vscode/vsce', 'publish', '--packagePath', vsix],
      Repo.resolvePath('packages/ides/ide-extension'),
      true,
    )
    HCI.writeLine(`Published Marketplace: ${stamp.publisher}.${stamp.name}@${stamp.version}`)
  }
  if (target === 'all' || target === 'open-vsx') {
    if (!Platform.runtimeProcess.env['OVSX_PAT']) {
      Errors.throwUserInput(
        'Set OVSX_PAT locally before Open VSX publication.'
          + ' Sign in at https://open-vsx.org with GitHub; reuse or register an Eclipse account'
          + ' at https://accounts.eclipse.org/ with the same GitHub username.'
          + ' At https://open-vsx.org/user-settings/profile (avatar > Settings), select Log in with Eclipse,'
          + ' then Show Publisher Agreement and agree to it before publishing.'
          + ` Reuse namespace '${stamp.publisher}' with Owner or Contributor access;`
          + ' create it only if absent, following https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions#4-create-the-namespace.'
          + ' Open https://open-vsx.org/user-settings/tokens (avatar > Settings > Access Tokens),'
          + ' select Generate New Token, enter a description, then Generate Token.'
          + ' This publishing token has no selectable scopes; namespace membership grants publication access.'
          + ' Store the generated token in the local OVSX_PAT environment variable and retry.',
      )
    }
    await run('bunx', ['ovsx', 'publish', vsix], Repo.resolvePath('packages/ides/ide-extension'), true)
    HCI.writeLine(`Published Open VSX: ${stamp.publisher}.${stamp.name}@${stamp.version}`)
  }
}

function publicProfile(phase: ReleasePhase) {
  const profile = ReleaseCapabilities.profile(phase)
  if (profile.phase === 'development') {
    Errors.throwUserInput('Public releases require a numbered release phase.')
  }
  return profile
}

function requireReleaseStamp(stamp: { releasePhase: ReleasePhase; releaseFingerprint: string }): void {
  if (stamp.releaseFingerprint !== ReleaseCapabilities.fingerprint(publicProfile(stamp.releasePhase))) {
    Errors.throwUserInput('The release capability policy changed after preparation; prepare a fresh release.')
  }
}

export const ReleaseWorkflow = { prepareIde, prepareStudio, publishIde, publishStudio } as const
