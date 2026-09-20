import { expect, test } from '@playwright/test'
import { parseHostTestingRequest } from '../HostTestingRequest'

const base = { app: 'clockwork', seed: '12345' }

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
    '--fault changes an isolated compiled app; use prepare, export, browser, android, ios, or device.',
  )
  expect(() => parseHostTestingRequest('driver', { ...base, fault: true })).toThrow(
    '--fault changes an isolated compiled app; use prepare, export, browser, android, ios, or device.',
  )
  expect(() => parseHostTestingRequest('unknown', base)).toThrow("Unknown host-testing mode 'unknown'.")
})
