import { expect, test } from '@playwright/test'
import { FS } from '@shared'
import { expandHostTestSourcePatterns } from './HostTestSourceRegistry'

test('glob expansion discovers new source files in deterministic order', async () => {
  const root = await FS.mkTmpDir('tao-e2e-source-registry-')
  try {
    await FS.writeText(FS.resolvePath('packages/e2e-testing/Zeta.ts', root), 'export const zeta = true\n')
    await FS.writeText(FS.resolvePath('packages/e2e-testing/nested/Alpha.ts', root), 'export const alpha = true\n')
    await FS.writeText(FS.resolvePath('packages/e2e-testing/nested/View.tsx', root), 'export const view = true\n')

    const expansion = await expandHostTestSourcePatterns(root, ['packages/e2e-testing/**/*.{ts,tsx}'])

    expect(expansion.paths).toEqual([
      'packages/e2e-testing/Zeta.ts',
      'packages/e2e-testing/nested/Alpha.ts',
      'packages/e2e-testing/nested/View.tsx',
    ])
  } finally {
    await FS.remove(root)
  }
})

test('glob expansion excludes generated and dependency trees', async () => {
  const root = await FS.mkTmpDir('tao-e2e-source-exclusions-')
  try {
    await FS.writeText(FS.resolvePath('packages/e2e-testing/Included.ts', root), 'export const included = true\n')
    await FS.writeText(FS.resolvePath('packages/e2e-testing/_gen_output/Generated.ts', root), 'throw 1\n')
    await FS.writeText(FS.resolvePath('packages/e2e-testing/node_modules/Foreign.ts', root), 'throw 1\n')
    await FS.writeText(FS.resolvePath('packages/e2e-testing/.artifacts/Output.ts', root), 'throw 1\n')

    const expansion = await expandHostTestSourcePatterns(root, ['packages/e2e-testing/**/*.ts'])

    expect(expansion.paths).toEqual(['packages/e2e-testing/Included.ts'])
  } finally {
    await FS.remove(root)
  }
})

test('each unexpectedly empty registered pattern fails with its own pattern', async () => {
  const root = await FS.mkTmpDir('tao-e2e-source-empty-')
  try {
    await FS.writeText(FS.resolvePath('packages/e2e-testing/Included.ts', root), 'export const included = true\n')

    await expect(expandHostTestSourcePatterns(root, [])).rejects.toThrow('needs at least one pattern')
    await expect(expandHostTestSourcePatterns(root, [
      'packages/e2e-testing/**/*.ts',
      'packages/runtime/TaoRuntime-src/host-testing/**/*.ts',
    ])).rejects.toThrow(
      'Host-testing source pattern matched no files: packages/runtime/TaoRuntime-src/host-testing/**/*.ts',
    )
  } finally {
    await FS.remove(root)
  }
})
