import { Errors, FS } from '@shared'
import { Describe, Expect, fakeTerminal, mkTestDir, Test } from '@shared/test'
import { runTaoConnect } from '../cli-src/connect-command'

function scripted(text: string[], secret: string) {
  const terminal = fakeTerminal()
  const answers = [...text]
  return {
    terminal,
    options: {
      interactive: true,
      output: terminal.output,
      prompts: {
        text: async () => answers.shift() ?? '',
        secret: async () => secret,
      },
    },
  }
}

Describe('tao connect', () => {
  Test('stores Firebase web config publicly and service account privately without disclosing it', async () => {
    const root = await mkTestDir('tao-connect-firebase-')
    try {
      await FS.writeJson(FS.resolvePath('tao.connections.json', root), { appwrite: { projectId: 'keep-appwrite' } })
      await FS.writeJson(FS.resolvePath('.tao/connect-secrets.json', root), { appwrite: { apiKey: 'keep-secret' } }, {
        mode: 0o644,
      })
      const serviceAccount = {
        type: 'service_account',
        project_id: 'firebase-project',
        private_key: 'private-key-canary',
        client_email: 'service@example.test',
      }
      const { terminal, options } = scripted(
        ['firebase-project', 'web-api-key', 'web-app-id', 'firebase-project.firebaseapp.com'],
        JSON.stringify(serviceAccount),
      )
      await runTaoConnect('firebase', root, options)

      const publicText = await FS.readText(FS.resolvePath('tao.connections.json', root))
      const privateText = await FS.readText(FS.resolvePath('.tao/connect-secrets.json', root))
      Expect(JSON.parse(publicText)).toEqual({
        appwrite: { projectId: 'keep-appwrite' },
        firebase: {
          projectId: 'firebase-project',
          apiKey: 'web-api-key',
          appId: 'web-app-id',
          authDomain: 'firebase-project.firebaseapp.com',
        },
      })
      Expect(JSON.parse(privateText)).toEqual({
        appwrite: { apiKey: 'keep-secret' },
        firebase: { serviceAccount },
      })
      Expect(await FS.fileMode(FS.resolvePath('.tao/connect-secrets.json', root))).toBe(0o600)
      Expect(publicText).not.toContain('private-key-canary')
      Expect(terminal.outputText()).not.toContain('private-key-canary')
      Expect(terminal.outputText()).not.toContain('keep-secret')
      Expect(terminal.outputText()).toContain('has not provisioned resources or checked the connection')
    } finally {
      await FS.remove(root)
    }
  })

  Test('stores Appwrite endpoint and IDs while keeping server API key private', async () => {
    const root = await mkTestDir('tao-connect-appwrite-')
    try {
      const { terminal, options } = scripted(
        ['https://fra.cloud.appwrite.io/v1', 'appwrite-project', 'dev.tao.app', 'database', 'table'],
        'appwrite-server-key-canary',
      )
      await runTaoConnect('appwrite', root, options)
      const publicText = await FS.readText(FS.resolvePath('tao.connections.json', root))
      Expect(JSON.parse(publicText).appwrite).toEqual({
        endpoint: 'https://fra.cloud.appwrite.io/v1',
        projectId: 'appwrite-project',
        platform: 'dev.tao.app',
        databaseId: 'database',
        tableId: 'table',
      })
      Expect(await FS.readJson(FS.resolvePath('.tao/connect-secrets.json', root))).toEqual({
        appwrite: { apiKey: 'appwrite-server-key-canary' },
      })
      Expect(await FS.fileMode(FS.resolvePath('.tao/connect-secrets.json', root))).toBe(0o600)
      Expect(publicText).not.toContain('appwrite-server-key-canary')
      Expect(terminal.outputText()).not.toContain('appwrite-server-key-canary')
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects a noninteractive run before creating files', async () => {
    const root = await mkTestDir('tao-connect-noninteractive-')
    try {
      await Expect(runTaoConnect('firebase', root, { interactive: false })).rejects.toBeInstanceOf(
        Errors.UserInputError,
      )
      Expect(await FS.exists(FS.resolvePath('tao.connections.json', root))).toBe(false)
      Expect(await FS.exists(FS.resolvePath('.tao/connect-secrets.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('accepts a Tao source path and skips optional server credentials', async () => {
    const root = await mkTestDir('tao-connect-source-')
    try {
      const source = FS.resolvePath('App.tao', root)
      await FS.writeText(source, 'app Example { view Main }\nview Main() { }\n')
      await runTaoConnect(
        'firebase',
        source,
        scripted(
          ['project', 'web-key', 'app-id', 'project.firebaseapp.com'],
          '',
        ).options,
      )
      Expect(await FS.readJson(FS.resolvePath('tao.connections.json', root))).toEqual({
        firebase: { projectId: 'project', apiKey: 'web-key', appId: 'app-id', authDomain: 'project.firebaseapp.com' },
      })
      Expect(await FS.exists(FS.resolvePath('.tao/connect-secrets.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('invalid endpoint and mismatched service-account JSON leave existing files untouched', async () => {
    const root = await mkTestDir('tao-connect-invalid-')
    try {
      const publicPath = FS.resolvePath('tao.connections.json', root)
      const secretPath = FS.resolvePath('.tao/connect-secrets.json', root)
      await FS.writeJson(publicPath, { preserved: true })
      await FS.writeJson(secretPath, { preserved: true }, { mode: 0o600 })
      const beforePublic = await FS.readText(publicPath)
      const beforeSecret = await FS.readText(secretPath)
      await Expect(runTaoConnect(
        'appwrite',
        root,
        scripted(
          ['http://localhost/v1', 'project', 'dev.tao.app', 'database', 'table'],
          'secret',
        ).options,
      )).rejects.toThrow('HTTPS URL')
      await Expect(runTaoConnect(
        'firebase',
        root,
        scripted(
          ['project', 'api-key', 'app-id', 'project.firebaseapp.com'],
          JSON.stringify({
            type: 'service_account',
            project_id: 'other',
            private_key: 'secret',
            client_email: 'x@y.z',
          }),
        ).options,
      )).rejects.toThrow('must match the project ID')
      Expect(await FS.readText(publicPath)).toBe(beforePublic)
      Expect(await FS.readText(secretPath)).toBe(beforeSecret)
    } finally {
      await FS.remove(root)
    }
  })
})
