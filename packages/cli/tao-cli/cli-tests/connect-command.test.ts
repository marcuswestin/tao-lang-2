import { Errors, FS } from '@shared'
import { Describe, Expect, fakeTerminal, mkTestDir, Test } from '@shared/test'
import { runTaoConnect } from '../cli-src/connect-command'

function scripted(text: string[], paste = '', secret = '') {
  const terminal = fakeTerminal()
  const answers = [...text]
  return {
    terminal,
    options: {
      interactive: true,
      output: terminal.output,
      prompts: {
        text: async () => answers.shift() ?? '',
        paste: async () => paste,
        secret: async () => secret,
      },
    },
  }
}

Describe('tao connect', () => {
  Test('stores Firebase web config without disturbing existing private credentials', async () => {
    const root = await mkTestDir('tao-connect-firebase-')
    try {
      await FS.writeJson(FS.resolvePath('tao.connections.json', root), { appwrite: { projectId: 'keep-appwrite' } })
      const serviceAccount = {
        type: 'service_account',
        project_id: 'firebase-project',
        private_key: 'private-key-canary',
        client_email: 'service@example.test',
      }
      const existingSecrets = { appwrite: { apiKey: 'keep-secret' }, firebase: { serviceAccount } }
      await FS.writeJson(FS.resolvePath('.tao/connect-secrets.json', root), existingSecrets, { mode: 0o600 })
      const { terminal, options } = scripted(
        ['firebase-project', 'web-api-key', 'web-app-id', 'firebase-project.firebaseapp.com'],
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
      Expect(JSON.parse(privateText)).toEqual(existingSecrets)
      Expect(await FS.fileMode(FS.resolvePath('.tao/connect-secrets.json', root))).toBe(0o600)
      Expect(publicText).not.toContain('private-key-canary')
      Expect(terminal.outputText()).not.toContain('private-key-canary')
      Expect(terminal.outputText()).not.toContain('keep-secret')
      Expect(terminal.outputText()).toContain('Press Create app')
      Expect(terminal.outputText()).toContain('Tao Hosted CRUD Demo')
      Expect(terminal.outputText()).toContain('Use npm selected')
      Expect(terminal.outputText()).toContain('Continue to console')
      Expect(terminal.outputText()).toContain('SDK setup and configuration > Config')
      Expect(terminal.outputText()).toContain('Copy the entire code snippet, or just its firebaseConfig object')
      Expect(terminal.outputText()).toContain('No service-account JSON is needed')
      Expect(terminal.outputText()).toContain('cloud resources were not provisioned or checked')
    } finally {
      await FS.remove(root)
    }
  })

  Test('extracts the four client fields from either Firebase SDK snippet without running code', async () => {
    const root = await mkTestDir('tao-connect-firebase-paste-')
    try {
      const config = `const firebaseConfig = {
  apiKey: "web-api-key",
  authDomain: "firebase-project.firebaseapp.com",
  projectId: "firebase-project",
  storageBucket: "firebase-project.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};`
      for (
        const snippet of [
          config,
          config.slice(config.indexOf('{'), config.lastIndexOf('}') + 1),
          `import { initializeApp } from "firebase/app";\n${config}\nconst app = initializeApp(firebaseConfig);`,
        ]
      ) {
        await runTaoConnect('firebase', root, scripted([], snippet).options)
        Expect(await FS.readJson(FS.resolvePath('tao.connections.json', root))).toEqual({
          firebase: {
            projectId: 'firebase-project',
            apiKey: 'web-api-key',
            appId: '1:123456789:web:abcdef',
            authDomain: 'firebase-project.firebaseapp.com',
          },
        })
      }
      Expect(await FS.exists(FS.resolvePath('.tao/connect-secrets.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects incomplete pasted Firebase config without changing the connection', async () => {
    const root = await mkTestDir('tao-connect-firebase-bad-paste-')
    try {
      const path = FS.resolvePath('tao.connections.json', root)
      await FS.writeJson(path, { existing: true })
      await Expect(runTaoConnect('firebase', root, scripted([], 'const firebaseConfig = { apiKey: "key" };').options))
        .rejects.toThrow('projectId')
      Expect(await FS.readJson(path)).toEqual({ existing: true })
    } finally {
      await FS.remove(root)
    }
  })

  Test('provisions Appwrite from a scoped API key and stores that key outside client config', async () => {
    const root = await mkTestDir('tao-connect-appwrite-')
    try {
      const requests: { method: string; path: string; headers: Headers }[] = []
      let platformCreated = false
      let databaseCreated = false
      let tableCreated = false
      let authEnabled = false
      let tableMalformed = false
      const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
        const path = new URL(String(input)).pathname
        const method = init?.method ?? 'GET'
        requests.push({ method, path, headers: new Headers(init?.headers) })
        const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
        if (path === '/v1/project' && method === 'GET') {
          return json({ $id: 'appwrite-project', authMethods: [{ $id: 'email-password', enabled: authEnabled }] })
        }
        if (path === '/v1/project/platforms' && method === 'GET') {
          return json({
            platforms: platformCreated
              ? [{ type: 'apple', bundleIdentifier: 'dev.tao.hostedcrudspike' }]
              : [],
          })
        }
        if (path === '/v1/project/platforms/apple' && method === 'POST') {
          platformCreated = true
          return json({ $id: 'tao_hosted_crud_apple' }, 201)
        }
        if (path === '/v1/project/auth-methods/email-password' && method === 'PATCH') {
          authEnabled = true
          return json({ $id: 'email-password', enabled: true })
        }
        if (path === '/v1/tablesdb/tao_notes' && method === 'GET') {
          return json(
            databaseCreated ? { $id: 'tao_notes', type: 'tablesdb', specification: null } : {},
            databaseCreated ? 200 : 404,
          )
        }
        if (path === '/v1/tablesdb' && method === 'POST') {
          databaseCreated = true
          return json({ $id: 'tao_notes' }, 201)
        }
        if (path === '/v1/tablesdb/tao_notes/tables/notes' && method === 'GET') {
          return json(
            tableCreated
              ? {
                rowSecurity: !tableMalformed,
                $permissions: ['create("users")'],
                columns: [
                  { key: 'ownerId', type: 'varchar', size: 255, required: true },
                  { key: 'text', type: 'text', required: true },
                  { key: 'done', type: 'boolean', required: true },
                  { key: 'updatedAt', type: 'bigint', required: true },
                ],
                indexes: [{ type: 'key', columns: ['ownerId'] }],
              }
              : {},
            tableCreated ? 200 : 404,
          )
        }
        if (path === '/v1/tablesdb/tao_notes/tables' && method === 'POST') {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>
          Expect(body).toMatchObject({ rowSecurity: true, permissions: ['create("users")'] })
          Expect(body['columns']).toHaveLength(4)
          Expect(body['indexes']).toEqual([{ key: 'ownerId', type: 'key', columns: ['ownerId'] }])
          tableCreated = true
          return json({ $id: 'notes' }, 201)
        }
        return json({ message: 'unexpected request' }, 500)
      }
      const { terminal, options } = scripted(
        ['https://fra.cloud.appwrite.io/v1', 'appwrite-project'],
        '',
        'appwrite-secret-canary',
      )
      await runTaoConnect('appwrite', root, { ...options, fetch: fetchImpl })
      const publicText = await FS.readText(FS.resolvePath('tao.connections.json', root))
      Expect(JSON.parse(publicText).appwrite).toEqual({
        endpoint: 'https://fra.cloud.appwrite.io/v1',
        projectId: 'appwrite-project',
        platform: 'dev.tao.hostedcrudspike',
        databaseId: 'tao_notes',
        tableId: 'notes',
      })
      const privatePath = FS.resolvePath('.tao/connect-secrets.json', root)
      Expect(await FS.readJson(privatePath)).toEqual({
        appwrite: {
          endpoint: 'https://fra.cloud.appwrite.io/v1',
          projectId: 'appwrite-project',
          apiKey: 'appwrite-secret-canary',
        },
      })
      Expect(await FS.fileMode(privatePath)).toBe(0o600)
      Expect(publicText).not.toContain('appwrite-secret-canary')
      Expect(terminal.outputText()).not.toContain('appwrite-secret-canary')
      Expect(requests.every(request => request.headers.get('X-Appwrite-Key') === 'appwrite-secret-canary')).toBe(true)
      Expect(requests.some(request => request.path === '/v1/tablesdb/tao_notes/tables' && request.method === 'POST'))
        .toBe(true)
      Expect(terminal.outputText()).toContain('Create API key')
      const writes = requests.filter(request => request.method !== 'GET').length
      await runTaoConnect('appwrite', root, {
        ...scripted(['https://fra.cloud.appwrite.io/v1', 'appwrite-project']).options,
        fetch: fetchImpl,
      })
      Expect(requests.filter(request => request.method !== 'GET')).toHaveLength(writes)
      tableMalformed = true
      await Expect(runTaoConnect('appwrite', root, {
        ...scripted(['https://fra.cloud.appwrite.io/v1', 'appwrite-project'], '', 'appwrite-secret-canary').options,
        fetch: fetchImpl,
      })).rejects.toThrow('Row security')
      Expect(requests.filter(request => request.method !== 'GET')).toHaveLength(writes)
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

  Test('invalid Appwrite endpoint leaves existing connection untouched', async () => {
    const root = await mkTestDir('tao-connect-invalid-')
    try {
      const publicPath = FS.resolvePath('tao.connections.json', root)
      await FS.writeJson(publicPath, { preserved: true })
      const beforePublic = await FS.readText(publicPath)
      await Expect(runTaoConnect(
        'appwrite',
        root,
        scripted(
          ['http://localhost/v1', 'project'],
        ).options,
      )).rejects.toThrow('HTTPS URL')
      Expect(await FS.readText(publicPath)).toBe(beforePublic)
      Expect(await FS.exists(FS.resolvePath('.tao/connect-secrets.json', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })

  Test('rejects an Appwrite API key without access and leaves local config unchanged', async () => {
    const root = await mkTestDir('tao-connect-appwrite-denied-')
    try {
      const publicPath = FS.resolvePath('tao.connections.json', root)
      await FS.writeJson(publicPath, { existing: true })
      const { terminal, options } = scripted(
        ['https://fra.cloud.appwrite.io/v1', 'appwrite-project'],
        '',
        'rejected-key-canary',
      )
      await Expect(runTaoConnect('appwrite', root, {
        ...options,
        fetch: async () => new Response('{}', { status: 403 }),
      })).rejects.toThrow('Check the project ID, API key, and its scopes')
      Expect(await FS.readJson(publicPath)).toEqual({ existing: true })
      Expect(await FS.exists(FS.resolvePath('.tao/connect-secrets.json', root))).toBe(false)
      Expect(terminal.outputText()).not.toContain('rejected-key-canary')
    } finally {
      await FS.remove(root)
    }
  })
})
