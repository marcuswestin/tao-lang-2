import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import { StudioProjectSession, type StudioSessionEvent } from '../studio-src/StudioProjectSession'

/**
 * Two regressions this covers are invisible in compiler output and only appear once a session is
 * running: a save whose compile never reaches the retained preview cell, and scenario groups that
 * exist in source but not on the canvas because the first published manifest never carried them.
 *
 * Everything here is deterministic and cheap, so it belongs in the ordinary lane rather than the
 * smoke lane: no Metro, no browser, no ports.
 */

const SENTINEL_BEFORE = 'Before'
const SENTINEL_AFTER = 'After typed'

const projectSource = (sentinel: string) => `
data Accounts / Account { Name text }
app Garden { view MainView }
view MainView() {
  render Stack() {
    Text("${sentinel}")
  }
}
view Card(Title text, Owner Account) { render Text(Title) }
fixture Cards { Lead = create Account { Name: "Ada" } }
scenarios Card "states" {
  fixture Cards
  device phone
  scenario "lead" {
    render (Title: "${sentinel}", Owner: Lead)
  }
}
`

type CompileRequest = {
  changes: readonly { path: string; sourceVersion?: string }[]
  compileRevision: number
}

type SessionHarness = {
  compiles: readonly CompileRequest[]
  events: readonly StudioSessionEvent[]
  /** Publishes a manifest the way the compiler does at the end of one compile revision. */
  publish: (sentinel: string, compileRevision: number) => StudioPreviewManifestV2
  root: string
  session: StudioProjectSession
  sourcePath: string
}

async function withSession(
  use: (harness: SessionHarness) => Promise<void>,
  options: { appName?: string; sentinel?: string } = {},
): Promise<void> {
  await withTaoFiles('tao-studio-edit-to-preview-', {
    'Garden.tao': projectSource(options.sentinel ?? SENTINEL_BEFORE),
  }, async (paths, root) => {
    const compiles: CompileRequest[] = []
    const events: StudioSessionEvent[] = []
    const session = await StudioProjectSession.open({
      appName: options.appName,
      async compile(request) {
        compiles.push(request)
      },
      entryPath: paths['Garden.tao'],
      projectRoot: root,
    })
    session.subscribe(event => events.push(event))
    const sourcePath = await FS.realPath(paths['Garden.tao'])
    await use({
      compiles,
      events,
      publish: (sentinel, compileRevision) => {
        const manifest = compilerManifest(session, sentinel, compileRevision)
        session.setMatrixManifest(manifest)
        return session.previewManifest()!
      },
      root,
      session,
      sourcePath,
    })
  })
}

/** A manifest shaped the way the compiler publishes one, for the app the session has open. */
function compilerManifest(
  session: StudioProjectSession,
  sentinel: string,
  compileRevision: number,
): StudioPreviewManifestV2 {
  const source = { kind: 'tao' as const, path: `${session.projectRoot}/Garden.tao`, range: { end: 20, start: 0 } }
  const environment = (presetId: string, width: number, height: number) => ({
    network: { latencyMs: 0, outcome: 'normal' as const },
    scheme: { requested: 'light' as const, status: 'inert' as const },
    viewport: { height, presetId, width },
  })
  return {
    capabilities: { captureDomains: ['data', 'scene'], scheme: 'inert' },
    cells: [
      {
        args: { title: sentinel },
        cellId: 'card-phone',
        cellRevision: 0,
        environment: environment('phone', 390, 844),
        scenarioId: 'card-states-lead',
        stateLayers: [],
      },
      {
        args: {},
        cellId: 'app-desktop',
        cellRevision: 0,
        environment: environment('desktop', 1440, 900),
        scenarioId: 'application-main',
        stateLayers: [],
      },
    ],
    compileRevision,
    fixtures: [{ fixtureId: 'fixture:cards', label: 'Cards', plan: {}, source }],
    generationDeclarations: [],
    manifestRevision: `manifest-${compileRevision}`,
    parametersBySubject: {
      card: [{ label: 'Title', parameterId: 'title', required: true, type: { kind: 'text' } }],
      garden: [],
    },
    project: {
      appName: session.appName,
      entryPath: `${session.projectRoot}/Garden.tao`,
      root: session.projectRoot,
    },
    scenarios: [
      {
        args: { title: sentinel },
        fixtureId: 'fixture:cards',
        group: 'Cards',
        label: 'Lead',
        prepare: [],
        scenarioId: 'card-states-lead',
        source,
        stateLayers: [],
        subjectId: 'card',
      },
      {
        args: {},
        fixtureId: 'fixture:cards',
        group: 'Application',
        label: 'Main',
        prepare: [],
        scenarioId: 'application-main',
        source,
        stateLayers: [],
        subjectId: 'garden',
      },
    ],
    sourceVersions: { [`${session.projectRoot}/Garden.tao`]: `text-v1:${compileRevision}` },
    states: [],
    subjects: [
      { kind: 'view', source, subjectId: 'card', viewName: 'Card' },
      { appName: session.appName, kind: 'app', source, subjectId: 'garden' },
    ],
    version: 2,
  }
}

