import { CLI, FS } from '@shared'
import { Expect, mkTestDir, Test } from '@shared/test'
import {
  archiveBranch,
  isInspectableBranch,
  isLandableBranch,
  LANDING_BROKER_VERSION,
  type LandingBrokerConfig,
} from '../dev-src/landing-broker/LandingBrokerProtocol'
import {
  handleLandingBrokerRequest,
  validateLandingBrokerPush,
} from '../dev-src/landing-broker/LandingBrokerServer'

const SHA = 'a'.repeat(40)

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
      repositories: [{
        gitCommonDir: common,
        mirrorGitDir: mirror,
        objectDirectory: await FS.realPath(FS.resolvePath('objects', common)),
        remoteUrl: remote,
      }],
      socketPath: FS.resolvePath('broker.sock', root),
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
