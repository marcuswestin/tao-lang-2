import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import {
  deriveHostedDatasourceConfiguration,
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
})
