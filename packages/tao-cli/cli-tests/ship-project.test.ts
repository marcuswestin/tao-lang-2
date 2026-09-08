import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import {
  deriveHostedDatasourceConfiguration,
  deriveICloudBinding,
  discoverShipProject,
  selectShipApp,
  writeProjectVersion,
} from '../cli-src/ship-project'

const projectSource = `
project {
  id "notes"
  name "Notes"
  version "1.2.3"
  DefaultApp NotesBeta
}
app Notes { view Main }
app NotesBeta = Notes with { Name "Notes Beta" }
view Main() { }
`

Describe('tao ship project discovery', () => {
  Test('climbs to metadata and resolves DefaultApp', async () => {
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

  Test('discovers a package app and a cross-file variant under root project metadata', async () => {
    await withTaoFiles('tao-ship-split-project-', {
      'Project.tao': `
        project {
          id "split-notes"
          name "Split notes"
          version "1.2.3"
          DefaultApp NotesBeta
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
          DefaultApp TargetInstantDBBeta
        }
      `,
      'Apps/Target.tao': `
        use TargetInstantDBBase, CloudBase from @metadata
        workspace app TargetInstantDBBeta = TargetInstantDBBase with { Name "Target Beta" }
        workspace app CloudBeta = CloudBase with { Name "Cloud Beta" }
      `,
      'packages/@metadata/App.tao': `
        use ICloud from @tao/data/providers/icloud

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
        container: 'iCloud.target.notes',
        services: ['CloudDocuments'],
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

  Test('derives hosted InstantDB endpoints without changing local source configuration', () => {
    const local = `datasource Store = InstantDB {
      AppId "9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f"
      ApiURI "http://localhost:9020"
      WebsocketURI "ws://localhost:9020/runtime/session"
    }`
    Expect(deriveHostedDatasourceConfiguration('WordFlowerInstantDB', local)).toEqual({
      ApiURI: 'https://api.instantdb.com',
      AppId: '9faf89c0-c15c-49b4-bf3f-3b5b2cd9a19f',
      WebsocketURI: 'wss://api.instantdb.com/runtime/session',
    })
    Expect(deriveHostedDatasourceConfiguration('WordFlower', local)).toBeUndefined()
  })

  Test('derives the iCloud binding from direct, named, and inherited datasource bindings', () => {
    const source = `
use ICloud from @tao/data/providers/icloud
use Local from @tao/data/providers/local

app Notes {
   Name "Notes"
   Datasource NotesCloud
}

app NotesDevice = Notes with {
   Datasource Local { StorageKey "Notes" }
}

app NotesInherited = Notes with { Name "Notes Beta" }

app NotesInline = Notes with {
   Datasource ICloud { Container "iCloud.custom.notes" }
}

// A patch keeps the base's provider and may override the container.
app NotesPatched = Notes with {
   Datasource with { Container "iCloud.patched.notes" }
}

app NotesWithForm = Notes with {
   Datasource ICloud with { Container "iCloud.with.notes" }
}

app NotesTyped = Notes with {
   Datasource TypedCloud { }
}

app NotesCommented = Notes with {
   // Datasource ICloud { Container "iCloud.commented" }
   Datasource Local { StorageKey "Notes" }
}

datasource NotesCloud = ICloud {
   StorageKey "Notes"
}

type TypedCloud is ICloud with {
   Container "iCloud.typed.notes"
}
`
    // The parser hands the ship pipeline each declaration's own text, closed on its line or later.
    const declaration = (name: string): string => {
      const line = new RegExp(`^app ${name}\\b.*$`, 'mu').exec(source)![0]
      return line.trimEnd().endsWith('}') ? line : new RegExp(`^app ${name}\\b[\\s\\S]*?^\\}`, 'mu').exec(source)![0]
    }

    const documents = { services: ['CloudDocuments'] }
    Expect(deriveICloudBinding(declaration('Notes'), source)).toEqual(documents)
    Expect(deriveICloudBinding(declaration('NotesDevice'), source)).toBeUndefined()
    Expect(deriveICloudBinding(declaration('NotesInherited'), source)).toEqual(documents)
    Expect(deriveICloudBinding(declaration('NotesInline'), source)).toEqual({
      ...documents,
      container: 'iCloud.custom.notes',
    })
    Expect(deriveICloudBinding(declaration('NotesPatched'), source)).toEqual({
      ...documents,
      container: 'iCloud.patched.notes',
    })
    Expect(deriveICloudBinding(declaration('NotesWithForm'), source)).toEqual({
      ...documents,
      container: 'iCloud.with.notes',
    })
    Expect(deriveICloudBinding(declaration('NotesTyped'), source)).toEqual({
      ...documents,
      container: 'iCloud.typed.notes',
    })
    Expect(deriveICloudBinding(declaration('NotesCommented'), source)).toBeUndefined()
    Expect(deriveICloudBinding(declaration('Notes'), source.replace(/^use ICloud.*\n/mu, ''))).toBeUndefined()
  })

  Test('derives the CloudKit binding with its own service', () => {
    const source = `
use CloudKit from @tao/data/providers/cloudkit

app Kitchen {
   Name "Kitchen"
   Datasource CloudKit { Container "iCloud.lang.tao.kitchen" }
}

app KitchenBeta = Kitchen with { Name "Kitchen Beta" }
`
    const declaration = (name: string): string => {
      const line = new RegExp(`^app ${name}\\b.*$`, 'mu').exec(source)![0]
      return line.trimEnd().endsWith('}') ? line : new RegExp(`^app ${name}\\b[\\s\\S]*?^\\}`, 'mu').exec(source)![0]
    }

    Expect(deriveICloudBinding(declaration('Kitchen'), source)).toEqual({
      container: 'iCloud.lang.tao.kitchen',
      services: ['CloudKit'],
    })
    Expect(deriveICloudBinding(declaration('KitchenBeta'), source)).toEqual({
      container: 'iCloud.lang.tao.kitchen',
      services: ['CloudKit'],
    })
  })
})
