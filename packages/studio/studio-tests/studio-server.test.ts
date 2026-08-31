import { ScriptedGenerationProvider } from '@generation'
import { Describe, Expect, Test } from '@shared/test'
import { StudioFixtureGeneration } from '../studio-src/StudioFixtureGeneration'
import type { StudioPreviewManifestV1 } from '../studio-src/StudioPreviewManifest'
import type { StudioProjectSession } from '../studio-src/StudioProjectSession'
import { StudioServerTesting } from '../studio-src/StudioServer'

Describe('Studio server request boundary', () => {
  const boundOrigin = 'http://127.0.0.1:5678'

  Test('rejects a rebinding Host even when Origin agrees with the hostile host', () => {
    const requestUrl = new URL('http://hostile.example:5678/api/files')
    const request = new Request(requestUrl, { headers: { origin: requestUrl.origin } })

    Expect(StudioServerTesting.requestAllowed(request, requestUrl, boundOrigin, undefined)).toBe(false)
  })

  Test('accepts the bound origin and explicitly configured preview origins', () => {
    const requestUrl = new URL(`${boundOrigin}/api/files`)
    const sameOrigin = new Request(requestUrl, { headers: { origin: boundOrigin } })
    const previewOrigin = new Request(requestUrl, { headers: { origin: 'http://127.0.0.1:8081' } })

    Expect(StudioServerTesting.requestAllowed(sameOrigin, requestUrl, boundOrigin, undefined)).toBe(true)
    Expect(StudioServerTesting.requestAllowed(
      previewOrigin,
      requestUrl,
      boundOrigin,
      ['http://127.0.0.1:8081'],
    )).toBe(true)
  })

  Test('formats IPv4 and IPv6 bound origins without trusting the request Host', () => {
    Expect(StudioServerTesting.serverOrigin('http:', '127.0.0.1', 5678)).toBe(boundOrigin)
    Expect(StudioServerTesting.serverOrigin('http:', '::1', 5678)).toBe('http://[::1]:5678')
  })

  Test('serves injected availability and generated fixtures over the Studio HTTP surface', async () => {
    const manifest = generationManifest()
    const session = {
      previewManifest: () => manifest,
      subscribe: () => () => {},
    } as unknown as StudioProjectSession
    const generation = new StudioFixtureGeneration(
      new ScriptedGenerationProvider([
        { kind: 'answer', value: { Title: 'A Realistic Workspace' } },
      ]),
    )
    const options = {}
    const availabilityUrl = new URL('http://127.0.0.1:5678/api/ai/availability')
    const fixtureUrl = new URL('http://127.0.0.1:5678/api/ai/fixture')
    const availability = await StudioServerTesting.handleRequest(
      session,
      generation,
      new Request(availabilityUrl),
      availabilityUrl,
      options,
    )
    const fixture = await StudioServerTesting.handleRequest(
      session,
      generation,
      new Request(fixtureUrl, {
        body: JSON.stringify({ scenarioId: 'Workspace.focused' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      fixtureUrl,
      options,
    )

    Expect(availability.status).toBe(200)
    Expect(await availability.json()).toEqual({ status: 'available' })
    Expect(fixture.status).toBe(200)
    Expect(await fixture.json()).toMatchObject({
      fixture: {
        creates: [{ entity: 'Workspace', fields: { Title: 'A Realistic Workspace' }, name: 'Main' }],
      },
      status: 'ready',
    })
  })
})

function generationManifest(): StudioPreviewManifestV1 {
  const source = { kind: 'tao' as const, path: '/project/Scenarios.tao', range: { end: 100, start: 0 } }
  return {
    capabilities: { captureDomains: ['data'], scheme: 'inert' },
    cells: [],
    compileRevision: 1,
    fixtures: [{
      fixtureId: 'fixture:WorkspaceState',
      label: 'WorkspaceState',
      plan: {
        accounts: [],
        creates: [{ entity: 'Workspace', fields: { Title: 'Old' }, name: 'Main' }],
      },
      source,
    }],
    generationDeclarations: [{
      collection: 'Workspaces',
      fields: [{ name: 'Title', optional: false, secret: false, type: { kind: 'scalar', scalar: 'text' } }],
      kind: 'entity',
      name: 'Workspace',
    }],
    manifestRevision: 'compile:1',
    parametersBySubject: { 'view:Workspace': [] },
    project: { appName: 'WordFlower', entryPath: '/project/WordFlower.tao', root: '/project' },
    scenarios: [{
      args: {},
      fixtureId: 'fixture:WorkspaceState',
      label: 'Workspace.focused',
      prepare: [],
      scenarioId: 'Workspace.focused',
      source,
      stateLayers: [],
      subjectId: 'view:Workspace',
    }],
    sourceVersions: { '/project/Scenarios.tao': 'text-v1:scenarios' },
    states: [],
    subjects: [{ kind: 'view', source, subjectId: 'view:Workspace', viewName: 'Workspace' }],
    version: 1,
  }
}
