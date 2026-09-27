import { expect, test } from '@playwright/test'
import { parseHostTestingRequest } from '../HostTestingRequest'

const base = { app: 'clockwork', seed: '12345' }

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
