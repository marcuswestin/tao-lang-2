import Workspace from '@compiler/workspace'
import { FS, ProjectIdentity, ReleaseCapabilities } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { lowerCreationPlan, writeCreationFiles } from '../cli-src/create/creation-lowering'
import { deterministicPlan } from '../cli-src/create/creation-plan'
import { runFix } from '../cli-src/source-commands'
import { runTestCommandOnce } from '../cli-src/test-command'

Describe('tao create Firebase', () => {
  Test('lowers private account data and a local auth journey into a valid project', async () => {
    const plan = deterministicPlan('A notebook for short notes')
    const files = lowerCreationPlan(plan, { provider: 'firebase' })
    Expect(files['README.md']).toContain('tao connect firebase --app ANotebookFor')
    Expect(files['README.md']).toContain('tao connect firebase --manual')
    Expect(files['README.md']).toContain('no separate backend server')
    Expect(files['App.tao']).toContain('Auth FirebaseAuth {')
    Expect(files['App.tao']).toContain('Datasource Firebase {')
    Expect(files['Data.tao']).toContain('data Accounts / Account')
    Expect(files['Data.tao']).not.toContain('access ')
    Expect(files['Auth.tao']).toContain('set Flow.Registration = false')
    Expect(files['Auth.tao']).toContain('set Flow.Registration = true')
    Expect(files['Auth.tao']).toContain('on press ExistingAccount')
    Expect(files['Auth.tao']).toContain('on press CreateAccount')
    Expect(files['Auth.tao']).toContain('do SignOut()')
    Expect(files['Auth.tao']).not.toContain('Fill validation credentials')
    Expect(files['ANotebookFor.test.tao']).not.toContain('fills validation credentials')
    Expect(files['Items/Items.tao']).toContain('create Item {')
    Expect(files['ANotebookFor.test.tao']).toContain('Datasource Memory { }')
    Expect(files['ANotebookFor.test.tao']).not.toContain('use Firebase')

    const root = await mkTestDir('tao-create-firebase-')
    try {
      await writeCreationFiles(root, files)
      await ProjectIdentity.ensure(root)
      await runFix(root, { cwd: root })
      const workspace = await Workspace.open(root)
      const problems: string[] = []
      for (const entry of ['App.tao', 'Scenarios.tao', 'ANotebookFor.test.tao']) {
        const result = await workspace.validate(FS.resolvePath(entry, root))
        problems.push(
          ...result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
            `${entry}: ${diagnostic.message}`
          ),
        )
      }
      Expect(problems).toEqual([])
      const journey = await runTestCommandOnce(root, { output: 'quiet' })
      Expect(journey.failed).toBe(false)
    } finally {
      await FS.remove(root)
    }
  }, 60_000)

  Test('includes the synthetic fill action only when validation tools are requested', async () => {
    const plan = deterministicPlan('A notebook for short notes')
    const files = lowerCreationPlan(plan, { provider: 'firebase', validationTools: true })
    Expect(files['Auth.tao']).toContain('set Flow.Email = "tao-hosted-validation@example.test"')
    Expect(files['Auth.tao']).toContain('set Flow.Password = "Tao-validation-only-2026!"')
    Expect(files['Auth.tao']).toContain('FormButton("Fill validation credentials")')
    Expect(files['ANotebookFor.test.tao']).toContain('fills validation credentials without signing in')
    const root = await mkTestDir('tao-create-firebase-validation-')
    try {
      await writeCreationFiles(root, files)
      await ProjectIdentity.ensure(root)
      await runFix(root, { cwd: root })
      const journey = await runTestCommandOnce(root, { output: 'quiet' })
      Expect(journey.failed).toBe(false)
    } finally {
      await FS.remove(root)
    }
  }, 60_000)

  Test('passes the correct registration value to a local auth provider', async () => {
    const plan = deterministicPlan('A notebook for short notes')
    const files = lowerCreationPlan(plan, { provider: 'firebase' })
    const testFile = 'ANotebookFor.test.tao'
    const source = files[testFile]!
    const signInApp = source.match(/app ANotebookForSignInTest \{[\s\S]*?\n\}/u)?.[0]
    Expect(signInApp).toBeDefined()
    Expect(source).toContain(signInApp)
    files[testFile] = source.replace(
      'use TestAuth from @tao/auth/testing',
      'use TestAuth from @tao/auth/testing\nuse ProbeAuth from ./ProbeAuth',
    )
      .replace(
        signInApp!,
        `${signInApp!.replace('Auth TestAuth { }', 'Auth ProbeAuth { ExpectedRegister false }')}

${
          signInApp!.replaceAll('SignInTest', 'SignUpTest').replace('sign-in-test', 'sign-up-test').replace(
            'Auth TestAuth { }',
            'Auth ProbeAuth { ExpectedRegister true }',
          )
        }`,
      )
      .replace(
        'test "creates an account" {\n      run ANotebookForSignInTest',
        'test "creates an account" {\n      run ANotebookForSignUpTest',
      )
    files['ProbeAuth.tao'] = `use AuthProvider from @tao/auth

public
type ProbeAuth is AuthProvider with {
   ExpectedRegister boolean is false
   issues { TestIdentity }
   provider ProbeAuthProvider from ./ProbeAuth.ts
}
`
    files['ProbeAuth.ts'] = `import type TR from '@runtime/TR'

export function ProbeAuthProvider(): TR.AuthProvider {
  return {
    testing: true,
    connect({ configuration }) {
      const principal = { issuer: 'tao:test', subject: 'probe-account' }
      let state: TR.AuthConnectionSession = { state: 'SignedOut' }
      return {
        capabilities: { methods: ['Password'] },
        async restore() { return state },
        async signIn(input) {
          if ((input.fields?.['Register'] === 'true') !== (configuration['ExpectedRegister'] === true)) {
            return { outcome: { status: 'rejected', message: 'Wrong registration mode.' } }
          }
          state = { state: 'SignedIn', principal }
          return { outcome: { status: 'completed' }, session: state }
        },
        cancel() {},
        async signOut() {
          state = { state: 'SignedOut' }
          return { status: 'completed' }
        },
        async proof({ kind }) { return { kind, ...principal, accountId: 'probe-account' } },
      }
    },
  }
}
`
    const root = await mkTestDir('tao-create-firebase-auth-probe-')
    try {
      await writeCreationFiles(root, files)
      await ProjectIdentity.ensure(root)
      await runFix(root, { cwd: root })
      const journey = await runTestCommandOnce(root, { output: 'quiet' })
      Expect(journey.failed).toBe(false)
    } finally {
      await FS.remove(root)
    }
  }, 60_000)

  Test('rejects account declaration collisions', () => {
    const plan = deterministicPlan('A notebook for short notes')
    plan.entities[0]!.plural = 'Accounts'
    plan.entities[0]!.singular = 'Account'
    Expect(() => lowerCreationPlan(plan, { provider: 'firebase' })).toThrow('reserves Accounts')
    const appPlan = deterministicPlan('A notebook for short notes')
    appPlan.name = 'Account'
    Expect(() => lowerCreationPlan(appPlan, { provider: 'firebase' })).toThrow('reserves Account')
    for (const name of ['ANotebookForAuthNavigator', 'ANotebookForAccountGate', 'ANotebookForSignIn']) {
      const authPlan = deterministicPlan('A notebook for short notes')
      authPlan.entities[0]!.plural = name
      Expect(() => lowerCreationPlan(authPlan, { provider: 'firebase' })).toThrow(`reserves ${name}`)
    }
    for (const name of ['Firebase', 'FirebaseAuth']) {
      const aliasPlan = deterministicPlan('A notebook for short notes')
      aliasPlan.name = name
      Expect(() => lowerCreationPlan(aliasPlan, { provider: 'firebase' })).toThrow(`reserves ${name}`)
    }
  })

  Test('rejects Firebase lowering in a public release profile', () => {
    const plan = deterministicPlan('A notebook for short notes')
    Expect(() => lowerCreationPlan(plan, { provider: 'firebase', releaseProfile: ReleaseCapabilities.profile(1) }))
      .toThrow(ReleaseCapabilities.diagnostic('auth', ReleaseCapabilities.profile(1)))
  })
})
