import { expect, test } from '@playwright/test'
import { type CLI, Errors, Platform, Repo, TaoStdlib } from '@shared'
import { createHostTestingContext } from '../HostTestingCommand'
import { parseHostTestingRequest } from '../HostTestingRequest'

const base = { app: 'clockwork', seed: '12345' }
const developerDir = '/Applications/Xcode-beta.app/Contents/Developer'

test('host runners select the current checkout stdlib and preserve explicit payload overrides', async () => {
  const request = parseHostTestingRequest('check', base)
  const inherited = { TAO_RESOURCES: '/another/checkout/resources' }
  const context = await createHostTestingContext(request, { environment: inherited })
  expect(context.environment[TaoStdlib.DECLARED_ROOT_ENV]).toBe(Repo.resolvePath('packages/apps/stdlib'))
  expect(inherited).toEqual({ TAO_RESOURCES: '/another/checkout/resources' })
  const explicit = await createHostTestingContext(request, {
    environment: { [TaoStdlib.DECLARED_ROOT_ENV]: '/explicit/stdlib' },
  })
  expect(explicit.environment[TaoStdlib.DECLARED_ROOT_ENV]).toBe('/explicit/stdlib')
})

test('accepts scoped Xcode only for Apple native modes and retained output only for iOS simulators', () => {
  for (const mode of ['ios', 'device', 'catalyst']) {
    const request = parseHostTestingRequest(mode, {
      ...base,
      app: 'hnreader',
      developerDir,
      ...(mode === 'catalyst' ? {} : { device: 'target' }),
    })
    expect(request).toMatchObject({ developerDir })
  }
  for (const mode of ['android', 'browser', 'prepare', 'export', 'driver', 'setup', 'check']) {
    expect(() => parseHostTestingRequest(mode, { ...base, developerDir, device: 'target' })).toThrow(
      '--developer-dir is supported only',
    )
  }
  for (
    const path of [
      'Xcode.app/Contents/Developer',
      '/Library/Developer/CommandLineTools',
      '/Applications/Xcode.app',
      `${developerDir}\n`,
    ]
  ) {
    expect(() => parseHostTestingRequest('ios', { ...base, developerDir: path, device: 'target' })).toThrow(
      'absolute Xcode',
    )
  }
  expect(parseHostTestingRequest('ios', { ...base, device: 'target', output: '/retained/app.app' })).toMatchObject({
    output: '/retained/app.app',
  })
  expect(parseHostTestingRequest('ios', { ...base, device: 'target', buildOnly: true })).toMatchObject({
    buildOnly: true,
  })
  for (const mode of ['device', 'android', 'catalyst', 'browser']) {
    expect(() => parseHostTestingRequest(mode, { ...base, device: 'target', output: '/retained/app.app' })).toThrow(
      '--output is supported only for ios',
    )
    expect(() => parseHostTestingRequest(mode, { ...base, device: 'target', buildOnly: true })).toThrow(
      '--build-only is supported only for ios',
    )
  }
})

test('Apple builds normalize missing and ASCII locales without changing other modes or caller state', async () => {
  for (const locale of [undefined, 'C']) {
    const environment = { LANG: locale, LC_ALL: locale, PATH: '/tools' }
    for (const mode of ['ios', 'device', 'catalyst', 'android', 'check']) {
      const request = parseHostTestingRequest(mode, {
        ...base,
        app: 'hnreader',
        ...(['ios', 'device', 'android'].includes(mode) ? { device: 'target' } : {}),
      })
      const context = await createHostTestingContext(request, { environment })
      const expectedLocale = ['ios', 'device', 'catalyst'].includes(mode) ? 'en_US.UTF-8' : locale
      expect(context.environment['LANG']).toBe(expectedLocale)
      expect(context.environment['LC_ALL']).toBe(expectedLocale)
      expect(context.environment['PATH']).toBe('/tools')
      expect(environment).toEqual({ LANG: locale, LC_ALL: locale, PATH: '/tools' })
    }
  }
})

