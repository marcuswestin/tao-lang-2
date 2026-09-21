import { CLI, FS, LocalSocket, Repo } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import {
  archiveBranch,
  isInspectableBranch,
  isLandableBranch,
  LANDING_BROKER_GIT_TIMEOUT_MS,
  LANDING_BROKER_HOST,
  LANDING_BROKER_PING_TIMEOUT_MS,
  LANDING_BROKER_REQUEST_TIMEOUT_MS,
  LANDING_BROKER_VERSION,
  type LandingBrokerConfig,
} from '../verification-src/landing-broker/LandingBrokerProtocol'
import {
  handleLandingBrokerRequest,
  validateLandingBrokerPush,
} from '../verification-src/landing-broker/LandingBrokerServer'

const SHA = 'a'.repeat(40)

Test('landing broker transport crosses the managed loopback boundary', async () => {
  const endpoint = { host: LANDING_BROKER_HOST, port: await LocalSocket.availablePort(LANDING_BROKER_HOST) }
  const server = await LocalSocket.serve(endpoint, async request => ({ echoed: request }))
  try {
    Expect(await LocalSocket.request(endpoint, { ready: true })).toEqual({ echoed: { ready: true } })
  } finally {
    await server.close()
  }
})

Test('landing broker gives Git work a bounded budget beyond the readiness probe', () => {
  Expect(LANDING_BROKER_PING_TIMEOUT_MS).toBe(2_000)
  Expect(LANDING_BROKER_GIT_TIMEOUT_MS).toBe(120_000)
  Expect(LANDING_BROKER_REQUEST_TIMEOUT_MS).toBeGreaterThan(LANDING_BROKER_GIT_TIMEOUT_MS)
})

Test('landing broker entry bundles into a script the pinned Bun can launch', async () => {
  const root = Repo.getRoot()
  const outputRoot = await mkTestDir('tao-landing-broker-bundle-')
  const output = FS.resolvePath('tao-landing-broker', outputRoot)
  try {
    await CLI.mustRun('bun', {
      args: [
        'build',
        FS.resolvePath('packages/testing/verification/verification-src/landing-broker/LandingBrokerServer.ts', root),
        '--target=bun',
        '--outfile',
        output,
      ],
      cwd: root,
    })
    const launched = await CLI.run('bun', { args: [output], cwd: root })
    Expect(launched.exitCode).toBe(2)
    Expect(launched.stderr).toContain('Usage: tao-landing-broker serve <config-path>')
  } finally {
    await FS.remove(outputRoot)
  }
})

Test('landing broker policy accepts only Tao landing refs and commit-shaped inputs', () => {
  Expect(isLandableBranch('feat/example')).toBe(true)
  Expect(isLandableBranch('dev/ro')).toBe(true)
  Expect(isLandableBranch('main')).toBe(false)
  Expect(isLandableBranch('feat/../main')).toBe(false)
  Expect(isInspectableBranch('merged/example')).toBe(true)
  Expect(isInspectableBranch('refs/heads/main')).toBe(false)
  Expect(archiveBranch('feat/example')).toBe('merged/example')

  Expect(() =>
    validateLandingBrokerPush({
      branch: 'feat/example',
      expectedRemoteFeatureHead: null,
      expectedRemoteMainHead: SHA,
      featureHead: SHA,
      landedHead: SHA,
      operation: 'push',
      repositoryGitDir: '/repo/.git',
      version: LANDING_BROKER_VERSION,
    })
  ).not.toThrow()
  Expect(() =>
    validateLandingBrokerPush({
      branch: 'merged/example',
      expectedRemoteFeatureHead: null,
      expectedRemoteMainHead: SHA,
      featureHead: SHA,
      landedHead: SHA,
      operation: 'push',
      repositoryGitDir: '/repo/.git',
      version: LANDING_BROKER_VERSION,
    })
  ).toThrow('outside the broker policy')
})