Describe('Studio edit-to-preview synchronization', () => {
  Test('one save writes once, compiles once, and advances the published manifest', async () => {
    await withSession(async harness => {
      const before = await harness.session.readFile('Garden.tao')
      // The initial compile is revision 0; the coordinator numbers the save's compile itself.
      harness.publish(SENTINEL_BEFORE, 0)
      const initialManifest = harness.session.previewManifest()!
      Expect(initialManifest.compileRevision).toBe(0)
      Expect(cellArgs(initialManifest, 'card-phone')['title']).toBe(SENTINEL_BEFORE)

      const edited = before.content.replaceAll(SENTINEL_BEFORE, SENTINEL_AFTER)
      const result = await harness.session.syncDraft({
        content: edited,
        path: 'Garden.tao',
        sourceVersion: before.sourceVersion,
        writeId: 'save-1',
      })

      Expect(result.saved).toBe(true)
      Expect(result.diagnostics).toEqual([])
      // Exactly one logical write: the file on disk carries the edit, and the coordinator was
      // told about it once. A second compile here would mean Studio raced its own save.
      Expect(await FS.readText(harness.sourcePath)).toBe(edited)
      Expect(harness.compiles.length).toBe(1)
      Expect(harness.compiles[0]?.changes.map(change => change.path)).toEqual([harness.sourcePath])

      const after = harness.publish(SENTINEL_AFTER, harness.compiles[0]!.compileRevision)
      Expect(after.compileRevision).toBeGreaterThan(initialManifest.compileRevision)
      Expect(after.manifestRevision).not.toBe(initialManifest.manifestRevision)
      // The retained cell is the same cell, carrying the new source's sentinel.
      Expect(after.cells.map(cell => cell.cellId)).toEqual(initialManifest.cells.map(cell => cell.cellId))
      Expect(cellArgs(after, 'card-phone')['title']).toBe(SENTINEL_AFTER)
    })
  })

  Test('an invalid draft never reaches disk, and the next save still succeeds', async () => {
    await withSession(async harness => {
      const before = await harness.session.readFile('Garden.tao')
      const broken = `${before.content}\nview Broken( {`

      const rejected = await harness.session.syncDraft({
        content: broken,
        path: 'Garden.tao',
        sourceVersion: before.sourceVersion,
        writeId: 'save-invalid',
      })

      Expect(rejected.saved).toBe(false)
      Expect(rejected.diagnostics.length).toBeGreaterThan(0)
      Expect(await FS.readText(harness.sourcePath)).toBe(before.content)
      Expect(harness.compiles.length).toBe(0)

      // The retry is the same save boundary again: a failed write must not need a restart.
      const retried = await harness.session.syncDraft({
        content: before.content.replaceAll(SENTINEL_BEFORE, SENTINEL_AFTER),
        path: 'Garden.tao',
        sourceVersion: before.sourceVersion,
        writeId: 'save-retry',
      })

      Expect(retried.saved).toBe(true)
      Expect(await FS.readText(harness.sourcePath)).toContain(SENTINEL_AFTER)
      Expect(harness.compiles.length).toBe(1)
    })
  })

  Test('an external edit reaches the same compile-to-preview path as a save', async () => {
    await withSession(async harness => {
      harness.publish(SENTINEL_BEFORE, 1)
      const edited = (await harness.session.readFile('Garden.tao')).content
        .replaceAll(SENTINEL_BEFORE, SENTINEL_AFTER)
      await FS.writeText(harness.sourcePath, edited)

      await harness.session.noteWatchChanges([{ path: harness.sourcePath }])

      Expect(harness.compiles.length).toBe(1)
      Expect(harness.compiles[0]?.changes.map(change => change.path)).toEqual([harness.sourcePath])
      const after = harness.publish(SENTINEL_AFTER, harness.compiles[0]!.compileRevision)
      Expect(cellArgs(after, 'card-phone')['title']).toBe(SENTINEL_AFTER)
    })
  })

  Test('publishing a manifest tells every subscribed client, so no reload is needed', async () => {
    await withSession(async harness => {
      harness.publish(SENTINEL_BEFORE, 1)
      harness.publish(SENTINEL_AFTER, 2)

      const published = harness.events.filter(event => event.type === 'preview-manifest-changed')
      Expect(published.length).toBe(2)
      Expect(published.map(event => (event as { manifest: StudioPreviewManifestV2 }).manifest.compileRevision))
        .toEqual([1, 2])
    })
  })
})