test('validates scoped Xcode and propagates its environment without changing caller or process state', async () => {
  const environment = { DEVELOPER_DIR: '/original', PATH: '/tools' }
  const processSelection = Platform.runtimeProcess.env['DEVELOPER_DIR']
  const calls: CLI.CommandSpec[] = []
  const request = parseHostTestingRequest('ios', { ...base, developerDir, device: 'target' })
  const context = await createHostTestingContext(request, {
    environment,
    hostPlatform: 'darwin',
    files: { isDirectory: async () => true, isFile: async () => true, realPath: async path => path },
    run: async (command, spec = {}) => {
      calls.push(spec)
      return {
        command,
        args: [...spec.args ?? []],
        exitCode: 0,
        signal: null,
        stderr: '',
        stdout: command.endsWith('xcrun') ? `${developerDir}/usr/bin/xcodebuild\n` : 'Xcode 27.1\nBuild version 18B',
      }
    },
  })
  expect(context.environment['DEVELOPER_DIR']).toBe(developerDir)
  expect(context.environment['PATH']).toBe('/tools')
  expect(calls.map(call => call.args)).toEqual([['-version'], ['-checkFirstLaunchStatus'], ['--find', 'xcodebuild']])
  expect(calls.every(call => call.env?.['DEVELOPER_DIR'] === developerDir)).toBe(true)
  expect(environment.DEVELOPER_DIR).toBe('/original')
  expect(Platform.runtimeProcess.env['DEVELOPER_DIR']).toBe(processSelection)
})

test('rejects missing or unready scoped Xcode before a host context can reach build or device operations', async () => {
  const request = parseHostTestingRequest('ios', { ...base, developerDir, device: 'target' })
  let probes = 0
  await expect(createHostTestingContext(request, {
    hostPlatform: 'darwin',
    files: { isDirectory: async () => false, isFile: async () => false, realPath: async path => path },
    run: async () => {
      probes++
      return Errors.throwUnexpected('unreachable probe')
    },
  })).rejects.toThrow('missing or incomplete')
  expect(probes).toBe(0)
  await expect(createHostTestingContext(request, {
    hostPlatform: 'darwin',
    files: { isDirectory: async () => true, isFile: async () => true, realPath: async path => path },
    run: async (command, spec = {}) => ({
      command,
      args: [...spec.args ?? []],
      exitCode: 1,
      signal: null,
      stderr: 'license requires attention',
      stdout: '',
    }),
  })).rejects.toThrow('license requires attention')
  for (const failure of ['first-launch', 'resolution']) {
    await expect(createHostTestingContext(request, {
      hostPlatform: 'darwin',
      files: { isDirectory: async () => true, isFile: async () => true, realPath: async path => path },
      run: async (command, spec = {}) => ({
        command,
        args: [...spec.args ?? []],
        signal: null,
        exitCode: failure === 'first-launch' && spec.args?.[0] === '-checkFirstLaunchStatus' ? 1 : 0,
        stderr: failure === 'first-launch' && spec.args?.[0] === '-checkFirstLaunchStatus'
          ? 'components incomplete'
          : '',
        stdout: command.endsWith('xcrun')
          ? '/Applications/Other.app/Contents/Developer/usr/bin/xcodebuild'
          : 'Xcode 27.1',
      }),
    })).rejects.toThrow(failure === 'first-launch' ? 'components incomplete' : 'did not resolve xcodebuild')
  }
})

test('Catalyst is a local build for the two review apps with no mobile target or injected fault', () => {
  for (const app of ['native-navigation', 'hnreader']) {
    expect(parseHostTestingRequest('catalyst', { ...base, app })).toMatchObject({
      kind: 'catalyst',
      mode: 'catalyst',
      subject: app,
    })
    expect(() => parseHostTestingRequest('catalyst', { ...base, app, device: 'phone' })).toThrow(
      'without --device or --fault',
    )
  }
  expect(() => parseHostTestingRequest('catalyst', base)).toThrow('require --app native-navigation or hnreader')
  expect(() => parseHostTestingRequest('catalyst', { ...base, app: 'hnreader', fault: true })).toThrow(
    'without --device or --fault',
  )
})

test('dispatches maintenance, driver, browser-build, and native modes without widening their authority', () => {
  expect(parseHostTestingRequest('lint', base)).toMatchObject({ kind: 'maintenance', mode: 'lint' })
  expect(parseHostTestingRequest('driver', base)).toMatchObject({ kind: 'driver', mode: 'driver' })
  expect(parseHostTestingRequest('export', { ...base, fault: true })).toMatchObject({
    fault: 'clockwork-countdown-frozen',
    kind: 'browser',
    mode: 'export',
  })
  expect(parseHostTestingRequest('device', { ...base, device: 'physical-id' })).toMatchObject({
    device: 'physical-id',
    kind: 'native',
    mode: 'device',
  })
  expect(parseHostTestingRequest('android', { ...base, device: 'emulator-5554' })).toMatchObject({
    device: 'emulator-5554',
    kind: 'native',
    mode: 'android',
  })
})

