import { FS, ProjectIdentity } from '@shared'
import { Describe, Expect, Test, withCapturedOutput } from '@shared/test'
import { runHostedProviderGenerate } from '../cli-src/hosted-provider-generate'
import { readHostedProviderInputs } from '../cli-src/hosted-provider-inputs'
import { withTaoFixture } from './test-cli-files'

const source = `use Text from @tao/ui
use FirebaseAuth from @tao/auth/firebase
use Firebase from @tao/data/providers/firebase

app Hosted {
   id "firebase-generate"
   version "1.0.0"
   name "Firebase generate"
   Auth FirebaseAuth { ApiKey "web-key", ProjectId "firebase-project" }
   Datasource Firebase { ApiKey "web-key", ProjectId "firebase-project" }
   view Main
}

view Main() {
   render Text("Hosted")
}

data Accounts / Account {
   DisplayName text,
}

data Notes / Note {
   Body text,
}
`

Describe('tao firebase generate', () => {
  Test('compiles a Firebase store without authored access rules and writes private backend files', async () => {
    await withTaoFixture({ '.tao/.gitkeep': '', 'Hosted.tao': source }, async root => {
      await ProjectIdentity.ensure(root)
      const appPath = FS.resolvePath('Hosted.tao', root)
      const output = FS.resolvePath('backend', root)
      const inputs = await readHostedProviderInputs(appPath, 'Hosted', 'firebase')
      Expect(inputs.policy).toBeUndefined()
      Expect(Object.keys(inputs.definition.entities)).toEqual(['Account', 'Note'])

      await FS.writeJson(FS.resolvePath('.tao/local/connections.json', root), {
        firebase: { apiKey: 'web-key', projectId: 'firebase-project', appId: 'web-app-id' },
      })
      const printed = await withCapturedOutput(() =>
        runHostedProviderGenerate('firebase', appPath, { appName: 'Hosted', output })
      )
      Expect(printed.stdout).toContain('https://firebase.google.com/docs/cli#install_the_firebase_cli')
      Expect(printed.stdout).toContain('firebase login')
      Expect(printed.stdout).toContain('allowed to deploy')
      Expect(printed.stdout).toContain('https://console.firebase.google.com/project/firebase-project/firestore')
      Expect(printed.stdout).toContain('no separate backend server')
      Expect(printed.stdout).toContain('Select the (default) database')
      Expect(printed.stdout).toContain('combine them with any existing project-wide Firestore rules')
      Expect(printed.stdout).toContain(
        "firebase deploy --only firestore:rules --project 'firebase-project'",
      )
      Expect(printed.stdout).toContain('deploy rules only to preserve existing indexes')
      Expect(printed.stdout).not.toContain('firestore:rules,firestore:indexes')
      Expect(await FS.listDir(output)).toEqual(['firebase.json', 'firestore.indexes.json', 'firestore.rules'])
      const rules = await FS.readText(FS.resolvePath('firestore.rules', output))
      Expect(rules).toContain('match /users/{userId}/stores/{storageKey}')
      Expect(rules).toContain('request.auth.uid == userId')
      Expect(rules).toContain('match /Note/{id}')
      Expect(await FS.readJson(FS.resolvePath('firebase.json', output))).toEqual({
        firestore: { rules: 'firestore.rules', indexes: 'firestore.indexes.json' },
      })

      await FS.writeText(FS.resolvePath('firestore.rules', output), 'hand edited\n')
      await Expect(runHostedProviderGenerate('firebase', appPath, { appName: 'Hosted', output })).rejects.toThrow(
        'Pass --force to replace them.',
      )
      Expect(await FS.readText(FS.resolvePath('firestore.rules', output))).toBe('hand edited\n')
    })
  })
})
