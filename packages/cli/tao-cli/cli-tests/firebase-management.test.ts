import { CLI, FS, Platform } from '@shared'
import { Describe, Expect, fakeTerminal, mkTestDir, Test, testOverrideSlot } from '@shared/test'
import type { FirebaseRunner } from '../cli-src/firebase-cli'
import { runFirebaseManagement } from '../cli-src/firebase-management'
import { createCommands } from '../cli-src/tao-cli'
import VENDOR_PREPARATION from './fixtures/firebase-management/prepare.cjs.txt'

const appId = '1:123456789:web:abcdef1234'
const canary = 'secret-token-canary'
const tokenPresence = testOverrideSlot({
  read: () => Platform.runtimeProcess.env['FIREBASE_TOKEN'],
  write: (value: string | undefined) => {
    if (value !== undefined) {
      Platform.runtimeProcess.env['FIREBASE_TOKEN'] = value
    } else {
      delete Platform.runtimeProcess.env['FIREBASE_TOKEN']
    }
  },
})
function fixture() {
  const terminal = fakeTerminal()
  const progress = fakeTerminal()
  const calls: string[][] = []
  const menus: { choices: readonly { value: string; label: string }[]; defaultValue: string }[] = []
  const control = {
    answer: 'continue',
    accounts: ['first@example.test'],
    accountReads: 0,
    failure: false,
    projectPrompt: '',
    textDefault: '',
  }
  const runner: FirebaseRunner = async args => {
    const configIndex = args.indexOf('--config')
    calls.push(configIndex < 0 ? [...args] : [...args.slice(0, configIndex), ...args.slice(configIndex + 2)])
    if (control.failure) {
      return {
        exitCode: 1,
        stdout: JSON.stringify({ status: 'error', error: { message: canary, tokens: canary } }),
        stderr: canary,
      }
    }
    const results: Record<string, unknown> = {
      'projects:list': [{ projectId: 'saved-project', displayName: 'Saved', tokens: canary }],
      'projects:create': { projectId: args[1], tokens: canary },
      'apps:list': [{ appId, displayName: 'Web app', platform: 'WEB', tokens: canary }, {
        appId: '1:123456789:ios:abcdef1234',
        platform: 'IOS',
      }],
      'apps:create': { appId, platform: 'WEB', displayName: args[2], tokens: canary },
      'apps:sdkconfig': {
        fileContents: canary,
        sdkConfig: {
          projectId: 'saved-project',
          appId,
          apiKey: 'public-api-key',
          authDomain: 'saved-project.firebaseapp.com',
          refreshToken: canary,
        },
      },
      'firestore:delete': { token: canary },
    }
    return { exitCode: 0, stdout: JSON.stringify({ status: 'success', result: results[args[0]!] }), stderr: canary }
  }
  const options = {
    runner,
    output: terminal.output,
    progress: progress.output,
    json: true,
    accounts: async () => {
      control.accountReads++
      return control.accounts.map(email => ({ user: { email } }))
    },
    prompts: {
      text: async (_message: string, defaultValue?: string) => {
        control.textDefault = defaultValue ?? ''
        return control.projectPrompt
      },
      choice: async (_message: string, choices: readonly { value: string; label: string }[], defaultValue: string) => {
        menus.push({ choices, defaultValue })
        return choices.some(choice => choice.value === control.answer) ? control.answer : defaultValue
      },
    },
  }
  return { terminal, progress, calls, menus, control, options }
}
Describe('Firebase management', () => {
  Test('dry-run computes one encoded store path without authentication, prompts, or cloud calls', async () => {
    const f = fixture()
    const result = await runFirebaseManagement('data-reset', undefined, {
      ...f.options,
      project: 'saved-project',
      uid: 'user-123',
      store: 'My Notes',
      dryRun: true,
    })
    Expect(result).toEqual({
      projectId: 'saved-project',
      database: '(default)',
      path: 'users/user-123/stores/s_My%20Notes',
      recursive: true,
      warning:
        'Server reset does not clear local offline replicas: they can republish data. Stop clients and clear their local stores before reconnecting. Auth users, other stores, project settings, and apps are preserved.',
      dryRun: true,
    })
    Expect(f.calls).toEqual([])
    Expect(f.control.accountReads).toBe(0)
    Expect(f.menus).toEqual([])
    Expect(JSON.parse(f.terminal.outputText())).toEqual(result)
    Expect(f.progress.outputText()).toContain('offline replicas')
  })
  Test(
    'authored store keys preserve raw text while slashes, percent escapes, and dots stay in one prefixed segment',
    async () => {
      for (
        const [store, path] of [
          ['notes/archive%2f', 'users/user-123/stores/s_notes%2Farchive%252f'],
          ['-notes', 'users/user-123/stores/s_-notes'],
          ['.', 'users/user-123/stores/s_.'],
          ['..', 'users/user-123/stores/s_..'],
          [' Notes ', 'users/user-123/stores/s_%20Notes%20'],
        ]
      ) {
        const f = fixture()
        const result = await runFirebaseManagement('data-reset', undefined, {
          ...f.options,
          project: 'saved-project',
          uid: 'user-123',
          store: store!,
          dryRun: true,
        })
        Expect(result).toMatchObject({ path })
        Expect(f.calls).toEqual([])
      }
      for (const store of [' ', '\ud800', 'x'.repeat(1_499)]) {
        const f = fixture()
        await Expect(
          runFirebaseManagement('data-reset', undefined, {
            ...f.options,
            project: 'saved-project',
            uid: 'user-123',
            store,
            dryRun: true,
          }),
        ).rejects.toThrow('StorageKey')
        Expect(f.control.accountReads).toBe(0)
      }
    },
  )
  Test('confirmed reset deletes exactly one store in the default database and preserves other scope', async () => {
    const f = fixture()
    await runFirebaseManagement('data-reset', undefined, {
      ...f.options,
      project: 'saved-project',
      uid: 'user-123',
      store: 'Notes',
    })
    Expect(f.menus).toEqual([{
      choices: [{ value: 'continue', label: 'Continue' }, { value: 'stop', label: 'Stop' }],
      defaultValue: 'continue',
    }])
    Expect(f.calls).toEqual([[
      'firestore:delete',
      'users/user-123/stores/s_Notes',
      '--project',
      'saved-project',
      '--database',
      '(default)',
      '--recursive',
      '--force',
      '--non-interactive',
      '--json',
      '--account',
      'first@example.test',
    ]])
    Expect(f.terminal.outputText()).not.toContain(canary)
    Expect(f.progress.outputText()).toContain('Auth users, other stores, project settings, and apps are preserved')
  })
  Test('local reset prompt redraws invalid input and Enter confirms Continue by default', async () => {
    const f = fixture()
    const terminal = fakeTerminal('wrong\n\n')
    await runFirebaseManagement('data-reset', undefined, {
      ...f.options,
      prompts: undefined,
      input: terminal.input,
      output: terminal.output,
      progress: terminal.output,
      interactive: true,
      project: 'saved-project',
      uid: 'user-123',
      store: 'Notes',
    })
    Expect(terminal.outputText()).toContain('1. Continue (default)\n2. Stop')
    Expect(terminal.outputText()).toContain('ctrl+c to quit')
    Expect(f.calls.map(call => call[0])).toEqual(['firestore:delete'])
  })
  Test('local reset menu label 2 cancels before account access', async () => {
    const f = fixture()
    const terminal = fakeTerminal('2\n')
    await Expect(
      runFirebaseManagement('data-reset', undefined, {
        ...f.options,
        prompts: undefined,
        input: terminal.input,
        progress: terminal.output,
        interactive: true,
        project: 'saved-project',
        uid: 'user-123',
        store: 'Notes',
      }),
    ).rejects.toThrow('cancelled')
    Expect(f.calls).toEqual([])
    Expect(f.control.accountReads).toBe(0)
  })
  Test('Stop cancels reset before authentication or mutation', async () => {
    const f = fixture()
    f.control.answer = 'stop'
    await Expect(
      runFirebaseManagement('data-reset', undefined, {
        ...f.options,
        project: 'saved-project',
        uid: 'user-123',
        store: 'Notes',
      }),
    ).rejects.toThrow('cancelled')
    Expect(f.calls).toEqual([])
    Expect(f.control.accountReads).toBe(0)
  })
  Test('rejects malformed identifiers and flags before authentication', async () => {
    for (
      const invalid of [
        { project: '../project', uid: 'user', store: 'Notes' },
        { project: 'saved-project', uid: '..', store: 'Notes' },
        { project: 'saved-project', uid: 'u/other', store: 'Notes' },
        { project: 'saved-project', uid: 'user\n', store: 'Notes' },
        { project: 'saved-project', uid: 'user', store: 'Notes\n' },
        { project: 'saved-project', uid: '--all-collections', store: 'Notes' },
      ]
    ) {
      const f = fixture()
      await Expect(runFirebaseManagement('data-reset', undefined, { ...f.options, ...invalid })).rejects.toThrow()
      Expect(f.calls).toEqual([])
      Expect(f.control.accountReads).toBe(0)
    }
    const f = fixture()
    await Expect(runFirebaseManagement('projects-list', undefined, { ...f.options, dryRun: true })).rejects.toThrow(
      'does not apply',
    )
    await Expect(runFirebaseManagement('apps-config', '1:123:ios:abc', { ...f.options, project: 'saved-project' }))
      .rejects.toThrow('web app ID')
    Expect(f.control.accountReads).toBe(0)
  })
  Test('lists all app platforms and exposes only known public fields', async () => {
    const f = fixture()
    Expect(await runFirebaseManagement('apps-list', undefined, { ...f.options, project: 'saved-project' })).toEqual([{
      appId,
      displayName: 'Web app',
      platform: 'WEB',
    }, { appId: '1:123456789:ios:abcdef1234', platform: 'IOS' }])
    Expect(f.calls[0]).toEqual([
      'apps:list',
      '--project',
      'saved-project',
      '--non-interactive',
      '--json',
      '--account',
      'first@example.test',
    ])
    Expect(f.terminal.outputText()).not.toContain(canary)
    Expect(f.progress.outputText()).not.toContain(canary)
  })
  Test('configuration verifies app ownership and returns only public SDK fields', async () => {
    const f = fixture()
    Expect(await runFirebaseManagement('apps-config', appId, { ...f.options, project: 'saved-project' })).toEqual({
      projectId: 'saved-project',
      appId,
      apiKey: 'public-api-key',
      authDomain: 'saved-project.firebaseapp.com',
    })
    Expect(f.calls.map(call => call[0])).toEqual(['apps:list', 'apps:sdkconfig'])
    Expect(f.terminal.outputText()).not.toContain(canary)
    const other = fixture()
    await Expect(
      runFirebaseManagement('apps-config', '1:123:web:other', { ...other.options, project: 'saved-project' }),
    ).rejects.toThrow('does not belong')
    Expect(other.calls.map(call => call[0])).toEqual(['apps:list'])
  })
  Test('lists and inspects project identity without private result fields', async () => {
    const f = fixture()
    Expect(await runFirebaseManagement('projects-info', 'saved-project', f.options)).toEqual({
      projectId: 'saved-project',
      displayName: 'Saved',
    })
    Expect(f.terminal.outputText()).not.toContain(canary)
  })
  Test('multiple local accounts choose the first by default and explicit account must be signed in', async () => {
    const f = fixture()
    f.control.accounts.push('second@example.test')
    await runFirebaseManagement('projects-list', undefined, f.options)
    Expect(f.menus[0]).toEqual({
      choices: [{ value: 'first@example.test', label: 'first@example.test' }, {
        value: 'second@example.test',
        label: 'second@example.test',
      }],
      defaultValue: 'first@example.test',
    })
    const other = fixture()
    await Expect(
      runFirebaseManagement('projects-list', undefined, { ...other.options, account: 'missing@example.test' }),
    ).rejects.toThrow('not signed in')
    Expect(other.calls).toEqual([])
  })
  Test('creation accepts the generated project ID on Enter and registers web apps only', async () => {
    const f = fixture()
    await runFirebaseManagement('projects-create', undefined, f.options)
    Expect(f.control.textDefault).toMatch(/^tao-project-[a-f0-9]{8}$/u)
    Expect(f.calls[0]?.slice(0, 2)).toEqual(['projects:create', f.control.textDefault])
    const app = fixture()
    await runFirebaseManagement('apps-create', 'My App', { ...app.options, project: 'saved-project' })
    Expect(app.calls[0]?.slice(0, 5)).toEqual(['apps:create', 'WEB', 'My App', '--project', 'saved-project'])
  })
  Test('provider failures never include raw errors, stderr, or token objects', async () => {
    const f = fixture()
    f.control.failure = true
    let message = ''
    try {
      await runFirebaseManagement('projects-list', undefined, f.options)
    } catch (error) {
      message = String(error)
    }
    Expect(message).toContain('could not list Firebase projects')
    Expect(message).not.toContain(canary)
    Expect(f.terminal.outputText()).not.toContain(canary)
  })
  Test('JSON signed-out flow gives local sign-in guidance before an inherited-output login', async () => {
    const f = fixture()
    f.control.accounts = []
    await Expect(runFirebaseManagement('projects-list', undefined, f.options)).rejects.toThrow(
      'Run tao firebase projects list in an interactive local terminal to sign in, then retry with --json',
    )
    Expect(f.calls).toEqual([])
    Expect(f.terminal.outputText()).toBe('')
  })
  Test('ordinary signed-out flow retains local login before reading projects', async () => {
    const f = fixture()
    let reads = 0
    await runFirebaseManagement('projects-list', undefined, {
      ...f.options,
      json: false,
      accounts: async () => ++reads === 1 ? [] : [{ user: { email: 'first@example.test' } }],
    })
    Expect(f.calls.map(call => call[0])).toEqual(['login', 'projects:list'])
  })
  Test('server commands reject endpoint and emulator overrides before account lookup or mutation', async () => {
    for (
      const name of [
        'FIRESTORE_EMULATOR_HOST',
        'FIRESTORE_URL',
        'FIREBASE_EMULATOR_HUB',
        'FIREBASE_API_URL',
        'FIREBASE_RESOURCEMANAGER_URL',
        'FIREBASE_IAM_URL',
        'FIREBASE_SERVICE_USAGE_URL',
        'CLOUD_APIKEYS_URL',
        'FIREBASE_FIREDATA_URL',
        'FIREBASE_AUTH_URL',
        'FIREBASE_AUTHPROXY_URL',
        'FIREBASE_TOKEN_URL',
        'FIREBASE_GOOGLE_URL',
        'FIREBASE_CLIENT_ID',
        'FIREBASE_CLIENT_SECRET',
      ]
    ) {
      const slot = testOverrideSlot({
        read: () => Platform.runtimeProcess.env[name],
        write: (value: string | undefined) => {
          if (value === undefined) {
            delete Platform.runtimeProcess.env[name]
          } else {
            Platform.runtimeProcess.env[name] = value
          }
        },
      })
      const restore = slot.install('http://endpoint-secret-canary.test')
      try {
        const f = fixture()
        await Expect(runFirebaseManagement('projects-list', undefined, f.options)).rejects.toThrow('Unset ' + name)
        Expect(f.calls).toEqual([])
        Expect(f.control.accountReads).toBe(0)
        Expect(
          await runFirebaseManagement('data-reset', undefined, {
            ...f.options,
            project: 'saved-project',
            uid: 'user',
            store: 'Notes',
            dryRun: true,
          }),
        ).toMatchObject({ dryRun: true })
      } finally {
        restore()
      }
    }
  })
  Test(
    'installed vendor preparation cannot redirect the confirmed project through caller or ancestor aliases',
    async () => {
      const cwd = await mkTestDir('firebase-management-alias')
      await FS.writeJson(FS.resolvePath('firebase.json', cwd), {})
      await FS.writeJson(FS.resolvePath('.firebaserc', cwd), {
        projects: { 'saved-project': 'production-project', default: 'production-project' },
      })
      const nested = FS.resolvePath('nested/child', cwd)
      await FS.mkdir(nested)
      const vendor = FS.dirname(FS.fileUrlToPath(import.meta.resolve('firebase-tools/lib/command.js')))
      const baseline = await CLI.run('node', {
        args: ['-e', VENDOR_PREPARATION, vendor, nested, ''],
        cwd,
        stdio: 'pipe',
      })
      Expect(baseline.exitCode).toBe(0)
      Expect(JSON.parse(baseline.stdout).projectId).toBe('production-project')
      const f = fixture()
      let prepared: Record<string, unknown> | undefined
      let isolated = ''
      await runFirebaseManagement('data-reset', undefined, {
        ...f.options,
        cwd: nested,
        project: 'saved-project',
        uid: 'user',
        store: 'Notes',
        runner: async (args, work) => {
          isolated = work
          const config = args[args.indexOf('--config') + 1]!
          const probe = await CLI.run('node', {
            args: ['-e', VENDOR_PREPARATION, vendor, work, config],
            cwd,
            stdio: 'pipe',
          })
          Expect(probe.exitCode).toBe(0)
          prepared = JSON.parse(probe.stdout)
          return { exitCode: 0, stdout: JSON.stringify({ status: 'success', result: {} }), stderr: '' }
        },
      })
      Expect(prepared).toEqual({
        projectId: 'saved-project',
        account: 'first@example.test',
        projectRoot: isolated,
        aliases: {},
      })
      Expect(isolated.startsWith(FS.resolvePath('.artifacts/firebase-management-', nested))).toBe(true)
      Expect(await FS.exists(isolated)).toBe(false)
      Expect(await FS.readJson(FS.resolvePath('.firebaserc', cwd))).toEqual({
        projects: { 'saved-project': 'production-project', default: 'production-project' },
      })
    },
  )
  Test('inherited token authentication stops before account or cloud calls', async () => {
    const f = fixture()
    const restore = tokenPresence.install(canary)
    try {
      await Expect(runFirebaseManagement('projects-list', undefined, f.options)).rejects.toThrow('Unset FIREBASE_TOKEN')
      Expect(f.calls).toEqual([])
      Expect(f.control.accountReads).toBe(0)
    } finally {
      restore()
    }
  })
  Test('management registration retains Firebase backend generation and rejects broad reset flags', async () => {
    const firebase = createCommands().commands.find(command => command.name() === 'firebase')!
    Expect(firebase.commands.map(command => command.name())).toEqual(['projects', 'apps', 'data', 'generate'])
    const reset = firebase.commands.find(command => command.name() === 'data')!.commands[0]!
    Expect(reset.options.map(option => option.long)).toEqual([
      '--project',
      '--uid',
      '--store',
      '--dry-run',
      '--account',
      '--json',
    ])
    Expect(reset.helpInformation()).toContain('offline replicas can republish data')
    Expect(reset.options.some(option => option.long === '--all-collections')).toBe(false)
    reset.exitOverride().configureOutput({ writeErr: () => {} })
    await Expect(
      reset.parseAsync(['--project', 'saved-project', '--uid', 'user', '--store', 'Notes', '--all-collections'], {
        from: 'user',
      }),
    ).rejects.toThrow("unknown option '--all-collections'")
  })
})
