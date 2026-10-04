import { Errors, FS, ProjectIdentity } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runHostedProviderGenerate } from '../cli-src/hosted-provider-generate'
import { type HostedProvider, readHostedProviderInputs } from '../cli-src/hosted-provider-inputs'
import { withTaoFixture } from './test-cli-files'

function source(provider: HostedProvider, access = true): string {
  const auth = provider === 'pylon'
    ? 'use PylonAuth from @tao/auth/pylon\n'
    : 'use Clerk from @tao/auth/clerk\n'
  const datasource = provider === 'jazz'
    ? 'Jazz { AppId "test-app" }'
    : provider === 'convex'
    ? 'Convex { DeploymentURL "https://example.convex.cloud" }'
    : 'Pylon { BaseURL "https://example.test" }'
  const authValue = provider === 'pylon'
    ? 'PylonAuth { BaseURL "https://example.test" }'
    : 'Clerk { PublishableKey "pk_test_example" }'
  return `use Text from @tao/ui
${auth}use ${
    provider === 'jazz' ? 'Jazz' : provider === 'convex' ? 'Convex' : 'Pylon'
  } from @tao/data/providers/${provider}

app Hosted {
   id "hosted-generate"
   version "1.0.0"
   name "Hosted generate"
   Auth ${authValue}
   Datasource ${datasource}
   view Main
}

view Main() {
   render Text("Hosted")
}

data Accounts / Account {
   DisplayName text,
}

data Notes / Note {
   Owner Account,
   Body text,
}

${
    access
      ? `access Account {
   Account can read
   Account can update DisplayName
}

access Note {
   Owner can read, create, delete
   Owner can update Body
}
`
      : ''
  }`
}

async function withApp(
  provider: HostedProvider,
  access: boolean,
  run: (appPath: string, output: string) => Promise<void>,
) {
  await withTaoFixture({ '.tao/.gitkeep': '', 'Hosted.tao': source(provider, access) }, async root => {
    await ProjectIdentity.ensure(root)
    await run(FS.resolvePath('Hosted.tao', root), FS.resolvePath('backend', root))
  })
}

Describe('tao hosted provider generate', () => {
  Test('rejects a selected app that binds a different provider', async () => {
    await withApp('convex', true, async (appPath, output) => {
      await Expect(runHostedProviderGenerate('jazz', appPath, { appName: 'Hosted', output })).rejects.toThrow(
        "App 'Hosted' binds no Jazz datasource",
      )
      Expect(await FS.exists(output)).toBe(false)
    })
  })

  Test('fails closed when the compiler emits no access policy', async () => {
    await withApp('convex', false, async (appPath, output) => {
      const generated = runHostedProviderGenerate('convex', appPath, { appName: 'Hosted', output })
      await Expect(generated).rejects.toBeInstanceOf(Errors.UserInputError)
      await Expect(generated).rejects.toThrow('has no compiled access policy')
      Expect(await FS.exists(output)).toBe(false)
    })
  })

  Test('refuses Jazz generation while its datasource cannot validate access rules', async () => {
    await withApp('jazz', true, async (appPath, output) => {
      await Expect(readHostedProviderInputs(appPath, 'Hosted', 'jazz')).rejects.toThrow(
        'Datasource Jazz does not support AccessRules',
      )
      await Expect(runHostedProviderGenerate('jazz', appPath, { appName: 'Hosted', output })).rejects.toThrow(
        'Datasource Jazz does not support AccessRules',
      )
      Expect(await FS.exists(output)).toBe(false)
    })
  })

  Test('generates Convex backend files and refuses conflicts before writing', async () => {
    await withApp('convex', true, async (appPath, output) => {
      await runHostedProviderGenerate('convex', appPath, { appName: 'Hosted', output })
      Expect(await FS.listDir(output)).toEqual(['auth.config.ts', 'schema.ts', 'tao.ts'])
      Expect(await FS.readText(FS.resolvePath('schema.ts', output))).toContain('defineTable')
      Expect(await FS.readText(FS.resolvePath('tao.ts', output))).toContain('ensureAccount')
      const schemaPath = FS.resolvePath('schema.ts', output)
      const taoPath = FS.resolvePath('tao.ts', output)
      const originalTao = await FS.readText(taoPath)
      await FS.writeText(schemaPath, 'hand-edited\n')
      await Expect(runHostedProviderGenerate('convex', appPath, { appName: 'Hosted', output })).rejects.toThrow(
        'Pass --force to replace them.',
      )
      Expect(await FS.readText(schemaPath)).toBe('hand-edited\n')
      Expect(await FS.readText(taoPath)).toBe(originalTao)
      await runHostedProviderGenerate('convex', appPath, { appName: 'Hosted', output, force: true })
      Expect(await FS.readText(schemaPath)).toContain('defineTable')
    })
  })

  Test('generates Pylon app and guarded function sources in nested directories', async () => {
    await withApp('pylon', true, async (appPath, output) => {
      await runHostedProviderGenerate('pylon', appPath, { appName: 'Hosted', output })
      Expect(await FS.listDir(output)).toEqual(['app.ts', 'functions'])
      Expect(await FS.listDir(FS.resolvePath('functions', output))).toEqual([
        'taoCommit.ts',
        'taoEnsureAccount.ts',
      ])
      Expect(await FS.readText(FS.resolvePath('functions/taoCommit.ts', output))).toContain(
        'createPylonCommitHandler',
      )
    })
  })
})
