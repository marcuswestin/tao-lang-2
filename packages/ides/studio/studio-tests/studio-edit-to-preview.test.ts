import { Assert, Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withTaoFiles } from '@shared/test'
import type { StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'
import { openStudioPreviewSession, type StudioPreviewSession } from '../studio-src/StudioPreviewSession'
import type { StudioProjectSession } from '../studio-src/StudioProjectSession'

/**
 * Two regressions covered here are invisible in compiler output alone and only appear once a
 * session is running: a save whose compile never reaches the retained preview cell, and scenario
 * groups that exist in source but not on the canvas because the first published manifest never
 * carried them.
 *
 * Everything runs the real compile lane — `openStudioPreviewSession` generates the app and
 * publishes the compiler's own manifest — so the assertions are about what the compiler produced
 * and what the session then did with it, not about a manifest the test wrote itself. It stays in
 * the ordinary lane because it needs no Metro, no browser, and no ports.
 */

const SENTINEL_BEFORE = 'Before'
const SENTINEL_AFTER = 'After typed'

/** Two scenario groups, so group reconciliation has something to reconcile. */
const projectSource = (sentinel: string) => `
  use Text from @tao/ui
  app Garden { id "garden" version "1.0.0" name "Garden" view Main }
  view Main() { render Text("${sentinel}") }
  scene Card(Title text) { render Text(Title) }
  fixture Empty { }
  scenarios Main "application" {
    fixture Empty
    device phone
    scenario "home" {
      render Main()
      network online
    }
  }
  scenarios Card "cards" {
    fixture Empty
    device phone
    scenario "lead" {
      render Card(Title: "${sentinel}")
      network online
    }
  }
`

type Harness = {
  manifest: () => StudioPreviewManifestV2
  session: StudioProjectSession
  sourcePath: string
}

/** Opens a real preview session, compiles it once, and cleans up its generated runtime. */
async function withCompiledSession(use: (harness: Harness) => Promise<void>): Promise<void> {
  const previewRuntimeRoot = await mkTestDir('tao-studio-edit-preview-runtime-')
  try {
    await withTaoFiles('tao-studio-edit-preview-', {
      'Garden.tao': projectSource(SENTINEL_BEFORE),
    }, async (paths, root) => {
      let preview: StudioPreviewSession | undefined
      try {
        preview = await openStudioPreviewSession({
          entryPath: paths['Garden.tao'],
          previewRuntimeRoot,
          projectRoot: root,
        })
        const compiled = await preview.session.compileInitial()
        if (compiled.status !== 'compiled') {
          Errors.throwUnexpected(`The fixture must compile for this suite to mean anything: ${compiled.message}`)
        }
        const session = preview.session
        await use({
          manifest: () => {
            const published = session.previewManifest()
            Assert.defined(published, 'the compiler to publish a preview manifest')
            return published
          },
          session,
          sourcePath: await FS.realPath(paths['Garden.tao']),
        })
      } finally {
        await preview?.close()
      }
    })
  } finally {
    await FS.remove(previewRuntimeRoot)
  }
}

/** Scenario ids embed the project path, so identity across runs is the part after it. */
function scenarioIdentities(manifest: StudioPreviewManifestV2): string[] {
  return manifest.scenarios.map(scenario => scenario.scenarioId.slice(scenario.scenarioId.indexOf('#'))).toSorted()
}

/** save edits through the same boundary Studio's editor uses, and reports what it returned. */
async function save(session: StudioProjectSession, content: string, writeId: string) {
  const current = await session.readFile('Garden.tao')
  return await session.syncDraft({ content, path: 'Garden.tao', sourceVersion: current.sourceVersion, writeId })
}

function groupsOf(manifest: StudioPreviewManifestV2): string[] {
  return [...new Set(manifest.scenarios.map(scenario => scenario.group))].sort()
}

Describe('Studio edit-to-preview synchronization', () => {
  Test('one save compiles once and carries the new source into the published manifest', async () => {
    await withCompiledSession(async harness => {
      const before = harness.manifest()
      Expect(JSON.stringify(before.scenarios)).toContain(SENTINEL_BEFORE)

      const source = (await harness.session.readFile('Garden.tao')).content
      const result = await save(harness.session, source.replaceAll(SENTINEL_BEFORE, SENTINEL_AFTER), 'save-1')

      Expect(result.saved).toBe(true)
      Expect(result.diagnostics).toEqual([])
      Expect(await FS.readText(harness.sourcePath)).toContain(SENTINEL_AFTER)

      const after = harness.manifest()
      // The compiler numbered this revision, not the test, and the manifest it published carries
      // the edited source. That is the whole save-to-preview path in one assertion.
      Expect(after.compileRevision).toBeGreaterThan(before.compileRevision)
      Expect(after.manifestRevision).not.toBe(before.manifestRevision)
      Expect(JSON.stringify(after.scenarios)).toContain(SENTINEL_AFTER)
      Expect(JSON.stringify(after.scenarios)).not.toContain(`"${SENTINEL_BEFORE}"`)
      // The retained cells are the same cells: a reconciliation that dropped and rebuilt them
      // would lose whatever the person had configured on each one.
      Expect(after.cells.map(cell => cell.cellId)).toEqual(before.cells.map(cell => cell.cellId))
    })
  })

  Test('an invalid draft never reaches disk, and the next save still succeeds', async () => {
    await withCompiledSession(async harness => {
      const before = await harness.session.readFile('Garden.tao')
      const revisionBefore = harness.manifest().compileRevision

      const rejected = await save(harness.session, `${before.content}\nview Broken( {`, 'save-invalid')

      Expect(rejected.saved).toBe(false)
      Expect(rejected.diagnostics.length).toBeGreaterThan(0)
      Expect(await FS.readText(harness.sourcePath)).toBe(before.content)
      Expect(harness.manifest().compileRevision).toBe(revisionBefore)

      const retried = await save(
        harness.session,
        before.content.replaceAll(SENTINEL_BEFORE, SENTINEL_AFTER),
        'save-retry',
      )

      Expect(retried.saved).toBe(true)
      Expect(harness.manifest().compileRevision).toBeGreaterThan(revisionBefore)
    })
  })

  Test('an external edit reaches the same compile-to-preview path as a save', async () => {
    await withCompiledSession(async harness => {
      const before = harness.manifest()
      const edited = (await harness.session.readFile('Garden.tao')).content
        .replaceAll(SENTINEL_BEFORE, SENTINEL_AFTER)
      await FS.writeText(harness.sourcePath, edited)

      await harness.session.noteWatchChanges([{ path: harness.sourcePath }])

      const after = harness.manifest()
      Expect(after.compileRevision).toBeGreaterThan(before.compileRevision)
      Expect(JSON.stringify(after.scenarios)).toContain(SENTINEL_AFTER)
    })
  })
})

Describe('Studio scenario startup reconciliation', () => {
  Test('the first compiler manifest carries every scenario group in source', async () => {
    await withCompiledSession(async harness => {
      const manifest = harness.manifest()

      Expect(manifest.fixtures.map(fixture => fixture.plan)).toEqual([{ accounts: [], creates: [] }])
      // Both groups are authored in Garden.tao; a manifest missing one is a canvas missing a row.
      Expect(groupsOf(manifest)).toEqual(['application', 'cards'])
      // Every scenario reaches the canvas: a scenario with no cell is a scenario nobody sees.
      Expect(manifest.cells.map(cell => cell.scenarioId).toSorted())
        .toEqual(manifest.scenarios.map(scenario => scenario.scenarioId).toSorted())
      // The compiler publishes a subject for every view in scope. What matters is that no
      // scenario points at a subject that is not there: a dangling reference is a cell the
      // canvas cannot render.
      const subjects = manifest.scenarios.map(scenario =>
        manifest.subjects.find(subject => subject.subjectId === scenario.subjectId)
      )
      Expect(subjects.every(subject => subject !== undefined)).toBe(true)
      Expect(subjects.map(subject => subject?.kind)).toEqual(['view', 'view'])
    })
  })

  Test('groups and their scenario identities survive a fresh session', async () => {
    const observed: { groups: string[]; scenarioIds: string[] }[] = []
    const record = async () => {
      await withCompiledSession(async harness => {
        const manifest = harness.manifest()
        observed.push({ groups: groupsOf(manifest), scenarioIds: scenarioIdentities(manifest) })
      })
    }

    await record()
    await record()

    Expect(observed[0]).toEqual(observed[1]!)
    Expect(observed[0]?.groups).toEqual(['application', 'cards'])
    Expect(observed[0]?.scenarioIds).toEqual(['#scenario:application:home', '#scenario:cards:lead'])
  })

  Test('groups survive a rebuild after an edit that touches no scenario', async () => {
    await withCompiledSession(async harness => {
      const before = harness.manifest()
      const source = (await harness.session.readFile('Garden.tao')).content

      const saved = await save(harness.session, `${source}\nview Aside() { render Text("aside") }\n`, 'save-aside')
      Expect(saved.saved).toBe(true)

      const after = harness.manifest()
      Expect(after.compileRevision).toBeGreaterThan(before.compileRevision)
      Expect(groupsOf(after)).toEqual(groupsOf(before))
      Expect(after.scenarios.map(scenario => scenario.scenarioId))
        .toEqual(before.scenarios.map(scenario => scenario.scenarioId))
      Expect(after.cells.map(cell => cell.cellId)).toEqual(before.cells.map(cell => cell.cellId))
    })
  })

  Test("a manifest for another app cannot replace the compiler's own", async () => {
    await withCompiledSession(async harness => {
      const current = harness.manifest()

      Expect(() =>
        harness.session.setMatrixManifest({
          ...current,
          project: { ...current.project, appName: 'SomeOtherApp' },
        })
      ).toThrow('does not match the open project and app')
      Expect(harness.manifest().manifestRevision).toBe(current.manifestRevision)
    })
  })
})
