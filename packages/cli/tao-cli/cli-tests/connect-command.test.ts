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
        'manual',
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
      Expect(terminal.outputText()).toContain('press Create app')
      Expect(terminal.outputText()).toContain('Tao Hosted CRUD Demo')
      Expect(terminal.outputText()).toContain('Use npm selected')
      Expect(terminal.outputText()).toContain('Continue to console')
      Expect(terminal.outputText()).toContain('SDK setup and configuration > Config')
      Expect(terminal.outputText()).toContain('Press Return at the next prompt to automate setup')
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

  Test('creates a fresh Firebase project, web app, database, auth and rules by default', async () => {
    const root = await mkTestDir('tao-connect-firebase-auto-')
    try {
      await FS.writeText(FS.resolvePath('src/firebase/firestore.rules', root), "rules_version = '2';\n")
      await FS.writeJson(FS.resolvePath('tao.connections.json', root), {
        firebase: { projectId: 'REPLACE_WITH_FIREBASE_PROJECT_ID' },
      })
      const calls: string[][] = []
      let signedIn = false
      const runner = async (args: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        calls.push([...args])
        const command = args[0]
        const project = args[args.indexOf('--project') + 1]
        if (command === 'login') {
          signedIn = true
          return { exitCode: 0, stdout: '', stderr: '' }
        }
        let result: unknown
        if (command === 'login:list') {
          result = signedIn ? [{ user: { email: 'developer@example.test' } }] : []
        } else if (command === 'firestore:databases:list') {
          // A project created seconds ago has the Firestore API disabled, and firebase-tools reports it as a string.
          const error = `HTTP Error: 403, Cloud Firestore API has not been used in project ${project} before`
          return { exitCode: 2, stdout: JSON.stringify({ status: 'error', error }), stderr: '' }
        } else if (command === 'projects:list' || command === 'apps:list') {
          result = []
        } else if (command === 'projects:create') {
          result = { projectId: args[1] }
        } else if (command === 'apps:create') {
          result = { appId: '1:123:web:abc', displayName: 'Tao Hosted CRUD Demo' }
        } else if (command === 'apps:sdkconfig') {
          result = {
            sdkConfig: {
              projectId: project,
              appId: '1:123:web:abc',
              apiKey: 'public-web-key',
              authDomain: `${project}.firebaseapp.com`,
            },
          }
        } else if (command === 'deploy') {
          if (calls.filter(call => call[0] === 'deploy').length === 1) {
            // Google answers 403 until a project created seconds earlier has propagated its permissions.
            const error =
              `Request to https://firebaserules.googleapis.com/v1/projects/${project}:test had HTTP Error: 403, The caller does not have permission`
            return { exitCode: 2, stdout: JSON.stringify({ status: 'error', error }), stderr: '' }
          }
          result = { name: 'done' }
        } else {
          return { exitCode: 1, stdout: '', stderr: 'unexpected command' }
        }
        return { exitCode: 0, stdout: JSON.stringify({ status: 'success', result }), stderr: '' }
      }
      const questions: string[] = []
      const { terminal, options } = scripted([])
      const prompts = {
        ...options.prompts,
        text: async (message: string) => {
          questions.push(message)
          return ''
        },
      }
      const pauses: number[] = []
      const firebaseSleep = async (milliseconds: number) => {
        pauses.push(milliseconds)
      }
      await runTaoConnect('firebase', root, { ...options, prompts, firebaseRunner: runner, firebaseSleep })
      const created = calls.find(call => call[0] === 'projects:create')?.[1] ?? ''
      Expect(created).toMatch(/^tao-hosted-crud-[0-9a-f]{6}$/u)
      Expect(questions[0]).toContain(`Return to create new project ${created}`)
      Expect(questions.some(question => question.includes('Type yes'))).toBe(false)
      Expect(await FS.readJson(FS.resolvePath('tao.connections.json', root))).toEqual({
        firebase: {
          projectId: created,
          appId: '1:123:web:abc',
          apiKey: 'public-web-key',
          authDomain: `${created}.firebaseapp.com`,
        },
      })
      Expect(calls.map(call => call[0])).toEqual([
        'login:list',
        'login',
        'login:list',
        'projects:list',
        'projects:create',
        'apps:list',
        'apps:create',
        'apps:sdkconfig',
        'firestore:databases:list',
        'deploy',
        'deploy',
      ])
      Expect(pauses).toEqual([20_000])
      Expect(terminal.outputText()).toContain('retrying in 20 seconds (attempt 2 of 6)')
      Expect(calls.find(call => call[0] === 'login')).toEqual(['login', '--reauth'])
      Expect(calls.filter(call => call[0] === 'deploy')[0]).toContain('auth,firestore:rules')
      Expect(await FS.readJson(FS.resolvePath('.tao/firebase-connect/firebase.json', root))).toEqual({
        auth: { providers: { emailPassword: true } },
        firestore: { rules: 'firestore.rules', location: 'nam5' },
      })
      Expect(await FS.readText(FS.resolvePath('.tao/firebase-connect/firestore.rules', root)))
        .toBe("rules_version = '2';\n")
      Expect(terminal.outputText()).toContain(
        `Creating Firebase project ${created}… This usually takes about a minute.`,
      )
      Expect(terminal.outputText()).toContain('This can take a few minutes.')
      Expect(await FS.exists(FS.resolvePath('.tao/connect-secrets.json', root))).toBe(false)
      Expect(terminal.outputText()).toContain('Firebase Hosting was not configured')
    } finally {
      await FS.remove(root)
    }
  })

  Test('asks before creating a typed Firebase project ID that the account does not have', async () => {
    const root = await mkTestDir('tao-connect-firebase-typed-')
    try {
      await FS.writeText(FS.resolvePath('src/firebase/firestore.rules', root), 'pilot rules\n')
      const calls: string[] = []
      const runner = async (args: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        calls.push(args[0] ?? '')
        const result = args[0] === 'login:list' ? [{ user: { email: 'developer@example.test' } }] : []
        return { exitCode: 0, stdout: JSON.stringify({ status: 'success', result }), stderr: '' }
      }
      await Expect(runTaoConnect('firebase', root, {
        ...scripted(['tao-hosted-typo', 'no']).options,
        firebaseRunner: runner,
      })).rejects.toThrow('project creation was cancelled')
      Expect(calls).not.toContain('projects:create')
    } finally {
      await FS.remove(root)
    }
  })

  Test('reports the Firebase CLI error text instead of a generic hint', async () => {
    const root = await mkTestDir('tao-connect-firebase-error-')
    try {
      await FS.writeText(FS.resolvePath('src/firebase/firestore.rules', root), 'pilot rules\n')
      const runner = async (args: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
        args[0] === 'login:list'
          ? { exitCode: 0, stdout: JSON.stringify({ status: 'success', result: [{ user: {} }] }), stderr: '' }
          : {
            exitCode: 2,
            stdout: JSON.stringify({ status: 'error', error: 'HTTP Error: 429, quota exceeded' }),
            stderr: '',
          }
      await Expect(runTaoConnect('firebase', root, { ...scripted([]).options, firebaseRunner: runner }))
        .rejects.toThrow('could not list Firebase projects: HTTP Error: 429, quota exceeded')
    } finally {
      await FS.remove(root)
    }
  })

  Test('does not replace existing Firestore rules without an explicit yes', async () => {
    const root = await mkTestDir('tao-connect-firebase-rules-')
    try {
      await FS.writeText(FS.resolvePath('src/firebase/firestore.rules', root), 'pilot rules\n')
      const configPath = FS.resolvePath('tao.connections.json', root)
      await FS.writeJson(configPath, { preserved: true })
      const calls: string[] = []
      const runner = async (args: readonly string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
        calls.push(args[0] ?? '')
        let result: unknown = []
        if (args[0] === 'login:list') {
          result = [{ user: { email: 'developer@example.test' } }]
        }
        if (args[0] === 'projects:list') {
          result = [{ projectId: 'tao-hosted-demo' }]
        }
        if (args[0] === 'apps:list') {
          result = [{ appId: '1:123:web:abc', displayName: 'Existing' }]
        }
        if (args[0] === 'apps:sdkconfig') {
          result = {
            sdkConfig: {
              projectId: 'tao-hosted-demo',
              appId: '1:123:web:abc',
              apiKey: 'public-key',
              authDomain: 'tao-hosted-demo.firebaseapp.com',
            },
          }
        }
        if (args[0] === 'firestore:databases:list') {
          result = [
            { name: 'projects/tao-hosted-demo/databases/(default)', type: 'FIRESTORE_NATIVE' },
          ]
        }
        return { exitCode: 0, stdout: JSON.stringify({ status: 'success', result }), stderr: '' }
      }
      await Expect(runTaoConnect('firebase', root, {
        ...scripted(['tao-hosted-demo', 'no']).options,
        firebaseRunner: runner,
      })).rejects.toThrow('rules deployment was cancelled')
      Expect(await FS.readJson(configPath)).toEqual({ preserved: true })
      Expect(calls).not.toContain('deploy')
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
          'manual',
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
