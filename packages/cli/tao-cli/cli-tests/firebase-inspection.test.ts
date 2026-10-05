import { CLI, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { firebaseInspectionFailure, inspectFirebase, listFirebaseAccounts } from '../cli-src/firebase-inspection'
import VENDOR_API_V2 from './fixtures/firebase-inspection/api-v2.cjs.txt'
import VENDOR_API from './fixtures/firebase-inspection/api.cjs.txt'
import VENDOR_AUTH from './fixtures/firebase-inspection/auth.cjs.txt'
import VENDOR_REQUIRE_AUTH from './fixtures/firebase-inspection/require-auth.cjs.txt'
import VENDOR_RULES from './fixtures/firebase-inspection/rules.cjs.txt'

/** Run the production Node bridge against isolated vendor modules, never local accounts or cloud APIs. */
async function vendorFixture() {
  const root = await mkTestDir('firebase-inspection')
  await FS.writeJson(FS.resolvePath('package.json', root), { type: 'commonjs' })
  const statePath = FS.resolvePath('state.json', root)
  const state = {
    enabled: false,
    passwordRequired: false,
    denied: false,
    absent: false,
    absentStatus: 404,
    disabledDatabase: false,
    disabledRules: false,
    emptyAuth: false,
    failureStage: '',
    failureStatus: 403,
    failureCode: 'PERMISSION_DENIED',
    oauthSecret: 'OAUTH_SECRET_CANARY',
  }
  await FS.writeJson(statePath, state)
  for (
    const [name, source] of [
      ['auth.js', VENDOR_AUTH],
      ['requireAuth.js', VENDOR_REQUIRE_AUTH],
      ['api.js', VENDOR_API],
      ['apiv2.js', VENDOR_API_V2],
      ['gcp/rules.js', VENDOR_RULES],
    ] as const
  ) {
    await FS.writeText(FS.resolvePath(name, root), source)
  }
  const captures: string[] = []
  const runner = async (script: string, args: readonly string[], cwd: string) => {
    const rewritten = args.length === 1 ? [FS.resolvePath('auth.js', root)] : [root, ...args.slice(1)]
    const result = await CLI.run('node', { args: ['-e', script, ...rewritten], cwd, stdio: 'pipe' })
    captures.push(result.stdout, result.stderr)
    return result
  }
  const request = { projectId: 'test-project', account: 'selected@example.test', cwd: root }
  return { root, statePath, state, runner, captures, request }
}

Describe('Firebase public inspection bridge', () => {
  Test('selected account binds all reads while raw credentials and Auth hash secrets never leave Node', async () => {
    const f = await vendorFixture()
    const accounts = await listFirebaseAccounts(f.root, f.runner)
    Expect(accounts).toEqual([{ user: { email: 'default@example.test' } }, {
      user: { email: 'selected@example.test' },
    }])
    const before = await inspectFirebase(f.request, f.runner)
    Expect(before.auth.emailPasswordEnabled).toBe(false)
    Expect(before.auth.preserved).toMatch(/^[a-f0-9]{64}$/u)
    Expect(before.rules?.source).toBe('deployed rules source')
    const calls = await FS.readJson<
      { account: string; path: string; options: { queryParams?: { pageToken?: string } } }[]
    >(FS.resolvePath('calls.json', f.root))
    Expect(calls.every(call => call.account === 'selected@example.test')).toBe(true)
    Expect(calls.filter(call => call.path.endsWith('/defaultSupportedIdpConfigs'))).toHaveLength(2)
    Expect(calls.some(call => call.options.queryParams?.pageToken === 'next')).toBe(true)
    f.state.enabled = true
    f.state.passwordRequired = true
    await FS.writeJson(f.statePath, f.state)
    const after = await inspectFirebase(f.request, f.runner)
    Expect(after.auth.emailPasswordEnabled).toBe(true)
    Expect(after.auth.preserved).toBe(before.auth.preserved)
    for (
      const canary of [
        'TOKEN_SECRET_CANARY',
        'HASH_SECRET_CANARY',
        'SALT_SECRET_CANARY',
        'SMTP_SECRET_CANARY',
        'OAUTH_SECRET_CANARY',
        'OTHER_SECRET_CANARY',
      ]
    ) {
      Expect(f.captures.join('')).not.toContain(canary)
    }
    f.state.oauthSecret = 'CHANGED_OAUTH_SECRET_CANARY'
    await FS.writeJson(f.statePath, f.state)
    Expect((await inspectFirebase(f.request, f.runner)).auth.preserved).not.toBe(before.auth.preserved)
    Expect(f.captures.join('')).not.toContain('CHANGED_OAUTH_SECRET_CANARY')
  })

  Test('email-link configuration remains password capable without requiring its mode to change', async () => {
    const f = await vendorFixture()
    f.state.enabled = true
    await FS.writeJson(f.statePath, f.state)
    const result = await inspectFirebase(f.request, f.runner)
    Expect(result.auth.emailPasswordEnabled).toBe(true)
    Expect(result.auth.emailPasswordRequired).toBe(false)
  })

  Test('permission denial fails closed without exposing any vendor response', async () => {
    const f = await vendorFixture()
    f.state.denied = true
    await FS.writeJson(f.statePath, f.state)
    await Expect(inspectFirebase(f.request, f.runner)).rejects.toThrow('Firebase inspection failed')
    Expect(f.captures.join('')).toBe(
      JSON.stringify({ failure: { stage: 'databases', status: 403, code: 'PERMISSION_DENIED' } }),
    )
  })

  Test(
    'uninitialized Auth is distinct from an enabled provider and can be initialized without lost settings',
    async () => {
      const f = await vendorFixture()
      f.state.absent = true
      await FS.writeJson(f.statePath, f.state)
      const before = await inspectFirebase(f.request, f.runner)
      Expect(before.auth).toEqual({ emailPasswordEnabled: false, preserved: null })
      f.state.absent = false
      f.state.enabled = true
      f.state.passwordRequired = true
      f.state.emptyAuth = true
      await FS.writeJson(f.statePath, f.state)
      Expect((await inspectFirebase(f.request, f.runner)).auth).toEqual({
        emailPasswordEnabled: true,
        emailPasswordRequired: true,
        preserved: null,
      })
    },
  )

  Test('fresh-project disabled APIs and exact HTTP 400 missing Auth configuration are inspectable', async () => {
    const f = await vendorFixture()
    f.state.disabledDatabase = true
    f.state.disabledRules = true
    f.state.absent = true
    f.state.absentStatus = 400
    await FS.writeJson(f.statePath, f.state)
    const before = await inspectFirebase(f.request, f.runner)
    Expect(before).toEqual({ auth: { emailPasswordEnabled: false, preserved: null } })
    const calls = await FS.readJson<{ path: string }[]>(FS.resolvePath('calls.json', f.root))
    Expect(calls.map(call => call.path)).toEqual([
      '/projects/test-project/databases',
      '/admin/v2/projects/test-project/config',
    ])
    Expect(f.captures.join('')).not.toContain('SECRET_CANARY')
  })

  Test('public failures retain the owning API stage and status while all raw errors remain inside Node', async () => {
    const cases = [
      ['databases', 403, 'PERMISSION_DENIED'],
      ['auth-config', 403, 'PERMISSION_DENIED'],
      ['auth-config', 400, 'INVALID_ARGUMENT'],
      ['auth-config', 404, 'NOT_FOUND'],
      ['auth-providers', 403, 'PERMISSION_DENIED'],
      ['rules-release', 403, 'PERMISSION_DENIED'],
      ['rules-source', 503, 'UNAVAILABLE'],
      ['auth-config', 403, 'CONFIGURATION_NOT_FOUND'],
      ['databases', 400, 'SERVICE_DISABLED'],
      ['auth-config', 403, 'UNRECOGNIZED_SECRET_CANARY'],
    ] as const
    for (const [stage, status, code] of cases) {
      const f = await vendorFixture()
      f.state.failureStage = stage
      f.state.failureStatus = status
      f.state.failureCode = code
      await FS.writeJson(f.statePath, f.state)
      let caught: unknown
      try {
        await inspectFirebase(f.request, f.runner)
      } catch (error) {
        caught = error
      }
      const expected = { stage, status, code: code === 'UNRECOGNIZED_SECRET_CANARY' ? 'UNKNOWN' : code }
      Expect(firebaseInspectionFailure(caught)).toEqual(expected)
      Expect(String(caught)).toContain(`HTTP ${status}, ${expected.code}`)
      Expect(f.captures.join('')).toBe(JSON.stringify({ failure: expected }))
      Expect(String(caught)).not.toContain('SECRET_CANARY')
    }
  })

  Test('rules inspection permission denial cannot be mistaken for absent rules on a fresh project', async () => {
    const f = await vendorFixture()
    f.state.disabledDatabase = true
    f.state.absent = true
    f.state.failureStage = 'rules-release'
    await FS.writeJson(f.statePath, f.state)
    await Expect(inspectFirebase(f.request, f.runner)).rejects.toThrow('rules-release (HTTP 403, PERMISSION_DENIED)')
    Expect(f.captures.join('')).not.toContain('SECRET_CANARY')
  })
})
