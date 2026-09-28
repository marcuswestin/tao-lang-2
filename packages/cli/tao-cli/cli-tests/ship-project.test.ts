import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { discoverShipProject, selectShipApp, writeProjectVersion } from '../cli-src/ship-project'

const projectSource = `
project {
  id "notes"
  name "Notes"
  version "1.2.3"
  app NotesBeta
}
app Notes { view Main }
app NotesBeta = Notes with { Name "Notes Beta" }
view Main() { }
`

Describe('tao ship project discovery', () => {
  Test('climbs to metadata and resolves app', async () => {
    await withTaoFiles('tao-ship-project-', {
      'App.tao': projectSource,
      'nested/deeper/Other.tao': 'view Other() { }',
    }, async paths => {
      const project = await discoverShipProject(FS.dirname(paths['nested/deeper/Other.tao']!))
      Expect(project.id).toBe('notes')
      Expect(project.version).toBe('1.2.3')
      Expect(project.primaryAppName).toBe('Notes')
      Expect(selectShipApp(project)?.name).toBe('NotesBeta')
      Expect(selectShipApp(project)?.displayName).toBe('Notes Beta')
      Expect(selectShipApp(project)?.isVariant).toBe(true)
      Expect(selectShipApp(project, 'Notes')?.name).toBe('Notes')
    })
  })

  Test('ignores a test sidecar project beside the release project', async () => {
    await withTaoFiles('tao-ship-project-', {
      'App.tao': projectSource,
      'Harness.test.tao': `
        project { id "notes-harness" name "Notes Harness" }
        app Harness { view HarnessView }
        view HarnessView() { }
      `,
    }, async paths => {
      const project = await discoverShipProject(paths['App.tao']!)
      Expect(project.projectSourcePath).toBe(paths['App.tao'])
      Expect(project.apps.map(app => app.name)).toEqual(['Notes', 'NotesBeta'])
    })
  })

  Test('discovers a package app and a cross-file variant under root project metadata', async () => {
    await withTaoFiles('tao-ship-split-project-', {
      'Project.tao': `
        project {
          id "split-notes"
          name "Split notes"
          version "1.2.3"
          app NotesBeta
        }
      `,
      'Apps/Notes.tao': `
        use NotesBase from @notes
        workspace app NotesBeta = NotesBase with { Name "Notes Beta" }
      `,
      'packages/@notes/App.tao': `
        public app NotesBase { Name "Notes" view Main }
        view Main() { }
      `,
    }, async paths => {
      const project = await discoverShipProject(paths['Apps/Notes.tao']!)

      Expect(project.root).toBe(FS.dirname(paths['Project.tao']!))
      Expect(project.apps.map(app => app.name)).toEqual(['NotesBase', 'NotesBeta'])
      Expect(selectShipApp(project)?.sourcePath).toBe(paths['Apps/Notes.tao'])
      Expect(project.primaryAppName).toBe('NotesBase')
    })
  })

  Test('derives inherited ship metadata without inspecting unrelated sibling declarations', async () => {
    await withTaoFiles('tao-ship-metadata-graph-', {
      'Project.tao': `
        project {
          id "metadata-graph"
          name "Metadata graph"
          version "1.2.3"
          app TargetInstantDBBeta
        }
      `,
      'Apps/Target.tao': `
        use TargetInstantDBBase, CloudBase from @metadata
        workspace app TargetInstantDBBeta = TargetInstantDBBase with { Name "Target Beta" }
        workspace app CloudBeta = CloudBase with { Name "Cloud Beta" }
      `,
      'packages/@metadata/App.tao': `
        use Dev from @tao/data/providers/dev
        use ICloud from @tao/data/providers/icloud
        use InstantDB from @tao/data/providers/instantdb

        public app TargetInstantDBBase {
          Datasource TargetStore
          view Main
        }
        public datasource TargetStore = InstantDB {
          AppId "9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f"
          ApiURI "http://localhost:9020"
          WebsocketURI "ws://localhost:9020/runtime/session"
        }

        public app CloudBase {
          Datasource ICloud { Container "iCloud.target.notes" }
          view Main
        }

        app UnrelatedDev { Datasource Dev view Main }
        datasource UnrelatedStore = InstantDB {
          AppId "unrelated-app-id"
          ApiURI "http://localhost:9030"
          WebsocketURI "ws://localhost:9030/runtime/session"
        }
        view Main() { }
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
      await writeProjectVersion(project, '2.0.0')
      Expect(await FS.readText(paths['App.tao']!)).toContain('version "2.0.0"')
    })
  })

  Test('reads every provider an app mounts through its variants, declarations, and types', async () => {
    const source = `
project { id "notes" name "Notes" version "1.0.0" }
use CloudKit from @tao/data/providers/cloudkit
use ICloud from @tao/data/providers/icloud
use Local from @tao/data/providers/local
use StackNav from @tao/nav

app Notes { Name "Notes" Navigator StackNav { Initial Main } Datasource NotesCloud }
app NotesDevice = Notes with { Datasource Local { StorageKey "Notes" } }
app NotesInherited = Notes with { Name "Notes Beta" }
app NotesInline = Notes with { Datasource ICloud { Container "iCloud.custom.notes" } }
app NotesPatched = Notes with { Datasource with { Container "iCloud.patched.notes" } }
app NotesTyped = Notes with { Datasource TypedCloud { } }
app NotesKit = Notes with { Datasource CloudKit { Container "iCloud.lang.tao.kitchen" } }
app NotesBoth = Notes with {
  Datasource { Documents, Records }
}

datasource NotesCloud = ICloud { StorageKey "Notes" }
datasource Documents = ICloud { Container "iCloud.lang.tao.documents" }
datasource Records = CloudKit { Container "iCloud.lang.tao.records" }
type TypedCloud is ICloud with { Container is "iCloud.typed.notes" }
view Main() { }
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
      Expect(icloudOf('NotesBoth')).toEqual({
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
      // A variant that binds a device store mounts no Apple provider at all.
      Expect(icloudOf('NotesDevice')).toBeUndefined()
    })
  })

  Test('reads the providers of every datasource an app binds, not only the first', async () => {
    const source = `
project { id "reader" name "Reader" version "1.0.0" }
use CloudKit from @tao/data/providers/cloudkit
use Dev from @tao/data/providers/dev
use StackNav from @tao/nav

data Stories / Story { HnId number (unique) Title text }
data Bookmarks / Bookmark { Story (reference) }

datasource Feed = Dev { Data { Stories } }
datasource Personal = CloudKit { Container "iCloud.lang.tao.reader" Data { Bookmarks } }

app Reader {
   Name "Reader"
   Navigator StackNav { Initial Main }
   Datasource { Feed, Personal }
}
view Main() { }
`
    await withTaoFiles('tao-ship-multi-', { 'App.tao': source }, async paths => {
      const project = await discoverShipProject(paths['App.tao']!)
      const reader = project.apps.find(app => app.name === 'Reader')!

      // The Dev store is the second binding, and it still refuses to ship.
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
project { id "notes" name "Notes" version "1.0.0" }
use InstantDB from @tao/data/providers/instantdb
use Local from @tao/data/providers/local
use StackNav from @tao/nav

datasource Store = InstantDB {
   AppId "9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f"
   ApiURI "http://localhost:9020"
   WebsocketURI "ws://localhost:9020/runtime/session"
}

app Notes { Name "Notes" Navigator StackNav { Initial Main } Datasource Store }
app NotesDevice = Notes with { Datasource Local { StorageKey "Notes" } }
view Main() { }
`
    await withTaoFiles('tao-ship-instant-', { 'App.tao': source }, async paths => {
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
