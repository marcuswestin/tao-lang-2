import { Describe, Expect, Test } from '@shared/test'
import { Assert, FS, Repo } from '../shared-src/shared'

/*
 * `packages/runtime` ships to the device and imports nothing from `@shared`, so it keeps hand
 * copies of a few shared modules. These checks read each pair from disk and compare the mirrored
 * code itself — comments stripped, the runtime's naming prefix removed — so a change to one side
 * that is not made to the other fails here rather than going unnoticed.
 *
 * Two runtime copies are deliberately not compared because they have diverged on purpose:
 * `TR-switch.ts` is a value-only subset of `Switch_TypeSafe.ts` with a precompiled-table entry
 * point, and `TR-errors.ts`'s `errorMessage` names message-less platform events that
 * `Errors.messageOf` flattens to `[object Object]`.
 */

const runtimeSrc = 'packages/runtime/TaoRuntime-src'
const sharedSrc = 'packages/shared/shared-src'

Describe('runtime mirrors of shared code', () => {
  Test('RuntimeAssert is Assert under the runtime name', async () => {
    const shared = codeFrom(await sourceOf(`${sharedSrc}/core/Assert.ts`), 'export const Assert')
    const runtime = codeFrom(await sourceOf(`${runtimeSrc}/TR-assert.ts`), 'export const RuntimeAssert')
      .replaceAll('RuntimeAssert', 'Assert')

    Expect(runtime).toBe(shared)
  })

  Test('runtimeTestOverrideSlot is testOverrideSlot under the runtime name', async () => {
    const shared = codeFrom(await sourceOf(`${sharedSrc}/testing/TestOverride.ts`), 'export type TestOverrideAccess')
    const runtime = codeFrom(
      await sourceOf(`${runtimeSrc}/TR-test-override.ts`),
      'export type RuntimeTestOverrideAccess',
    )
      .replaceAll('RuntimeTestOverride', 'TestOverride')
      .replaceAll('runtimeTestOverrideSlot', 'testOverrideSlot')

    Expect(runtime).toBe(shared)
  })

  Test('layoutHeads lists exactly layoutHeads in design', async () => {
    const shared = quotedWords(
      await sourceOf('packages/ast-utils/ast-utils-src/design.ts'),
      /layoutHeads = \[([^\]]*)\]/,
    )
    const runtime = quotedWords(
      await sourceOf(`${runtimeSrc}/TR-design.ts`),
      /const layoutHeads = new Set<TaoLayoutEntry\[0\]>\(\[([^\]]*)\]/,
    )

    Expect(shared.length).toBeGreaterThan(0)
    Expect(runtime).toEqual(shared)
  })

  Test('every runtime record guard is Json.isRecord', async () => {
    const shared = guardExpression(await sourceOf(`${sharedSrc}/core/Json.ts`), 'isRecord')
    const runtimeGuards = [
      ['TR-data-schema.ts', 'isRecord'],
      ['TR-navigation-browser-history.ts', 'isRecord'],
      ['TR-studio-device-protocol.ts', 'isObject'],
      ['TR-studio-preview.tsx', 'isObject'],
      ['TR-studio-state.ts', 'isObject'],
    ] as const

    for (const [file, name] of runtimeGuards) {
      Expect(`${file}: ${guardExpression(await sourceOf(`${runtimeSrc}/${file}`), name)}`).toBe(`${file}: ${shared}`)
    }
  })
})

async function sourceOf(repoPath: string): Promise<string> {
  return await FS.readText(Repo.resolvePath(repoPath))
}

/**
 * codeFrom is the code of `source` from the line holding `start` to the end of the file, with
 * comments and blank lines removed so that only code counts as drift.
 */
function codeFrom(source: string, start: string): string {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.length > 0)
    .join('\n')
  const index = code.indexOf(start)
  Assert(index >= 0, `mirrored code starts at '${start}'`, { start })
  return code.slice(index)
}

/** quotedWords is the list of single-quoted words inside the first capture of `pattern`. */
function quotedWords(source: string, pattern: RegExp): string[] {
  const match = source.match(pattern)
  Assert.defined(match?.[1], `source matches ${pattern}`, { pattern: pattern.source })
  return [...match[1].matchAll(/'([^']+)'/g)].map(quoted => quoted[1]!)
}

/** guardExpression is the one expression a `value is Record<…>` guard named `name` returns. */
function guardExpression(source: string, name: string): string {
  const pattern = new RegExp(`function ${name}\\(value: unknown\\): value is Record<[^>]+> \\{\\n\\s*return (.+)\\n\\}`)
  const match = source.match(pattern)
  Assert.defined(match?.[1], `source declares a record guard named '${name}'`, { name })
  return match[1]
}
