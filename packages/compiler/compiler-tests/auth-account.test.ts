import { Workspace } from '@compiler/workspace'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { BridgeMetadata } from '../compiler-src/bridge-metadata'
import { TestCompiler as Compiler } from './test-compile'

Describe('compiler: app-scoped auth and account data', () => {
  Test('mounts an authenticated local-only app through the same scoped catalog its reads and writes use', async () => {
    const result = await Compiler.compileCode(`
      use TestAuth from @tao/auth/testing
      data Drafts / Draft { Body text, local only }
      app Notes { Auth TestAuth { State "SignedOut" } view Main }
      view Main() {
        query Drafts = Drafts with { }
        action Add() { create Draft { Body: "Local" } }
        render Label("Drafts: { Drafts.Count }")
      }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const code = result.code.replace(/\s+/g, ' ')
    Expect(code).toContain('TR.Auth.UseDatasources(_TaoAuthScope, [')
    Expect(code).toContain(
      'store: _Scope._TaoLocalDataCatalog, source: _Scope._TaoLocalDatasource, localOnly: _TaoAppDefinition_Notes.declaration.canonicalIdentity!.canonical,',
    )
    Expect(code).toContain('TR.Data.Query( TR.Auth.Store(_TaoAuthScope, _Scope._TaoLocalDataCatalog)')
    Expect(code).toContain('TR.Data.Create( TR.Auth.Store(_TaoAuthScope, _Scope._TaoLocalDataCatalog)')
    Expect(code).not.toContain('TR.Data.UseConfigured(')
    Expect(code).not.toContain('datasources: () =>')
  })

  Test('binds independent auth configuration and mounts the scoped host', async () => {
    const result = await Compiler.compileCode(`
      use TestAuth from @tao/auth/testing
      app Notes { Name "Notes" Auth TestAuth { State "SignedOut" } view Main }
      view Main() { render Label("Welcome") }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const code = result.code.replace(/\s+/g, ' ')
    Expect(code).toContain('auth: () => TR.Auth.Configure(')
    Expect(code).toContain('TR.Auth.UseScope(_TaoAppDefinition_Notes.definition.auth?.())')
    Expect(code).toContain('<TR.Auth.Host scope={_TaoAuthScope}>')
  })

  Test('binds current-account aliases and module actions to their caller scope', async () => {
    const result = await Compiler.compileCode(`
      use Account, SignIn, SignOut from @tao/auth
      use TestAuth from @tao/auth/testing
      data Accounts / Account { DisplayName text, Notes }
      data Notes / Note { Owner Account, Body text }
      let Me = Account
      action Leave() { do SignOut() }
      action Enter() { when do SignIn() { completed -> { } cancelled -> { } rejected -> Message { } error -> Message { } } }
      app NotesApp { Auth TestAuth { } view Main }
      view Main() {
        query Mine = Me.Notes
        render Label("Welcome")
      }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const code = result.code.replace(/\s+/g, ' ')
    Expect(code).toContain('_Scope.Me = TR.Function((_TaoAuthArgument: TR.Evaluable) =>')
    Expect(code).toContain("TR.Auth.Account(_TaoAuthScope!, _Scope._TaoDataCatalog, 'Account')")
    Expect(code).toContain('_Scope.Leave = TR.Function((_TaoAuthArgument: TR.Evaluable) =>')
    Expect(code).toContain("declared: ['cancelled', 'rejected']")
    Expect(code).toContain('TR.Call(_Scope.SignOut, TR.Value(_TaoAuthScope)).evaluate()')
    Expect(code).toContain('TR.Data.Query( TR.Auth.Store(_TaoAuthScope, _Scope._TaoDataCatalog)')
  })

  Test('binds app-owned actions emitted at module scope to their mounted caller', async () => {
    const result = await Compiler.compileCode(`
      use SignOut from @tao/auth
      use TestAuth from @tao/auth/testing
      use FormButton from @tao/ui
      app Notes {
        Auth TestAuth { }
        action Leave() { do SignOut() }
        view Main(Leave: Leave)
      }
      view Main(Leave action()) {
        action LeaveLocally() { do Leave() }
        render FormButton(Title: "Leave") { on press LeaveLocally }
      }
    `)
    const code = result.code.replace(/\s+/g, ' ')
    Expect(code).toContain('_Scope.Leave = TR.Function((_TaoAuthArgument: TR.Evaluable) =>')
    Expect(code).toContain('TR.Call(_Scope.Leave, TR.Value(_TaoAuthScope)).evaluate()')
    Expect(code).toContain('TR.Call(_Scope.SignOut, TR.Value(_TaoAuthScope)).evaluate()')
    Expect(code).not.toContain('_Scope.LeaveLocally = TR.Function')
  })

  Test('checks sidecar contracts against the actual scoped auth calling convention', async () => {
    const result = await Compiler.compileCode(`
      use Session, SignInFlow, SignInView from @tao/auth
      use TestAuth from @tao/auth/testing
      app Notes { Auth TestAuth { } view Main }
      view Main() { state Flow = SignInFlow() render SignInView(Flow) }
    `)
    const contract = BridgeMetadata.collect(result.validation.files).find(file =>
      file.path.endsWith('/@tao/auth/Auth.tao.ts')
    )
    Expect(contract).toBeDefined()
    Expect(contract!.code).toContain(
      'export type Session = (scope: TR.AuthScope, cases: Readonly<Record<string, TR.Evaluable>>) => TR.Evaluable',
    )
    Expect(contract!.code).toContain('export type SignInFlow = (scope: TR.AuthScope, arg0: string | null) =>')
    Expect(contract!.code).toContain('export type SignIn = (scope: TR.AuthScope) => TR.Action<[]>')
    Expect(contract!.code).toContain('export type SignOut = (scope: TR.AuthScope) => TR.Action<[]>')
    Expect(contract!.code).toContain('Auth?: TR.AuthScope')
    Expect(contract!.code).toContain('Account?: TR.Evaluable')
  })

  Test('inherits auth settings and applies a variant patch without a mounted singleton', async () => {
    const result = await Compiler.compileCode(
      `
      use TestAuth from @tao/auth/testing
      app Notes { Auth TestAuth { State "SignedOut" } view Main }
      app Preview = Notes with { Auth with { State "Restoring" } }
      view Main() { render Label("Welcome") }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `,
      { appName: 'Preview' },
    )
    Expect(result.code).toContain('TR.Auth.Patch(')
    Expect(result.code).toContain('"Restoring"')
  })

  Test('patches Firebase auth and datasource settings only on the selected app variant', async () => {
    const result = await Compiler.compileCode(
      `
      use FirebaseAuth from @tao/auth/firebase
      use Firebase from @tao/data/providers/firebase
      data Notes / Note { Title text }
      app Local {
        Auth FirebaseAuth { ApiKey "local-key" ProjectId "local-project" }
        Datasource Firebase { ApiKey "local-key" ProjectId "local-project" }
        view Main
      }
      app Hosted = Local with { }
      view Main() { render Label("Ready") }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `,
      {
        appName: 'Hosted',
        appAuthConfiguration: { ApiKey: 'hosted-key', ProjectId: 'hosted-project', AppId: 'hosted-app' },
        appFirebaseConfiguration: { ApiKey: 'hosted-key', ProjectId: 'hosted-project', AppId: 'hosted-app' },
      },
    )
    const local = result.code.slice(result.code.indexOf('const _TaoAppDefinition_Local ='))
    const hosted = local.slice(local.indexOf('const _TaoAppDefinition_Hosted ='))
    const base = local.slice(0, local.indexOf('const _TaoAppDefinition_Hosted ='))
    Expect(base).toContain('"ApiKey": TR.Value("local-key")')
    Expect(base).not.toContain('hosted-key')
    Expect(hosted).toContain('TR.Auth.Patch(')
    Expect(hosted).toContain('TR.Data.Patch(')
    Expect(hosted.match(/"ApiKey": TR.Value\("hosted-key"\)/gu)).toHaveLength(2)
    Expect(hosted.match(/"AppId": TR.Value\("hosted-app"\)/gu)).toHaveLength(2)
  })

  Test('does not apply Firebase settings to another provider with the same AppId slot', async () => {
    const result = await Compiler.compileCode(
      `
      use InstantAuth from @tao/auth/instantdb
      use InstantDB from @tao/data/providers/instantdb
      data Notes / Note { Title text }
      app NotesApp {
        Auth InstantAuth { AppId "auth-local" }
        Datasource InstantDB { AppId "data-local" }
        view Main
      }
      view Main() { render Label("Ready") }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `,
      {
        appName: 'NotesApp',
        appAuthConfiguration: { AppId: 'firebase-auth' },
        appFirebaseConfiguration: { AppId: 'firebase-data' },
      },
    )
    Expect(result.code).toContain('"AppId": TR.Value("auth-local")')
    Expect(result.code).toContain('"AppId": TR.Value("data-local")')
    Expect(result.code).not.toContain('firebase-auth')
    Expect(result.code).not.toContain('firebase-data')
  })

  Test('patches inherited Firebase auth across modules after the variant author patch', async () => {
    await withTaoFiles('tao-firebase-auth-variant-', {
      'Base.tao': `
        use FirebaseAuth from @tao/auth/firebase
        public app Base {
          Auth FirebaseAuth { ApiKey "source-key" ProjectId "source-project" }
          view Main
        }
        view Main() { render Label("Ready") }
        view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
      `,
      'Main.tao': `
        use Base from ./Base
        app Hosted = Base with { Auth with { AuthDomain "source.firebaseapp.com" } }
      `,
    }, async paths => {
      const result = await Workspace.compile(paths['Main.tao'], {
        appName: 'Hosted',
        appAuthConfiguration: { ApiKey: 'hosted-key', ProjectId: 'hosted-project' },
      })
      const hosted = result.code.slice(result.code.indexOf('const _TaoAppDefinition_Hosted ='))
      Expect(hosted).toContain('"AuthDomain": TR.Value("source.firebaseapp.com")')
      Expect(hosted).toContain('"ApiKey": TR.Value("hosted-key")')
      Expect(hosted).toContain('"ProjectId": TR.Value("hosted-project")')
      Expect(hosted.indexOf('source.firebaseapp.com')).toBeLessThan(hosted.indexOf('hosted-key'))
    })
  })

  Test('publishes server policy and symbolic offline scopes without reading a live account', async () => {
    const result = await Compiler.compileCode(`
      use Account from @tao/auth
      use LocalAuth from @tao/auth/local
      use Reference from @tao/data/providers/reference
      let Me = Account
      type Role is one of Owner, Member
      data Accounts / Account { DisplayName text, Notes }
      data Notes / Note { Owner Account, Body text, Role }
      data Memberships / Membership { Person Account, Role, unique Person + Role }
      access Account { Account can read; Account can update DisplayName }
      access Note { Owner can read, create, delete; Owner can update Body }
      app NotesApp {
        // Reference pairs with an Auth whose sign-in proof its server accepts.
        Auth LocalAuth { Endpoint "http://localhost:4738" Resource "test" }
        Datasource Reference { ServerURL "http://localhost:4738" Resource "test" Offline { Me, Me.Notes } }
        view Main
      }
      view Main() { render Label("Ready") }
      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const policy = result.files.find(file => file.relativePath === 'TaoDataPolicy.json')
    Expect(policy).toBeDefined()
    const parsed = JSON.parse(policy!.code)
    Expect(parsed.entities.Note.grants).toContainEqual({
      operations: ['update'],
      principal: ['Owner'],
      updateFields: ['Body'],
    })
    Expect(parsed.entities.Membership.unique).toEqual([['Person', 'Role']])
    const code = result.code.replace(/\s+/g, ' ')
    Expect(code).toContain(
      '"Offline": [{"entity":"Account","field":"id","actor":"account"},{"entity":"Note","field":"Owner","actor":"account"}]',
    )
    Expect(code).toContain('enumValues: () => _Scope.Role')
  })

  Test('uses the read guard for Account availability before entering otherwise', async () => {
    const result = await Compiler.compileCode(`
      use Account from @tao/auth
      use TestAuth from @tao/auth/testing
      use Col from @tao/ui
      data Accounts / Account { DisplayName text }
      let Me = Account
      app NotesApp { Auth TestAuth { } view Main }
      view Main() {
        render Col() { when Me | otherwise -> Label("Ready") }
      }

      view Label(Value text) { render inject Value \`\`\`ts return null \`\`\` }
    `)
    const code = result.code.replace(/\s+/g, ' ')
    Expect(code).toContain('TR.WhenReadRender(TR.Call(_Scope.Me, TR.Value(_TaoAuthScope)).evaluate(), [')
    Expect(code).toContain('}), _ViewProps.__tao)')
  })
})
