import { expect, test } from '@playwright/test'
import {
  HOST_TEST_EFFECT_BOUNDARY_SCOPE,
  lintHostTestSource,
} from './EffectBoundaryLint'

test('rejects direct ambient effects and literal globalThis members', () => {
  const issues = lintHostTestSource(
    `
    Date()
    new Date()
    Date.now()
    Math.random()
    performance.now()
    setTimeout(() => {}, 1)
    clearTimeout(1)
    crypto.randomUUID()
    globalThis.crypto['getRandomValues'](new Uint8Array(1))
  `,
    { filePath: 'fixture.ts' },
  )

  expect(issues.map(issue => [issue.line, issue.message])).toEqual([
    [2, 'Ambient effect Date() is forbidden; use a named host-test adapter.'],
    [3, 'Ambient effect Date() is forbidden; use a named host-test adapter.'],
    [4, 'Ambient effect Date.now() is forbidden; use a named host-test adapter.'],
    [5, 'Ambient effect Math.random() is forbidden; use a named host-test adapter.'],
    [6, 'Ambient effect performance.now() is forbidden; use a named host-test adapter.'],
    [7, 'Ambient effect a raw timer scheduling or clearing call is forbidden; use a named host-test adapter.'],
    [8, 'Ambient effect a raw timer scheduling or clearing call is forbidden; use a named host-test adapter.'],
    [9, 'Ambient effect crypto.randomUUID() is forbidden; use a named host-test adapter.'],
    [10, 'Ambient effect crypto.getRandomValues() is forbidden; use a named host-test adapter.'],
  ])
})

test('rejects same-file aliases and destructuring for time and randomness', () => {
  const issues = lintHostTestSource(
    `
    const Clock = globalThis.Date
    const { now: currentTime } = Clock
    const { random: pick } = Math
    const { randomUUID: newId } = globalThis.crypto
    const schedule = globalThis.setInterval
    new Clock()
    currentTime()
    pick()
    newId()
    schedule(() => {}, 1)
  `,
    { filePath: 'fixture.ts' },
  )

  expect(issues.map(issue => issue.message)).toEqual([
    'Ambient effect Date() is forbidden; use a named host-test adapter.',
    'Ambient effect Date.now() is forbidden; use a named host-test adapter.',
    'Ambient effect Math.random() is forbidden; use a named host-test adapter.',
    'Ambient effect crypto.randomUUID() is forbidden; use a named host-test adapter.',
    'Ambient effect a raw timer scheduling or clearing call is forbidden; use a named host-test adapter.',
  ])
})

test('allows deterministic date forms, local shadows, and named adapters', () => {
  const deterministic = lintHostTestSource(
    `
    new Date(0)
    Date.UTC(2026, 8, 19)
    Date.parse('2026-09-19T00:00:00.000Z')
    const Date = class { constructor(_value: number) {} }
    new Date(0)
  `,
    { filePath: 'fixture.ts' },
  )
  const adapter = lintHostTestSource('Date.now()\nMath.random()', {
    filePath: 'ClockAdapter.ts',
    approvedEffectAdapter: { name: 'ClockAdapter' },
  })

  expect(deterministic).toEqual([])
  expect(adapter).toEqual([])
  expect(HOST_TEST_EFFECT_BOUNDARY_SCOPE).toContain('same-file aliases')
})

test('rejects Date calls with arguments while allowing explicit Date construction', () => {
  const issues = lintHostTestSource(
    'Date(0)\nnew Date(0)\nconst Clock = globalThis.Date\nClock(0)\nnew Clock(0)',
    { filePath: 'fixture.ts' },
  )
  expect(issues.map(issue => [issue.line, issue.message])).toEqual([
    [1, 'Ambient effect Date() is forbidden; use a named host-test adapter.'],
    [4, 'Ambient effect Date() is forbidden; use a named host-test adapter.'],
  ])
})

test('visits parameter and destructuring default initializers without leaking loop-local shadows', () => {
  const initializerIssues = lintHostTestSource(
    `
    function fromNow(value = Date.now()) { return value }
    const { choice = Math.random() } = source
  `,
    { filePath: 'fixture.ts' },
  )
  const loopIssues = lintHostTestSource(
    `
    for (let Date of dates) {}
    Date.now()
  `,
    { filePath: 'fixture.ts' },
  )

  expect(initializerIssues.map(issue => issue.message)).toEqual([
    'Ambient effect Date.now() is forbidden; use a named host-test adapter.',
    'Ambient effect Math.random() is forbidden; use a named host-test adapter.',
  ])
  expect(loopIssues.map(issue => issue.message)).toEqual([
    'Ambient effect Date.now() is forbidden; use a named host-test adapter.',
  ])
})

test('rejects legacy testing imports while allowing the e2e and Playwright boundary', () => {
  const issues = lintHostTestSource(
    `
    import { Test } from '@shared/test'
    import { helper } from '../testing/helper'
    import '../dev-tests/helper'
    import T = require('../expo-host-tests/helper')
    require('@shared/test')
    import '@playwright/test'
    import '../host-testing/ClockAdapter'
  `,
    { filePath: 'fixture.ts' },
  )

  expect(issues.map(issue => issue.message)).toEqual([
    "Legacy testing import '@shared/test' is forbidden in host-testing sources.",
    "Legacy testing import '../testing/helper' is forbidden in host-testing sources.",
    "Legacy testing import '../dev-tests/helper' is forbidden in host-testing sources.",
    "Legacy testing import '../expo-host-tests/helper' is forbidden in host-testing sources.",
    "Legacy testing import '@shared/test' is forbidden in host-testing sources.",
  ])
})
