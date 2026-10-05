import { Errors, FS, Platform, Repo } from '@shared'
import { Describe, Expect, fakeTerminal, mkTestDir, Test, testOverrideSlot } from '@shared/test'
import type { FirebaseInspection, FirebaseInspector } from '../cli-src/firebase-inspection'
import { firebaseCreationProgress, type FirebaseRunner, provisionFirebase } from '../cli-src/firebase-provision'
import { composeFirebasePilotRules } from '../cli-src/firebase-rules'

const bootstrap =
  "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /{document=**} { allow read, write: if false; }\n  }\n}\n"
const generated =
  "rules_version = '2';\nservice cloud.firestore {\n  match /databases/{database}/documents {\n    match /users/{userId}/stores/{storageKey} { allow delete: if false; }\n  }\n}\n"
const backend = {
  displayName: 'Ordinary App',
  files: { 'firestore.rules': generated, 'firestore.indexes.json': '{"indexes":[],"fieldOverrides":[]}' },
}

const tokenPresence = testOverrideSlot({
  read: () => Object.hasOwn(Platform.runtimeProcess.env, 'FIREBASE_TOKEN'),
  write: (present: boolean) => {
    if (present) {
      Platform.runtimeProcess.env['FIREBASE_TOKEN'] = 'test-only-secret-canary'
    } else {
      delete Platform.runtimeProcess.env['FIREBASE_TOKEN']
    }
  },
})

async function fixture() {
  const project = await mkTestDir('firebase-provision')
  const terminal = fakeTerminal()
  const calls: readonly string[][] = []
  const recordedCalls = calls as string[][]
  const menus: { message: string; choices: readonly { value: string; label: string }[]; defaultValue?: string }[] = []
  const state: FirebaseInspection = {
    database: {
      name: 'projects/saved-project/databases/(default)',
      type: 'FIRESTORE_NATIVE',
      databaseEdition: 'STANDARD',
      locationId: 'nam5',
    },
    auth: {
      emailPasswordEnabled: false,
      preserved: { authorizedDomains: ['localhost', 'existing.test'], signIn: { anonymous: { enabled: true } } },
    },
    rules: {
      releaseName: 'projects/saved-project/releases/cloud.firestore',
      rulesetName: 'projects/saved-project/rulesets/old',
      source: bootstrap,
    },
  }
  const control = {
    deployFailures: 0,
    failMessage: 'HTTP Error: 403, propagation',
    postcheckBad: false,
    inspectFailure: false,
    concurrentChange: false,
    inspections: 0,
  }
  const runner: FirebaseRunner = async (args, cwd) => {
    recordedCalls.push([...args])
    const ok = (result: unknown) => ({ exitCode: 0, stdout: JSON.stringify({ status: 'success', result }), stderr: '' })
    if (args[0] === 'login:list') {
      return ok([{ user: { email: 'local@example.test' } }])
    }
    if (args[0] === 'projects:list') {
      return ok([{ projectId: 'first-project' }, { projectId: 'saved-project' }])
    }
    if (args[0] === 'apps:list') {
      return ok([{ appId: 'first-app', displayName: 'Other app' }, { appId: 'saved-app', displayName: 'Saved app' }])
    }
    if (args[0] === 'apps:sdkconfig') {
      return ok({
        sdkConfig: {
          projectId: 'saved-project',
          appId: args[2],
          apiKey: 'public-key',
          authDomain: 'saved-project.firebaseapp.com',
        },
      })
    }
    if (args[0] === 'deploy') {
      if (control.deployFailures-- > 0) {
        return { exitCode: 1, stdout: JSON.stringify({ status: 'error', error: control.failMessage }), stderr: '' }
      }
      state.database ??= {
        name: 'projects/saved-project/databases/(default)',
        type: 'FIRESTORE_NATIVE',
        databaseEdition: 'STANDARD',
        locationId: 'nam5',
      }
      state.auth.emailPasswordEnabled = !control.postcheckBad
      state.rules = {
        releaseName: 'projects/saved-project/releases/cloud.firestore',
        rulesetName: 'projects/saved-project/rulesets/new',
        source: await FS.readText(FS.resolvePath('firestore.rules', cwd)),
      }
      return ok({})
    }
    Errors.throwUnexpected('Unexpected fake Firebase command: ' + String(args[0]))
  }
  const inspector: FirebaseInspector = async request => {
    Expect(request.account).toBe('local@example.test')
    Expect(request.projectId).toBe('saved-project')
    control.inspections++
    if (control.inspectFailure) {
      Errors.throwHostEnvironment('Permission denied during Firebase inspection.')
    }
    if (control.concurrentChange && control.inspections === 2) {
      state.rules!.rulesetName = 'projects/saved-project/rulesets/concurrent'
    }
    return structuredClone(state)
  }
  const options = {
    project,
    backend,
    currentProjectId: 'saved-project',
    currentAppId: 'saved-app',
    runner,
    inspector,
    output: terminal.output,
    sleep: async (_milliseconds: number) => {},
    prompts: {
      text: async (_message: string) => '',
      choice: async (message: string, choices: readonly { value: string; label: string }[], defaultValue?: string) => {
        menus.push({ message, choices, defaultValue })
        return message === 'Apply this Firebase deployment plan?' ? 'continue' : defaultValue ?? choices[0]!.value
      },
    },
  }
  return {
    project,
    terminal,
    calls,
    menus,
    state,
    control,
    options,
    work: FS.resolvePath('.tao/firebase-connect', project),
  }
}

