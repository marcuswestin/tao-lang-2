import { expect, test } from '@playwright/test'
import { CLI, FS, Platform, Repo } from '@shared'
import { exportNativeIosApp, validateNativeIosAppOutput } from './NativeIosAppExport'

test('retains a simulator app with executable identity and the selected toolchain without replacing an export', async () => {
  test.skip(Platform.hostPlatform !== 'darwin', 'Apple bundle copying uses the macOS ditto command.')
  const root = await Repo.mkScratchDir('ios-app-export-')
  const appPath = FS.resolvePath('source.app', root)
  const output = FS.resolvePath('review', root)
  const environment = { DEVELOPER_DIR: '/Applications/Xcode-27.1.app/Contents/Developer' }
  const invocations: CLI.CommandSpec[] = []
  let bundleSdk = 'iphonesimulator27.1'
  let bundleXcodeBuild = '27A9269'
  const command: typeof CLI.run = async (name, spec = {}) => {
    invocations.push(spec)
    const args = spec.args ?? []
    let stdout = ''
    if (name.endsWith('plutil')) {
      stdout = ({
        CFBundleIdentifier: 'dev.tao.review',
        CFBundleExecutable: 'Review',
        DTSDKName: bundleSdk,
        DTXcodeBuild: bundleXcodeBuild,
      } as Record<string, string>)[args[1]!] ?? ''
    }
    if (name.endsWith('xcodebuild')) {
      stdout = 'Xcode 27.1\nBuild version 27A9269'
    }
    if (name.endsWith('xcrun')) {
      stdout = '27.1'
    }
    if (name === '/bin/mkdir' || name === '/usr/bin/ditto') {
      return await CLI.run(name, spec)
    }
    return { command: name, args: [...args], stdout, stderr: '', exitCode: 0, signal: null }
  }
  try {
    await FS.writeText(FS.resolvePath('Review', appPath), 'simulator executable')
    await FS.writeText(FS.resolvePath('asset.txt', appPath), 'app resource')
    await FS.symlink('asset.txt', FS.resolvePath('linked-asset.txt', appPath))
    const options = { appPath, output, environment, appId: 'dev.tao.review', runId: 'test-run' }
    await exportNativeIosApp(options, command)
    const receipt = await FS.readJson<Record<string, unknown>>(FS.resolvePath('build.json', output))
    expect(receipt).toMatchObject({
      status: 'ready',
      developerDirectory: environment.DEVELOPER_DIR,
      sdk: 'iphonesimulator27.1',
      selectedSdk: '27.1',
      executableSha256: Platform.sha256Hex(await FS.readFile(FS.resolvePath('Review', appPath))),
    })
    expect(await FS.readText(FS.resolvePath('Application.app/asset.txt', output))).toBe('app resource')
    expect(invocations.every(invocation => invocation.env?.['DEVELOPER_DIR'] === environment.DEVELOPER_DIR)).toBe(true)
    await expect(exportNativeIosApp(options, command)).rejects.toThrow('Refusing to replace')
    expect(await FS.readText(FS.resolvePath('Application.app/Review', output))).toBe('simulator executable')
    await expect(exportNativeIosApp({ ...options, output: FS.resolvePath('wrong-app', root), appId: 'other' }, command))
      .rejects.toThrow('does not match')
    expect(await FS.exists(FS.resolvePath('wrong-app', root))).toBe(false)
    for (const metadata of ['sdk', 'xcode']) {
      bundleSdk = metadata === 'sdk' ? 'iphonesimulator27.0' : 'iphonesimulator27.1'
      bundleXcodeBuild = metadata === 'xcode' ? '27A9999' : '27A9269'
      const mismatchOutput = FS.resolvePath(`wrong-${metadata}`, root)
      await expect(exportNativeIosApp({ ...options, output: mismatchOutput }, command)).rejects.toThrow(
        'does not match the selected Xcode',
      )
      expect(await FS.exists(mismatchOutput)).toBe(false)
    }
    await FS.remove(appPath)
    expect(await FS.readText(FS.resolvePath('Application.app/linked-asset.txt', output))).toBe('app resource')
  } finally {
    await FS.remove(root)
  }
})

test('refuses a retained output under the automatically pruned native-build store', async () => {
  await expect(validateNativeIosAppOutput('.artifacts/host-testing/manual-review')).rejects.toThrow(
    'outside .artifacts/host-testing',
  )
  await expect(validateNativeIosAppOutput('')).rejects.toThrow('must name a new directory')
  const root = await Repo.mkScratchDir('ios-export-alias-')
  try {
    await FS.mkdir(Repo.resolvePath('.artifacts/host-testing'))
    await FS.symlink(Repo.resolvePath('.artifacts/host-testing'), FS.resolvePath('alias', root))
    await expect(validateNativeIosAppOutput(FS.resolvePath('alias/manual-review', root))).rejects.toThrow(
      'outside .artifacts/host-testing',
    )
  } finally {
    await FS.remove(root)
  }
})