Test('landing broker fetches and atomically lands only the validated tree and refs', async () => {
  const root = await mkTestDir('tao-landing-broker-')
  const source = FS.resolvePath('source', root)
  const remote = FS.resolvePath('remote.git', root)
  const mirror = FS.resolvePath('mirror.git', root)
  const gitPath = (await CLI.mustRun('which', { args: ['git'] })).stdout.trim()
  try {
    await git(gitPath, root, ['init', '--quiet', '--initial-branch=main', source])
    await FS.writeText(FS.resolvePath('value.txt', source), 'base\n')
    await git(gitPath, source, ['add', 'value.txt'])
    await git(gitPath, source, [
      '-c',
      'user.name=Tao',
      '-c',
      'user.email=tao@example.com',
      'commit',
      '--quiet',
      '-m',
      'Base',
    ])
    const base = await gitLine(gitPath, source, ['rev-parse', 'HEAD'])
    await git(gitPath, root, ['init', '--bare', '--quiet', remote])
    await git(gitPath, source, ['push', '--quiet', remote, 'main:main'])
    await git(gitPath, source, ['switch', '--quiet', '-c', 'feat/example'])
    await FS.writeText(FS.resolvePath('value.txt', source), 'feature\n')
    await git(gitPath, source, ['add', 'value.txt'])
    await git(
      gitPath,
      source,
      ['-c', 'user.name=Tao', '-c', 'user.email=tao@example.com', 'commit', '--quiet', '-m', 'Feature'],
    )
    const feature = await gitLine(gitPath, source, ['rev-parse', 'HEAD'])
    const tree = await gitLine(gitPath, source, ['rev-parse', 'HEAD^{tree}'])
    await git(gitPath, source, ['push', '--quiet', remote, 'feat/example:feat/example'])
    const landed = await gitLine(
      gitPath,
      source,
      ['-c', 'user.name=Tao', '-c', 'user.email=tao@example.com', 'commit-tree', tree, '-p', base, '-m', 'Land'],
    )
    await git(gitPath, root, ['init', '--bare', '--quiet', mirror])
    const common = await FS.realPath(FS.resolvePath('.git', source))
    const config: LandingBrokerConfig = {
      ghPath: '/usr/bin/true',
      gitPath,
      host: LANDING_BROKER_HOST,
      port: 49_371,
      repositories: [{
        gitCommonDir: common,
        mirrorGitDir: mirror,
        objectDirectory: await FS.realPath(FS.resolvePath('objects', common)),
        remoteUrl: remote,
      }],
      version: LANDING_BROKER_VERSION,
    }

    const inspected = await handleLandingBrokerRequest(config, {
      branches: ['main', 'feat/example', 'merged/example'],
      operation: 'inspect',
      repositoryGitDir: common,
      version: LANDING_BROKER_VERSION,
    })
    Expect(inspected).toEqual({
      ok: true,
      operation: 'inspect',
      refs: { 'feat/example': feature, main: base },
    })

    const pushed = await handleLandingBrokerRequest(config, {
      branch: 'feat/example',
      expectedRemoteFeatureHead: feature,
      expectedRemoteMainHead: base,
      featureHead: feature,
      landedHead: landed,
      operation: 'push',
      repositoryGitDir: common,
      version: LANDING_BROKER_VERSION,
    })
    Expect(pushed).toEqual({
      ok: true,
      operation: 'push',
      refs: { main: landed, 'merged/example': feature },
    })
    Expect(await gitLine(gitPath, source, ['ls-remote', remote, 'refs/heads/main'])).toStartWith(landed)
    Expect(await gitLine(gitPath, source, ['ls-remote', remote, 'refs/heads/merged/example'])).toStartWith(feature)
    Expect(await gitLine(gitPath, source, ['ls-remote', remote, 'refs/heads/feat/example'])).toBe('')
  } finally {
    await FS.remove(root)
  }
})

async function git(gitPath: string, cwd: string, args: readonly string[]): Promise<void> {
  await CLI.mustRun(gitPath, { args, cwd })
}

async function gitLine(gitPath: string, cwd: string, args: readonly string[]): Promise<string> {
  return (await CLI.mustRun(gitPath, { args, cwd })).stdout.trim()
}