Describe('Firebase API provisioning', () => {
  Test('streams only fixed Firebase creation phases across output chunks', () => {
    const terminal = fakeTerminal()
    const output = firebaseCreationProgress(terminal.output)
    output('stdout', Buffer.from('- Creating Google Cloud Platform project\n'))
    output('stderr', Buffer.from('- Creating Google Cloud'))
    Expect(terminal.outputText()).toBe('')
    output(
      'stderr',
      Buffer.from(
        ' Platform project\nraw secret-canary\n- Adding Firebase resources to Google Cloud Platform project\n',
      ),
    )
    output('stderr', Buffer.from('- Creating Google Cloud Platform project\n'))
    Expect(terminal.outputText()).toBe(
      'Creating the Google Cloud project…\nAdding Firebase resources to the Google Cloud project…\n',
    )
  })

  Test('inherited token authentication stops before any CLI or cloud call', async () => {
    const f = await fixture()
    Expect(Object.hasOwn(Platform.runtimeProcess.env, 'FIREBASE_TOKEN')).toBe(false)
    const restore = tokenPresence.install(true)
    try {
      await Expect(provisionFirebase(f.options)).rejects.toThrow('Unset FIREBASE_TOKEN')
      Expect(f.calls).toHaveLength(0)
      Expect(f.terminal.outputText()).not.toContain('test-only-secret-canary')
    } finally {
      restore()
    }
  })
  Test(
    'ordinary apps deploy generated rules without pilot source and retain saved project and app identity',
    async () => {
      const f = await fixture()
      const config = await provisionFirebase(f.options)
      Expect(config.appId).toBe('saved-app')
      Expect(config.projectId).toBe('saved-project')
      Expect(f.menus.map(menu => menu.choices[0]!.value)).toEqual(['saved-project', 'saved-app', 'continue'])
      Expect(f.calls.some(args => args[0] === 'projects:create' || args[0] === 'apps:create')).toBe(false)
      for (const args of f.calls.slice(1)) {
        Expect(args).toContain('local@example.test')
      }
      const deploy = f.calls.find(args => args[0] === 'deploy')!
      Expect(deploy).toContain('auth,firestore:rules')
      Expect(deploy).toContain('--non-interactive')
      const configFile = await FS.readJson(FS.resolvePath('firebase.json', f.work))
      Expect(configFile).toEqual({
        auth: { providers: { emailPassword: true } },
        firestore: { database: '(default)', edition: 'standard', rules: 'firestore.rules' },
      })
      Expect(await FS.readText(FS.resolvePath('firestore.rules', f.work))).toBe(generated)
      Expect(await FS.readText(FS.resolvePath('saved-project.current.rules', f.work))).toBe(bootstrap)
      Expect(await FS.exists(FS.resolvePath('saved-project.accepted.json', f.work))).toBe(true)
      Expect(f.control.inspections).toBe(3)
    },
  )

  Test('already enabled Email Password auth needs only the rules deploy scope', async () => {
    const f = await fixture()
    f.state.auth.emailPasswordEnabled = true
    f.state.auth.emailPasswordRequired = false
    await provisionFirebase(f.options)
    Expect(f.calls.find(args => args[0] === 'deploy')).toContain('firestore:rules')
    Expect(await FS.readJson(FS.resolvePath('firebase.json', f.work))).toEqual({
      firestore: { database: '(default)', edition: 'standard', rules: 'firestore.rules' },
    })
  })

  Test(
    'unfamiliar rules stop before cloud mutation and retain current source and generated candidate for review',
    async () => {
      const f = await fixture()
      f.state.rules!.source = 'unfamiliar existing policy'
      await Expect(provisionFirebase(f.options)).rejects.toThrow('tao connect firebase ')
      Expect(f.calls.map(args => args[0])).toEqual(['login:list', 'projects:list'])
      Expect(await FS.readText(FS.resolvePath('saved-project.current.rules', f.work))).toBe(
        'unfamiliar existing policy',
      )
      Expect(await FS.readText(FS.resolvePath('saved-project.candidate.rules', f.work))).toBe(generated)
      Expect(f.terminal.outputText()).toContain('No cloud mutation was attempted.')
    },
  )

  Test('inspection denial prevents web app creation and deployment', async () => {
    const f = await fixture()
    f.control.inspectFailure = true
    await Expect(provisionFirebase(f.options)).rejects.toThrow('Permission denied')
    Expect(f.calls.map(args => args[0])).toEqual(['login:list', 'projects:list'])
  })

  Test('a concurrent remote rules release stops immediately before deployment', async () => {
    const f = await fixture()
    f.control.concurrentChange = true
    await Expect(provisionFirebase(f.options)).rejects.toThrow('changed during setup')
    Expect(f.calls.some(args => args[0] === 'deploy')).toBe(false)
    Expect(await FS.exists(FS.resolvePath('saved-project.accepted.rules', f.work))).toBe(false)
  })

  Test('403 retry rechecks remote state and never deploys or deletes existing indexes', async () => {
    const f = await fixture()
    f.control.deployFailures = 1
    await provisionFirebase(f.options)
    Expect(f.calls.filter(args => args[0] === 'deploy')).toHaveLength(2)
    Expect(f.control.inspections).toBe(5)
    Expect(f.calls.some(args => args.some(arg => arg.includes('indexes') || arg === '--force'))).toBe(false)
    Expect(await FS.readText(FS.resolvePath('firestore.indexes.json', f.work))).toBe(
      '{"indexes":[],"fieldOverrides":[]}',
    )
  })

  Test('late deployment failure reports partial cloud changes and never records accepted rules', async () => {
    const f = await fixture()
    f.control.deployFailures = 1
    f.control.failMessage = 'HTTP Error: 500, deployment failed after Auth update'
    await Expect(provisionFirebase(f.options)).rejects.toThrow('HTTP Error: 500')
    Expect(f.terminal.outputText()).toContain('Cloud resources may already have changed')
    Expect(await FS.exists(FS.resolvePath('saved-project.accepted.rules', f.work))).toBe(false)
  })

  Test('successful CLI exit alone cannot pass a failed Auth postcheck', async () => {
    const f = await fixture()
    f.control.postcheckBad = true
    await Expect(provisionFirebase(f.options)).rejects.toThrow('did not pass inspection')
    Expect(await FS.exists(FS.resolvePath('saved-project.accepted.rules', f.work))).toBe(false)
  })

  Test('new databases ask for permanent location and explicitly deploy Standard default database', async () => {
    const f = await fixture()
    delete f.state.database
    delete f.state.rules
    await provisionFirebase(f.options)
    Expect(f.menus.map(menu => menu.defaultValue)).toEqual(['saved-project', 'nam5', 'saved-app', 'continue'])
    Expect(await FS.readJson(FS.resolvePath('firebase.json', f.work))).toEqual({
      auth: { providers: { emailPassword: true } },
      firestore: { database: '(default)', edition: 'standard', rules: 'firestore.rules', location: 'nam5' },
    })
  })

  Test('Enterprise or Datastore databases stop without mutation or billing changes', async () => {
    for (
      const value of [{ type: 'DATASTORE_MODE', databaseEdition: 'STANDARD' }, {
        type: 'FIRESTORE_NATIVE',
        databaseEdition: 'ENTERPRISE',
      }]
    ) {
      const f = await fixture()
      Object.assign(f.state.database!, value)
      await Expect(provisionFirebase(f.options)).rejects.toThrow('Native mode and Standard edition')
      Expect(f.calls.map(args => args[0])).toEqual(['login:list', 'projects:list'])
    }
  })

  Test('invalid numeric selection redraws default first and Enter reuses saved resources', async () => {
    const f = await fixture()
    const answers = ['incorrect', '', '', '']
    await provisionFirebase({ ...f.options, prompts: { text: async () => answers.shift() ?? '' } })
    Expect(f.terminal.outputText()).toContain('ctrl+c to quit')
    Expect(f.terminal.outputText()).toContain('1. Reuse saved-project (saved-project) (default)')
    Expect(f.calls.some(args => args[0] === 'projects:create')).toBe(false)
  })

  Test('audited pilot policy is preserved beside generated stores and idempotent reconnect retains it', async () => {
    const f = await fixture()
    const pilot = await FS.readText(FS.resolvePath('Apps/Hosted CRUD/src/firebase/firestore.rules', Repo.getRoot()))
    const documentMatch = '    match /users/{userId}/stores/{storageKey} { allow delete: if false; }'
    const composed = composeFirebasePilotRules(pilot, documentMatch)
    Expect(composed).toBe(pilot.slice(0, -6) + documentMatch + '\n  }\n}\n')
    Expect(composeFirebasePilotRules(pilot + '// changed\n', documentMatch)).toBeUndefined()
    f.state.rules!.source = pilot
    const prompts = {
      ...f.options.prompts,
      choice: async (message: string, choices: readonly { value: string; label: string }[], defaultValue?: string) =>
        message === 'Apply this Firebase deployment plan?' ? 'continue' : defaultValue ?? choices[0]!.value,
    }
    const options = { ...f.options, backend: { ...backend, documentMatch }, prompts }
    await provisionFirebase(options)
    Expect(f.state.rules!.source).toContain('match /users/{userId}/notes/{noteId}')
    Expect(f.state.rules!.source).toContain('match /users/{userId}/stores/{storageKey}')
    const first = f.state.rules!.source
    await provisionFirebase(options)
    Expect(f.state.rules!.source).toBe(first)
  })

  Test('reviewed rules resume explicitly confirms and deploys the merged local source', async () => {
    const f = await fixture()
    f.state.rules!.source = 'existing unrelated policy'
    await FS.writeText(FS.resolvePath('reviewed.rules', f.project), 'reviewed merged policy')
    await provisionFirebase({
      ...f.options,
      rulesFile: 'reviewed.rules',
      prompts: {
        ...f.options.prompts,
        choice: async (message, choices, defaultValue) =>
          message === 'Apply this Firebase deployment plan?' ? 'continue' : defaultValue ?? choices[0]!.value,
      },
    })
    Expect(f.state.rules!.source).toBe('reviewed merged policy')
    await provisionFirebase(f.options)
    Expect(f.state.rules!.source).toBe('reviewed merged policy')
    await Expect(
      provisionFirebase({
        ...f.options,
        backend: { ...backend, files: { ...backend.files, 'firestore.rules': generated + '// schema changed\n' } },
      }),
    ).rejects.toThrow('Existing Firestore rules need review')
    Expect(f.state.rules!.source).toBe('reviewed merged policy')
  })

  Test('rules recorded for another Tao app cannot authorize replacing its project policy', async () => {
    const f = await fixture()
    await provisionFirebase(f.options)
    const deploys = f.calls.filter(args => args[0] === 'deploy').length
    await Expect(
      provisionFirebase({
        ...f.options,
        backend: {
          ...backend,
          displayName: 'Another App',
          files: { ...backend.files, 'firestore.rules': generated + '// another app\n' },
        },
      }),
    ).rejects.toThrow('Existing Firestore rules need review')
    Expect(f.calls.filter(args => args[0] === 'deploy')).toHaveLength(deploys)
  })

  Test(
    'rechecks a newly created project after a transient inspection failure and never accepts failed inspection',
    async () => {
      for (const recover of [true, false]) {
        const f = await fixture()
        let reads = 0
        const pauses: number[] = []
        const inspect = f.options.inspector
        const run = f.options.runner
        const action = provisionFirebase({
          ...f.options,
          runner: async (args, cwd, interactive) =>
            args[0] === 'projects:create' || args[0] === 'projects:list'
              ? { exitCode: 0, stdout: JSON.stringify({ status: 'success', result: [] }), stderr: '' }
              : run(args, cwd, interactive),
          prompts: {
            text: async () => 'saved-project',
            choice: async (message, _choices, defaultValue) =>
              message === 'Choose the Firebase project' ? '__create__' : defaultValue!,
          },
          inspector: async request => {
            if (++reads === 1 || !recover) {
              Errors.throwHostEnvironment('Firebase inspection failed at auth-config (HTTP 403, PERMISSION_DENIED).', {
                details: { firebaseInspection: { stage: 'auth-config', status: 403, code: 'PERMISSION_DENIED' } },
              })
            }
            return inspect(request)
          },
          sleep: async milliseconds => {
            pauses.push(milliseconds)
          },
        })
        if (recover) {
          await action
          Expect(f.calls.some(args => args[0] === 'deploy')).toBe(true)
          Expect(pauses).toEqual([10_000])
        } else {
          await Expect(action).rejects.toThrow('HTTP 403')
          Expect(f.calls.some(args => args[0] === 'deploy')).toBe(false)
          Expect(reads).toBe(10)
          Expect(pauses).toHaveLength(9)
        }
        Expect(f.terminal.outputText()).toContain(
          'Rechecking the default database, Auth settings, and deployed Firestore rules',
        )
      }
    },
  )

  Test('a permission failure on an existing project stops immediately without deployment', async () => {
    const f = await fixture()
    let reads = 0
    await Expect(provisionFirebase({
      ...f.options,
      inspector: async () => {
        reads++
        Errors.throwHostEnvironment('Firebase inspection failed at auth-config (HTTP 403, PERMISSION_DENIED).', {
          details: { firebaseInspection: { stage: 'auth-config', status: 403, code: 'PERMISSION_DENIED' } },
        })
      },
    })).rejects.toThrow('HTTP 403')
    Expect(reads).toBe(1)
    Expect(f.calls.some(args => args[0] === 'deploy')).toBe(false)
  })

  Test('Enter accepts the complete deployment plan with Continue first', async () => {
    const f = await fixture()
    await provisionFirebase({ ...f.options, prompts: { text: async () => '' } })
    Expect(f.calls.some(args => args[0] === 'deploy')).toBe(true)
    Expect(f.terminal.outputText()).toContain('1. Continue (default)\n2. Stop setup')
    Expect(f.terminal.outputText()).toContain('Project: saved-project; web app: saved-app')
    Expect(f.terminal.outputText()).toContain('location: nam5')
    Expect(f.terminal.outputText()).toContain('enable Email/Password; preserve other providers and settings')
  })

  Test('an explicit reviewed policy authorizes selecting another existing web app through the final plan', async () => {
    const f = await fixture()
    await provisionFirebase(f.options)
    const reviewed = generated + '// reviewed combined policy for the selected web app\n'
    await FS.writeText(FS.resolvePath('reviewed.rules', f.project), reviewed)
    const result = await provisionFirebase({
      ...f.options,
      rulesFile: 'reviewed.rules',
      prompts: {
        ...f.options.prompts,
        choice: async (message, choices, defaultValue) =>
          message === 'Choose the Firebase web app'
            ? 'first-app'
            : message === 'Apply this Firebase deployment plan?'
            ? 'continue'
            : defaultValue ?? choices[0]!.value,
      },
    })
    Expect(result.appId).toBe('first-app')
    Expect(f.state.rules!.source).toBe(reviewed)
    Expect(f.calls.filter(args => args[0] === 'deploy')).toHaveLength(2)
  })
})
