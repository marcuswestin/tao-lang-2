import Workspace from '@compiler/workspace'
import { FS, ProjectIdentity, ReleaseCapabilities } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { lowerCreationPlan, writeCreationFiles } from '../cli-src/create/creation-lowering'
import { deterministicPlan } from '../cli-src/create/creation-plan'
import { runFix } from '../cli-src/source-commands'
import { runTestCommandOnce } from '../cli-src/test-command'

Describe('tao create Firebase', () => {
  Test('lowers private account data, validation tools, and a local auth journey into one valid project', async () => {
    const plan = deterministicPlan('A notebook for short notes')
    const plain = lowerCreationPlan(plan, { provider: 'firebase' })
    Expect(plain['README.md']).toContain('tao connect firebase --app ANotebookFor')
    Expect(plain['README.md']).toContain('tao connect firebase --manual')
    Expect(plain['README.md']).toContain('no separate backend server')
    Expect(plain['App.tao']).toContain('Auth FirebaseAuth {')
    Expect(plain['App.tao']).toContain('Datasource Firebase {')
    Expect(plain['Data.tao']).toContain('data Accounts / Account')
    Expect(plain['Data.tao']).not.toContain('access ')
    Expect(plain['Auth.tao']).toContain('set Flow.Registration = false')
    Expect(plain['Auth.tao']).toContain('set Flow.Registration = true')
    Expect(plain['Auth.tao']).toContain('on press ExistingAccount')
    Expect(plain['Auth.tao']).toContain('on press CreateAccount')
    Expect(plain['Auth.tao']).toContain('do SignOut()')
    Expect(plain['Auth.tao']).not.toContain('Fill validation credentials')
    Expect(plain['ANotebookFor.test.tao']).not.toContain('fills validation credentials')
    Expect(plain['Items/Items.tao']).toContain('create Item {')
    Expect(plain['ANotebookFor.test.tao']).toContain('Datasource Memory { }')
    Expect(plain['ANotebookFor.test.tao']).not.toContain('use Firebase')

    // The validation-tools lowering only adds lines to the plain project, so the one journey below,
    // run on the validation-tools project, also stands for the plain project.
    const files = lowerCreationPlan(plan, { provider: 'firebase', validationTools: true })
    Expect(files['Auth.tao']).toContain('set Flow.Email = "tao-hosted-validation@example.test"')
    Expect(files['Auth.tao']).toContain('set Flow.Password = "Tao-validation-only-2026!"')
    Expect(files['Auth.tao']).toContain('FormButton("Fill validation credentials")')
    Expect(files['ANotebookFor.test.tao']).toContain('fills validation credentials without signing in')
    Expect(Object.keys(files).sort()).toEqual(Object.keys(plain).sort())
    for (const [path, source] of Object.entries(plain)) {
      if (path === 'Auth.tao' || path === 'ANotebookFor.test.tao' || path === 'README.md') {
        Expect({ path, extendsPlain: linesExtend(source, files[path]!) }).toEqual({ path, extendsPlain: true })
      } else {
        Expect({ path, source: files[path] }).toEqual({ path, source })
      }
    }

    // Swap the sign-in app's auth for a probe that rejects the wrong registration mode and add a
    // sign-up twin, so the same journey proves both registration values reach the provider.
    const testFile = 'ANotebookFor.test.tao'
    const source = files[testFile]!
    const signInApp = source.match(/app ANotebookForSignInTest \{[\s\S]*?\n\}/u)?.[0]
    Expect(signInApp).toBeDefined()
    Expect(source).toContain('test "creates an account" {\n      run ANotebookForSignInTest')
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
    files['ProbeAuth.tao'] = PROBE_AUTH_TAO
    files['ProbeAuth.ts'] = PROBE_AUTH_TS

    const root = await mkTestDir('tao-create-firebase-')
    try {
      await writeCreationFiles(root, files)
      await ProjectIdentity.ensure(root)
      await runFix(root, { cwd: root })
      const workspace = await Workspace.open(root)
      const problems: string[] = []
      for (const entry of ['App.tao', 'Scenarios.tao', testFile]) {
        const result = await workspace.validate(FS.resolvePath(entry, root))
        problems.push(
          ...result.diagnostics.filter(diagnostic => diagnostic.severity === 'error').map(diagnostic =>
            `${entry}: ${diagnostic.message}`
          ),
        )
      }
      Expect(problems).toEqual([])
      const compiled = await workspace.compile(FS.resolvePath('App.tao', root))
      Expect([compiled.code, ...compiled.files.map(file => file.code)].join('\n')).toMatch(
        /\["DisplayName"\]:\s*\{[^}]*defaultValue: ""/u,
      )
      const journey = await runTestCommandOnce(root, { output: 'quiet' })
      Expect(journey.failed).toBe(false)
    } finally {
      await FS.remove(root)
    }
  }, 180_000)

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

/** Whether `extended` holds every line of `plain`, in order, with only lines added between them. */
function linesExtend(plain: string, extended: string): boolean {
  const lines = extended.split('\n')
  let next = 0
  for (const line of plain.split('\n')) {
    while (next < lines.length && lines[next] !== line) {
      next += 1
    }
    if (next === lines.length) {
      return false
    }
    next += 1
  }
  return true
}

const PROBE_AUTH_TAO = `use AuthProvider from @tao/auth

public
type ProbeAuth is AuthProvider with {
   ExpectedRegister boolean is false
   issues { TestIdentity }
   provider ProbeAuthProvider from ./ProbeAuth.ts
}
`

const PROBE_AUTH_TS = `import type TR from '@runtime/TR'

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