test('requires explicit native targets and keeps application faults out of controls', () => {
  expect(() => parseHostTestingRequest('ios', base)).toThrow(
    'Native proofs require --device with an explicit target identifier.',
  )
  expect(() => parseHostTestingRequest('check', { ...base, fault: true })).toThrow(
    '--fault changes an isolated compiled app; use prepare, export, browser, android, or ios.',
  )
  expect(() => parseHostTestingRequest('driver', { ...base, fault: true })).toThrow(
    '--fault changes an isolated compiled app; use prepare, export, browser, android, or ios.',
  )
  expect(() => parseHostTestingRequest('device', { ...base, device: 'physical-id', fault: true })).toThrow(
    'Physical-device installation cannot classify an application fault; use ios or android with --fault.',
  )
  expect(() => parseHostTestingRequest('unknown', base)).toThrow("Unknown host-testing mode 'unknown'.")
})

test('native navigation has explicit simulator targets and cannot silently run an unrelated browser or fault proof', () => {
  const native = { app: 'native-navigation', seed: '12345' }
  for (const mode of ['ios', 'android', 'device']) {
    expect(parseHostTestingRequest(mode, { ...native, device: 'owned-target' })).toMatchObject({
      kind: 'native',
      mode,
      subject: 'native-navigation',
      device: 'owned-target',
    })
    expect(() => parseHostTestingRequest(mode, native)).toThrow('Native proofs require --device')
  }
  expect(parseHostTestingRequest('prepare', native)).toMatchObject({ mode: 'prepare', subject: 'native-navigation' })
  for (const mode of ['browser', 'export', 'driver']) {
    expect(() => parseHostTestingRequest(mode, { ...native, device: 'physical-id' })).toThrow(
      'native-navigation acceptance requires ios or android',
    )
  }
  for (const mode of ['ios', 'prepare', 'check']) {
    expect(() => parseHostTestingRequest(mode, { ...native, fault: true, device: 'owned-target' })).toThrow(
      '--fault is not supported for native-navigation.',
    )
  }
})

test('native Clipboard uses an explicit iOS simulator and rejects unrelated platforms and fault fixtures', () => {
  const native = { app: 'native-bridge', seed: '12345' }
  expect(parseHostTestingRequest('ios', { ...native, device: 'owned-target' })).toMatchObject({
    kind: 'native',
    mode: 'ios',
    subject: 'native-bridge',
    device: 'owned-target',
  })
  expect(() => parseHostTestingRequest('ios', native)).toThrow('Native proofs require --device')
  expect(() => parseHostTestingRequest('ios', { ...native, device: 'owned-target', fault: true })).toThrow(
    '--fault is not supported for native-bridge.',
  )
  for (const mode of ['browser', 'export', 'driver', 'android', 'device', 'catalyst']) {
    expect(() => parseHostTestingRequest(mode, { ...native, device: 'owned-target' })).toThrow(
      'native-bridge Clipboard acceptance requires ios',
    )
  }
})

test('Syntax2 native acceptance is limited to iOS, Android, and preparation', () => {
  const syntax2 = { app: 'syntax2', seed: '12345' }
  expect(parseHostTestingRequest('prepare', syntax2)).toMatchObject({
    kind: 'browser',
    mode: 'prepare',
    subject: 'syntax2',
  })
  for (const mode of ['ios', 'android']) {
    expect(parseHostTestingRequest(mode, { ...syntax2, device: 'owned-target' })).toMatchObject({
      kind: 'native',
      mode,
      subject: 'syntax2',
      device: 'owned-target',
    })
    expect(() => parseHostTestingRequest(mode, syntax2)).toThrow('Native proofs require --device')
  }
  for (const mode of ['browser', 'export', 'driver', 'device', 'catalyst', 'check', 'setup']) {
    expect(() => parseHostTestingRequest(mode, { ...syntax2, device: 'owned-target' })).toThrow(
      'syntax2 native acceptance requires ios or android',
    )
  }
  expect(() => parseHostTestingRequest('prepare', { ...syntax2, fault: true })).toThrow(
    '--fault is not supported for syntax2.',
  )
  expect(() => parseHostTestingRequest('ios', { ...syntax2, device: 'owned-target', fault: true })).toThrow(
    '--fault is not supported for syntax2.',
  )
})