Describe('Studio scenario startup reconciliation', () => {
  Test('the first published manifest carries every scenario group and entry in source', async () => {
    await withSession(async harness => {
      const manifest = harness.publish(SENTINEL_BEFORE, 1)

      Expect(manifest.scenarios.map(scenario => scenario.group)).toEqual(['Cards', 'Application'])
      Expect(manifest.scenarios.map(scenario => scenario.scenarioId))
        .toEqual(['card-states-lead', 'application-main'])
      // Every scenario must reach the canvas: a cell it has no cell for is a scenario nobody sees.
      Expect(manifest.cells.map(cell => cell.scenarioId).toSorted())
        .toEqual(manifest.scenarios.map(scenario => scenario.scenarioId).toSorted())
    })
  })

  Test('groups survive a restart of the session', async () => {
    const groupsOf = async () => {
      let groups: readonly string[] = []
      await withSession(async harness => {
        groups = harness.publish(SENTINEL_BEFORE, 1).scenarios.map(scenario => scenario.group)
      })
      return groups
    }

    Expect(await groupsOf()).toEqual(['Cards', 'Application'])
    Expect(await groupsOf()).toEqual(['Cards', 'Application'])
  })

  Test('groups survive a rebuild after an unrelated source edit', async () => {
    await withSession(async harness => {
      const first = harness.publish(SENTINEL_BEFORE, 1)
      const before = await harness.session.readFile('Garden.tao')
      await harness.session.syncDraft({
        // An addition that touches no scenario at all.
        content: `${before.content}\nview Unrelated() { render Text("aside") }\n`,
        path: 'Garden.tao',
        sourceVersion: before.sourceVersion,
        writeId: 'save-unrelated',
      })
      const rebuilt = harness.publish(SENTINEL_BEFORE, harness.compiles[0]!.compileRevision)

      Expect(rebuilt.scenarios.map(scenario => scenario.group)).toEqual(first.scenarios.map(s => s.group))
      Expect(rebuilt.cells.map(cell => cell.cellId)).toEqual(first.cells.map(cell => cell.cellId))
    })
  })

  Test("a manifest for another app cannot replace the current session's", async () => {
    await withSession(async harness => {
      const current = harness.publish(SENTINEL_BEFORE, 1)
      const foreign = {
        ...compilerManifest(harness.session, SENTINEL_AFTER, 2),
        project: {
          appName: 'SomeOtherApp',
          entryPath: `${harness.session.projectRoot}/Garden.tao`,
          root: harness.session.projectRoot,
        },
      }

      Expect(() => harness.session.setMatrixManifest(foreign))
        .toThrow('does not match the open project and app')
      Expect(harness.session.previewManifest()?.manifestRevision).toBe(current.manifestRevision)
    })
  })

  Test("switching app variants publishes that variant's own manifest", async () => {
    await withSession(async harness => {
      Expect(harness.session.appName).toBe('Garden')
      const manifest = harness.publish(SENTINEL_BEFORE, 1)

      Expect(manifest.project.appName).toBe('Garden')
      Expect(manifest.project.root).toBe(harness.session.projectRoot)
    }, { appName: 'Garden' })
  })
})

function cellArgs(manifest: StudioPreviewManifestV2, cellId: string): Record<string, unknown> {
  return manifest.cells.find(cell => cell.cellId === cellId)?.args ?? {}
}
