import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { discoverShipProject, selectShipApp, writeProjectVersion } from '../cli-src/ship-project'

const projectSource = `
app Notes { id "notes" version "1.2.3" name "Notes" view Main }
app NotesBeta = Notes with { id "notes-beta", name "Notes Beta" }
view Main() { render inject \`\`\`ts return null \`\`\` }
`

Describe('tao ship project discovery', () => {
  Test('climbs to the marker and resolves effective app metadata', async () => {
    await withTaoFiles('tao-ship-project-', {
      'App.tao': projectSource,
      'nested/deeper/Other.tao': 'view Other() { render inject ```ts return null ``` }',
    }, async paths => {
      const project = await discoverShipProject(FS.dirname(paths['nested/deeper/Other.tao']!))
      Expect(project.apps.find(app => app.name === 'Notes')?.id).toBe('notes')
      Expect(project.apps.find(app => app.name === 'NotesBeta')?.version).toBe('1.2.3')
      Expect(project.primaryAppName).toBe('Notes')
      Expect(selectShipApp(project)).toBeUndefined()
      Expect(selectShipApp(project, 'NotesBeta')?.displayName).toBe('Notes Beta')
      Expect(selectShipApp(project, 'NotesBeta')?.isVariant).toBe(true)
      Expect(selectShipApp(project, 'Notes')?.name).toBe('Notes')
    })
  })

  Test('ignores test sidecar app declarations beside the release app', async () => {
    await withTaoFiles('tao-ship-project-', {
      'App.tao': projectSource,
      'Harness.test.tao': `
        app Harness { id "notes-harness" version "1.0.0" name "Harness" view HarnessView }
        view HarnessView() { render inject \`\`\`ts return null \`\`\` }
      `,
    }, async paths => {
      const project = await discoverShipProject(paths['App.tao']!)
      Expect(project.root).toBe(FS.dirname(paths['App.tao']!))
      Expect(project.apps.map(app => app.name)).toEqual(['Notes', 'NotesBeta'])
    })
  })

  Test('discovers a module app and a cross-file variant under one marked root', async () => {
    await withTaoFiles('tao-ship-split-project-', {
      'Apps/Notes.tao': `
        use NotesBase from @notes
        project app NotesBeta = NotesBase with { id "split-notes-beta", name "Notes Beta" }
      `,
      '@notes/App.tao': `
        public app NotesBase { id "split-notes" version "1.2.3" name "Notes" view Main }
        view Main() { render inject \`\`\`ts return null \`\`\` }
      `,
    }, async (paths, root) => {
      const project = await discoverShipProject(paths['Apps/Notes.tao']!)

      Expect(project.root).toBe(root)
      Expect(project.apps.map(app => app.name)).toEqual(['NotesBase', 'NotesBeta'])
      Expect(selectShipApp(project, 'NotesBeta')?.sourcePath).toBe(paths['Apps/Notes.tao'])
      Expect(project.primaryAppName).toBe('NotesBase')
    })
  })

  Test('derives inherited ship metadata without inspecting unrelated sibling declarations', async () => {
    await withTaoFiles('tao-ship-metadata-graph-', {
      'Apps/Target.tao': `
        use TargetInstantDBBase, CloudBase from @metadata
        project app TargetInstantDBBeta = TargetInstantDBBase with { id "target-beta", name "Target Beta" }
        project app CloudBeta = CloudBase with { id "cloud-beta", name "Cloud Beta" }
      `,
      '@metadata/App.tao': `
        use Dev from @tao/data/providers/dev
        use ICloud from @tao/data/providers/icloud
        use InstantDB from @tao/data/providers/instantdb

        public app TargetInstantDBBase {
          id "target-base"
          version "1.2.3"
          name "Target"
          Datasource TargetStore
          view Main
        }
        public datasource TargetStore = InstantDB {
          AppId "9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f",
          ApiURI "http://localhost:9020",
          WebsocketURI "ws://localhost:9020/runtime/session"
        }

        public app CloudBase {
          id "cloud-base"
          version "1.2.3"
          name "Cloud"
          Datasource ICloud { Container "iCloud.target.notes" }
          view Main
        }

        app UnrelatedDev { id "unrelated-dev" version "1.2.3" name "Unrelated" Datasource Dev { } view Main }
        datasource UnrelatedStore = InstantDB {
          AppId "unrelated-app-id",
          ApiURI "http://localhost:9030",
          WebsocketURI "ws://localhost:9030/runtime/session"
        }
        view Main() { render inject \`\`\`ts return null \`\`\` }
      `,
    }, async paths => {
      const project = await discoverShipProject(paths['Apps/Target.tao']!)
      const instant = selectShipApp(project, 'TargetInstantDBBeta')
      const cloud = selectShipApp(project, 'CloudBeta')

      Expect(instant?.usesDevDatasource).toBe(false)
      Expect(instant?.hasLocalDatasourceEndpoint).toBe(true)
      Expect(instant?.releaseDatasourceConfiguration).toEqual({
        ApiURI: 'https://api.instantdb.com',
        AppId: '9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f',
        WebsocketURI: 'wss://api.instantdb.com/runtime/session',
      })
      Expect(cloud?.icloud).toEqual({
        serviceBindings: [{
          containers: ['iCloud.target.notes'],
          service: 'CloudDocuments',
          usesDefaultContainer: false,
        }],
      })
      Expect(cloud?.hasLocalDatasourceEndpoint).toBe(false)
      Expect(cloud?.usesDevDatasource).toBe(false)
    })
  })

  Test('writes the version in canonical source', async () => {
    await withTaoFiles('tao-ship-project-', { 'App.tao': projectSource }, async paths => {
      const project = await discoverShipProject(paths['App.tao']!)
      await writeProjectVersion(selectShipApp(project, 'NotesBeta')!, '2.0.0-beta.1')
      const source = await FS.readText(paths['App.tao']!)
      Expect(source).toContain('version "2.0.0-beta.1"')
      Expect(source).toContain('app Notes {\n   id "notes"\n   version "1.2.3"')
      Expect(await FS.listDir(FS.resolvePath('.tao/cache/tmp', project.root))).toEqual([])
      Expect(await FS.listDir(FS.resolvePath('.tao/cache/locks', project.root))).toEqual([])
    })
  })

  for (const [name, patch] of [['Trailing', '{ id "notes-trailing", }'], ['Empty', '{ }']] as const) {
    Test(
      `writes an inherited version in a variant patch with ${name === 'Trailing' ? 'a trailing comma' : 'no entries'}`,
      async () => {
        await withTaoFiles('tao-ship-project-', {
          'App.tao': projectSource,
        }, async paths => {
          const project = await discoverShipProject(paths['App.tao']!)
          // An empty variant initially duplicates its base's release identity; version it before discovery.
          await FS.writeText(paths['App.tao']!, `${projectSource}\napp Notes${name} = Notes with ${patch}\n`)
          await writeProjectVersion({ ...selectShipApp(project, 'Notes')!, name: `Notes${name}` }, '2.0.0-beta.1')
          const updated = await discoverShipProject(paths['App.tao']!)
          Expect(selectShipApp(updated, `Notes${name}`)?.version).toBe('2.0.0-beta.1')
          Expect(selectShipApp(updated, `Notes${name}`)?.id).toBe(name === 'Trailing' ? 'notes-trailing' : 'notes')
          Expect(selectShipApp(updated, 'Notes')?.version).toBe('1.2.3')
          Expect(await FS.listDir(FS.resolvePath('.tao/cache/tmp', project.root))).toEqual([])
          Expect(await FS.listDir(FS.resolvePath('.tao/cache/locks', project.root))).toEqual([])
        })
      },
    )
  }

  Test('reads every provider an app mounts through its variants, declarations, and types', async () => {
    const source = `
use CloudKit from @tao/data/providers/cloudkit
use ICloud from @tao/data/providers/icloud
use Local from @tao/data/providers/local
use StackNav from @tao/nav

app Notes { id "notes" version "1.0.0" name "Notes" Navigator StackNav { Initial Main } Datasource NotesCloud }
app NotesDevice = Notes with { id "notes-device", Datasource Local { StorageKey "Notes" } }
app NotesInherited = Notes with { id "notes-inherited", name "Notes Beta" }
app NotesInline = Notes with { id "notes-inline", Datasource ICloud { Container "iCloud.custom.notes" } }
app NotesPatched = Notes with { id "notes-patched", Datasource with { Container "iCloud.patched.notes" } }
app NotesTyped = Notes with { id "notes-typed", Datasource TypedCloud { } }
app NotesKit = Notes with { id "notes-kit", Datasource CloudKit { Container "iCloud.lang.tao.kitchen" } }

datasource NotesCloud = ICloud { StorageKey "Notes" }
type TypedCloud is ICloud with { Container is "iCloud.typed.notes" }
view Main() { render inject \`\`\`ts return null \`\`\` }
`
    await withTaoFiles('tao-ship-icloud-', { 'App.tao': source }, async paths => {
      const project = await discoverShipProject(paths['App.tao']!)
      const icloudOf = (name: string) => project.apps.find(app => app.name === name)?.icloud
      const documents = {
        serviceBindings: [{ containers: [], service: 'CloudDocuments', usesDefaultContainer: true }],
      }

      // A named declaration, an inherited variant, an inline construction, a patch of the base's
      // binding, and a reusable type all name the same provider.
      Expect(icloudOf('Notes')).toEqual(documents)
      Expect(icloudOf('NotesInherited')).toEqual(documents)
      Expect(icloudOf('NotesInline')).toEqual({
        serviceBindings: [{
          containers: ['iCloud.custom.notes'],
          service: 'CloudDocuments',
          usesDefaultContainer: false,
        }],
      })
      Expect(icloudOf('NotesPatched')).toEqual({
        serviceBindings: [{
          containers: ['iCloud.patched.notes'],
          service: 'CloudDocuments',
          usesDefaultContainer: false,
        }],
      })
      Expect(icloudOf('NotesTyped')).toEqual({
        serviceBindings: [{
          containers: ['iCloud.typed.notes'],
          service: 'CloudDocuments',
          usesDefaultContainer: false,
        }],
      })
      // CloudKit is the other Apple provider, and entitles its own service.
      Expect(icloudOf('NotesKit')).toEqual({
        serviceBindings: [{
          containers: ['iCloud.lang.tao.kitchen'],
          service: 'CloudKit',
          usesDefaultContainer: false,
        }],
      })
      // A variant that binds a device store mounts no Apple provider at all.
      Expect(icloudOf('NotesDevice')).toBeUndefined()
    })
  })

  Test('combines both Apple services when one app mounts two data stores', async () => {
    await withTaoFiles('tao-ship-apple-providers-', {
      'App.tao': `
        use CloudKit from @tao/data/providers/cloudkit
        use ICloud from @tao/data/providers/icloud
        use StackNav from @tao/nav

        data Documents / Document { Title text }
        data Records / Record { Title text }
        datasource DocumentStore = ICloud { Container "iCloud.lang.tao.documents", Data { Documents } }
        datasource RecordStore = CloudKit { Container "iCloud.lang.tao.records", Data { Records } }
        app Notes {
          id "notes"
          version "1.0.0"
          name "Notes"
          Navigator StackNav { Initial Main }
          Datasource { DocumentStore, RecordStore }
        }
        view Main() { render inject \`\`\`ts return null \`\`\` }
      `,
    }, async paths => {
      const project = await discoverShipProject(paths['App.tao']!)
      Expect(selectShipApp(project)?.icloud).toEqual({
        serviceBindings: [
          {
            containers: ['iCloud.lang.tao.documents'],
            service: 'CloudDocuments',
            usesDefaultContainer: false,
          },
          {
            containers: ['iCloud.lang.tao.records'],
            service: 'CloudKit',
            usesDefaultContainer: false,
          },
        ],
      })
    })
  })

  Test('reads the providers of every datasource an app binds, not only the first', async () => {
    const source = `
use CloudKit from @tao/data/providers/cloudkit
use Dev from @tao/data/providers/dev
use StackNav from @tao/nav

data Stories / Story { HnId number (unique), Title text }
data Bookmarks / Bookmark { Story (reference) }

datasource Feed = Dev { Data { Stories } }
datasource Personal = CloudKit { Container "iCloud.lang.tao.reader", Data { Bookmarks } }

app Reader {
   id "reader"
   version "1.0.0"
   name "Reader"
   Navigator StackNav { Initial Main }
   Datasource { Feed, Personal }
}
view Main() { render inject \`\`\`ts return null \`\`\` }
`
    await withTaoFiles('tao-ship-multi-', { 'App.tao': source }, async paths => {
      const project = await discoverShipProject(paths['App.tao']!)
      const reader = project.apps.find(app => app.name === 'Reader')!

      // The Dev binding still refuses to ship alongside the Apple store.
      Expect(reader.usesDevDatasource).toBe(true)
      // The Apple entitlement comes from the other binding.
      Expect(reader.icloud).toEqual({
        serviceBindings: [{
          containers: ['iCloud.lang.tao.reader'],
          service: 'CloudKit',
          usesDefaultContainer: false,
        }],
      })
    })
  })

  Test('derives hosted InstantDB endpoints from the datasource an app actually binds', async () => {
    const source = `
use InstantDB from @tao/data/providers/instantdb
use Local from @tao/data/providers/local
use StackNav from @tao/nav

datasource Store = InstantDB {
   AppId "9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f",
   ApiURI "http://localhost:9020",
   WebsocketURI "ws://localhost:9020/runtime/session"
}

app Notes { id "notes" version "1.0.0" name "Notes" Navigator StackNav { Initial Main } Datasource Store }
app NotesDevice = Notes with { id "notes-device", name "Notes Device", Datasource Local { StorageKey "Notes" } }
view Main() { render inject \`\`\`ts return null \`\`\` }
`
    await withTaoFiles('tao-ship-instant-', { '.tao/.gitkeep': '', 'App.tao': source }, async paths => {
      const project = await discoverShipProject(paths['App.tao']!)
      const notes = project.apps.find(app => app.name === 'Notes')!
      const device = project.apps.find(app => app.name === 'NotesDevice')!

      Expect(notes.hasLocalDatasourceEndpoint).toBe(true)
      Expect(notes.releaseDatasourceConfiguration).toEqual({
        ApiURI: 'https://api.instantdb.com',
        AppId: '9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f',
        WebsocketURI: 'wss://api.instantdb.com/runtime/session',
      })
      // The variant swapped the store, so it carries neither the warning nor the patch.
      Expect(device.hasLocalDatasourceEndpoint).toBe(false)
      Expect(device.releaseDatasourceConfiguration).toBeUndefined()
    })
  })
})
