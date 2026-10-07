import { Expect, Test } from '@shared/test'
import type { StudioCompileRequest } from '../studio-src/StudioCompileCoordinator'
import { studioPreviewFastGate } from '../studio-src/StudioPreviewEligibility'

const request: StudioCompileRequest = {
  project: '/project',
  appName: 'Garden',
  compileRevision: 2,
  causes: ['studio-write'],
  changes: [{ path: 'Design.tao', sourceVersion: 'new' }],
}
const sources = new Map([['Design.tao', { version: 'old' }], ['App.tao', { version: 'app' }]])
function gates(overrides: Partial<Parameters<typeof studioPreviewFastGate>[0]> = {}): Record<string, boolean> {
  return studioPreviewFastGate({
    enabled: true,
    request,
    requestedPath: 'Design.tao',
    sourceVersions: { 'Design.tao': 'new', 'App.tao': 'app' },
    consumedSources: sources,
    freshTooling: true,
    currentToolingInputs: true,
    auditedToolingInputs: true,
    ...overrides,
  })
}
function eligible(overrides: Partial<Parameters<typeof studioPreviewFastGate>[0]> = {}): boolean {
  return Object.values(gates(overrides)).every(Boolean)
}

Test('Studio fast preview admits a current isolated source save', () => {
  Expect(eligible()).toBe(true)
})
Test('Studio fast preview rejects unconsumed second edits and source graph changes', () => {
  Expect(eligible({ sourceVersions: { 'Design.tao': 'new', 'App.tao': 'changed' } })).toBe(false)
  Expect(eligible({ sourceVersions: { 'Design.tao': 'new', 'App.tao': 'app', 'New.tao': 'added' } })).toBe(false)
  Expect(eligible({ sourceVersions: { 'Design.tao': 'new' } })).toBe(false)
})
Test('Studio fast preview rejects obsolete or unversioned requests and consumed echoes', () => {
  Expect(eligible({ request: { ...request, changes: [{ path: 'Design.tao', sourceVersion: 'obsolete' }] } })).toBe(
    false,
  )
  Expect(eligible({ request: { ...request, changes: [{ path: 'Design.tao' }] } })).toBe(false)
  Expect(eligible({ sourceVersions: { 'Design.tao': 'old', 'App.tao': 'app' } })).toBe(false)
})
Test('Studio fast preview rejects invalidated tooling and authoritative batches', () => {
  Expect(eligible({ currentToolingInputs: false })).toBe(false)
  Expect(eligible({ freshTooling: false })).toBe(false)
  Expect(eligible({ auditedToolingInputs: false })).toBe(false)
  Expect(eligible({ request: { ...request, causes: ['initial', 'studio-write'] } })).toBe(false)
  Expect(eligible({ enabled: false })).toBe(false)
})

Test('Studio fast preview requires own version keys for the exact current request path', () => {
  const inheritedVersions = Object.assign(Object.create({ 'Design.tao': 'new' }), { 'App.tao': 'app' }) as Record<
    string,
    string
  >
  Expect(eligible({ sourceVersions: inheritedVersions })).toBe(false)
  Expect(gates({ sourceVersions: inheritedVersions })['currentRequest']).toBe(false)
  Expect(eligible({ requestedPath: 'Other.tao' })).toBe(false)
  Expect(eligible({ request: { ...request, changes: [{ path: 'Other.tao', sourceVersion: 'new' }] } })).toBe(false)
  Expect(eligible({ sourceVersions: { 'Design.tao': '', 'App.tao': 'app' } })).toBe(false)
})

Test('Studio fast preview requires one changed file and the complete consumed graph', () => {
  Expect(eligible({
    request: {
      ...request,
      changes: [
        { path: 'Design.tao', sourceVersion: 'new' },
        { path: 'App.tao', sourceVersion: 'next' },
      ],
    },
    sourceVersions: { 'Design.tao': 'new', 'App.tao': 'next' },
  })).toBe(false)
  Expect(eligible({ sourceVersions: { 'Design.tao': 'new', 'App.tao': 'app', 'Following.tao': 'follow' } })).toBe(false)
})

Test('Studio fast preview can retry after successful authoritative recovery establishes the consumed baseline', () => {
  const recoveredBaseline = new Map([
    ['Design.tao', { version: 'recovered-version' }],
    ['App.tao', { version: 'app' }],
  ])
  Expect(eligible({
    request: { ...request, changes: [{ path: 'Design.tao', sourceVersion: 'retry-version' }] },
    sourceVersions: { 'Design.tao': 'retry-version', 'App.tao': 'app' },
    consumedSources: recoveredBaseline,
  })).toBe(true)
})
