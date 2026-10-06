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
function eligible(overrides: Partial<Parameters<typeof studioPreviewFastGate>[0]> = {}): boolean {
  return Object.values(studioPreviewFastGate({
    enabled: true,
    request,
    requestedPath: 'Design.tao',
    sourceVersions: { 'Design.tao': 'new', 'App.tao': 'app' },
    consumedSources: sources,
    freshTooling: true,
    currentToolingInputs: true,
    ...overrides,
  })).every(Boolean)
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
  Expect(eligible({ request: { ...request, causes: ['initial', 'studio-write'] } })).toBe(false)
  Expect(eligible({ enabled: false })).toBe(false)
})
