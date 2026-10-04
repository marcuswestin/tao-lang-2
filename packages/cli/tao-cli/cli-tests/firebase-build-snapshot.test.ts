import Runtime from '@expo-host'
import { Assert, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, testOverrideSlot } from '@shared/test'
import { type BuildRecord, runTaoBuild } from '../cli-src/build-command'

const generationSlot = testOverrideSlot({
  read: () => Runtime.generateApp,
  write: value => Runtime.generateApp = value,
})

Describe('tao build Firebase connection snapshot', () => {
  Test('generates Firebase settings from public local configuration and fingerprints only those settings', async () => {
    const root = await mkTestDir('tao-build-firebase-')
    const project = FS.resolvePath('app', root)
    const output = FS.resolvePath('builds', root)
    const connectionPath = FS.resolvePath('.tao/local/connections.json', project)
    const connection = {
      apiKey: 'synthetic-public-key',
      projectId: 'synthetic-project',
      appId: 'synthetic-app',
      authDomain: 'synthetic.firebaseapp.com',
      storageBucket: 'synthetic.firebasestorage.app',
      messagingSenderId: '123456789',
    }
    const generateApp = Runtime.generateApp
    let snapshotsChecked = 0
    const restoreGeneration = generationSlot.install(async (appPath, options) => {
      const snapshotRoot = FS.dirname(appPath)
      Expect(await FS.exists(FS.resolvePath('.tao/local/private-settings.json', snapshotRoot))).toBe(false)
      const snapshotConnection = FS.resolvePath('.tao/local/connections.json', snapshotRoot)
      if (snapshotsChecked === 0) {
        Expect(await FS.exists(snapshotConnection)).toBe(false)
      } else {
        const contents = await FS.readJson<Record<string, unknown>>(snapshotConnection)
        Expect(Object.keys(contents)).toEqual(['firebase'])
        Expect(contents['firebase']).toEqual(connection)
      }
      snapshotsChecked++
      return await generateApp(appPath, options)
    })
    try {
      await FS.writeText(FS.resolvePath('.tao/.gitkeep', project), '')
      await FS.writeText(
        FS.resolvePath('Main.tao', project),
        `
use FirebaseAuth from @tao/auth/firebase
use Firebase from @tao/data/providers/firebase
data Notes / Note { Title text }
app NotesApp {
   id "com.tao.test.notesapp" version "1.0.0" name "NotesApp"
   Auth FirebaseAuth { ApiKey "source-key" ProjectId "source-project" }
   Datasource Firebase { ApiKey "source-key" ProjectId "source-project" }
   view Main
}
view Main() { render Label("Ready") }
view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
`,
      )
      await FS.writeJson(FS.resolvePath('.tao/local/private-settings.json', project), { secret: 'private-marker' })

      async function build(): Promise<{ code: string; record: BuildRecord }> {
        const previous = await FS.isDirectory(output) ? await FS.listDir(output) : []
        Expect(await runTaoBuild(project, { appName: 'NotesApp', targets: ['web'], output, compileOnly: true }))
          .toBe(0)
        const id = (await FS.listDir(output)).find(value => !previous.includes(value))
        Assert.defined(id, 'a new build record is written')
        const record = await FS.readJson<BuildRecord>(FS.resolvePath(`${id}/build.json`, output))
        const result = record.results.web
        Assert(result?.status === 'succeeded', 'the compile-only web build succeeds')
        const emitted: string[] = []
        for await (const path of FS.walk(result.artifact, { extensions: ['.tsx'] })) {
          emitted.push(await FS.readText(path))
        }
        return { code: emitted.join('\n'), record }
      }

      const unconfigured = await build()
      Expect(unconfigured.code).toContain('"ApiKey": TR.Value("source-key")')
      await FS.writeJson(connectionPath, { firebase: connection, unrelated: { secret: 'private-marker' } })
      const configured = await build()
      Expect(configured.record.sourceDigest).not.toBe(unconfigured.record.sourceDigest)
      Expect(configured.code.match(/"ApiKey": TR.Value\("synthetic-public-key"\)/gu)).toHaveLength(2)
      Expect(configured.code.match(/"ProjectId": TR.Value\("synthetic-project"\)/gu)).toHaveLength(2)
      Expect(configured.code.match(/"AppId": TR.Value\("synthetic-app"\)/gu)).toHaveLength(2)
      Expect(configured.code).toContain('"AuthDomain": TR.Value("synthetic.firebaseapp.com")')
      Expect(configured.code).toContain('"StorageBucket": TR.Value("synthetic.firebasestorage.app")')
      Expect(configured.code).toContain('"MessagingSenderId": TR.Value("123456789")')
      Expect(configured.code).not.toContain('private-marker')

      await FS.writeJson(connectionPath, {
        unrelated: { secret: 'changed-private-marker' },
        firebase: Object.fromEntries(Object.entries(connection).reverse()),
      })
      const reordered = await build()
      Expect(reordered.record.sourceDigest).toBe(configured.record.sourceDigest)
      connection.projectId = 'synthetic-project-changed'
      await FS.writeJson(connectionPath, { firebase: connection })
      const changed = await build()
      Expect(changed.record.sourceDigest).not.toBe(configured.record.sourceDigest)
      Expect(changed.code.match(/"ProjectId": TR.Value\("synthetic-project-changed"\)/gu)).toHaveLength(2)
      Expect(changed.code).not.toContain('"ProjectId": TR.Value("synthetic-project")')
      Expect(snapshotsChecked).toBe(4)
      Expect(await FS.readJson(FS.resolvePath('.tao/local/private-settings.json', project)))
        .toEqual({ secret: 'private-marker' })
    } finally {
      restoreGeneration()
      await FS.remove(root)
    }
  }, 180_000)
})
