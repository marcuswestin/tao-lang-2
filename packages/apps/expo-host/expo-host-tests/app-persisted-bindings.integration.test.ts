import { Workspace } from '@compiler/workspace'
import TR from '@runtime/TR'
import { FS, ProjectIdentity } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'

const source = (version: string) => `
  use StackNav from @tao/nav
  project app Base { id "com.tao.base" version "${version}"
    name "Base"
    state Width is number = 320 (persist)
    action Set410() { set Width = 410 }
    action Set530() { set Width = 530 }
    Navigator StackNav { Initial Home }
  }
  app Variant = Base with { id "com.tao.variant", version "${version}" }
  scene Home() { Title "Home" render Empty() }
  view Empty() { render inject \`\`\`ts return null \`\`\` }
`

type BoundApp = {
  scope: {
    Width: { key: string; load(): Promise<void>; evaluate(): { jsValue: number } }
    Set410: unknown
    Set530: unknown
  }
}

function generatedBinding(
  code: string,
  name: 'Base' | 'Variant',
  moduleScope: object,
  base?: (id: string) => BoundApp,
): (id: string) => BoundApp {
  const start = code.indexOf(`function _TaoBindApp_${name}`)
  const end = code.indexOf(`const _TaoBoundApp_${name}`, start)
  Expect(start).toBeGreaterThanOrEqual(0)
  Expect(end).toBeGreaterThan(start)
  const generated = new Bun.Transpiler({ loader: 'ts' }).transformSync(code.slice(start, end))
  return new Function(
    `_TaoAppModuleScope_${name}`,
    '_TaoBindApp_Base',
    'TR',
    `${generated}\nreturn _TaoBindApp_${name}`,
  )(moduleScope, base, TR) as (id: string) => BoundApp
}

async function bindCompiledApps(path: string, projectId: string, version: string): Promise<{
  base: BoundApp
  variant: BoundApp
}> {
  const result = await Workspace.compile(path, { appName: 'Variant' })
  Expect(result.validation.diagnostics).toEqual([])
  const entry = result.files.find(file => file.sourcePath === path)
  Expect(entry).toBeDefined()
  const code = entry!.code
  Expect(code).toContain(projectId)
  Expect(code).toContain(`version: "${version}"`)
  Expect(code).toContain('_TaoBindApp_Base("com.tao.base")')
  Expect(code).toContain('_TaoBindApp_Variant("com.tao.variant")')
  const moduleScope = {}
  const base = generatedBinding(code, 'Base', moduleScope)
  let inheritedVariant: BoundApp | undefined
  const variant = generatedBinding(code, 'Variant', moduleScope, appId => {
    inheritedVariant = base(appId)
    return inheritedVariant
  })
  const baseApp = base('com.tao.base')
  variant('com.tao.variant')
  Expect(inheritedVariant).toBeDefined()
  return { base: baseApp, variant: inheritedVariant! }
}

Describe('generated app persisted bindings with the runtime', () => {
  Test('isolates live base and variant actions and restores both across release versions', async () => {
    const values = new Map<string, string>()
    const storage: TR.KeyValueStorage = {
      getItem: async key => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value)
      },
    }
    const restoreStorage = TR.Persisted.setStorageForTests(storage)
    try {
      await withTaoFiles('tao-app-persisted-integration-', {
        'Main.tao': source('1.0.0'),
      }, async (paths, root) => {
        const projectId = ProjectIdentity.read(root)
        Expect(projectId).toBeDefined()
        const first = await bindCompiledApps(paths['Main.tao'], projectId!, '1.0.0')
        await Promise.all([first.base.scope.Width.load(), first.variant.scope.Width.load()])
        Expect(first.base.scope.Width.evaluate().jsValue).toBe(320)
        Expect(first.variant.scope.Width.evaluate().jsValue).toBe(320)

        await TR.Do(first.base.scope.Set410 as Parameters<typeof TR.Do>[0])
        Expect(first.base.scope.Width.evaluate().jsValue).toBe(410)
        Expect(first.variant.scope.Width.evaluate().jsValue).toBe(320)
        await TR.Do(first.variant.scope.Set530 as Parameters<typeof TR.Do>[0])
        Expect(first.base.scope.Width.evaluate().jsValue).toBe(410)
        Expect(first.variant.scope.Width.evaluate().jsValue).toBe(530)
        Expect(first.base.scope.Width.key).not.toBe(first.variant.scope.Width.key)

        await TR.Persisted.beginLaunch()
        await FS.writeText(paths['Main.tao'], source('2.0.0'))
        Expect(ProjectIdentity.read(root)).toBe(projectId)
        const next = await bindCompiledApps(paths['Main.tao'], projectId!, '2.0.0')
        await Promise.all([next.base.scope.Width.load(), next.variant.scope.Width.load()])
        Expect(next.base.scope.Width.key).toBe(first.base.scope.Width.key)
        Expect(next.variant.scope.Width.key).toBe(first.variant.scope.Width.key)
        Expect(next.base.scope.Width.evaluate().jsValue).toBe(410)
        Expect(next.variant.scope.Width.evaluate().jsValue).toBe(530)
      })
    } finally {
      restoreStorage()
    }
  })
})
