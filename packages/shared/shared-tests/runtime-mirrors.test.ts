import { Describe, Expect, Test } from '@shared/test'
import { Assert, FS, Repo } from '../shared-src/shared'

/*
 * `packages/apps/runtime` ships to the device and imports nothing from `@shared`, so it keeps hand
 * copies of a few shared modules. These checks read each pair from disk and compare the mirrored
 * code itself — comments stripped, the runtime's naming prefix removed — so a change to one side
 * that is not made to the other fails here rather than going unnoticed.
 *
 * `TR-switch.ts` is deliberately not compared because it is a value-only subset of
 * `Switch_TypeSafe.ts` with a precompiled-table entry point.
 */

const runtimeSrc = 'packages/apps/runtime/TaoRuntime-src'
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

  Test('Bun and Jest publish the same Tao fixture helpers', async () => {
    const bun = namedReexports(await sourceOf(`${sharedSrc}/testing/Test-Bun.ts`), './TaoFixtures')
    const jest = namedReexports(await sourceOf(`${sharedSrc}/testing/Test-Jest.ts`), './TaoFixtures')

    Expect(bun).toEqual(jest)
  })

  Test('runtime error messages mirror shared unknown-value messages', async () => {
    const shared = functionsFrom(await sourceOf(`${sharedSrc}/core/Errors.ts`), [
      'errorDetail',
      'messageOf',
      'describeThrownValue',
    ])
    const runtime = functionsFrom(await sourceOf(`${runtimeSrc}/TR-errors.ts`), [
      'errorDetail',
      'errorMessage',
      'describeThrownValue',
    ]).replace('errorMessage', 'messageOf')

    Expect(runtime).toBe(shared)
  })

  Test('layoutHeads lists exactly layoutHeads in design', async () => {
    const shared = quotedWords(
      await sourceOf('packages/language/ast-utils/ast-utils-src/design.ts'),
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

/** namedReexports reads the stable named public surface re-exported from one local module. */
function namedReexports(source: string, module: string): string[] {
  const match = [...source.matchAll(/export\s+\{([\s\S]*?)\}\s+from\s+'([^']+)'/g)]
    .find(candidate => candidate[2] === module)
  Assert.defined(match?.[1], `source re-exports names from '${module}'`, { module })
  return match[1].split(',').map(name => name.trim().replace(/^type\s+/, '')).filter(Boolean).toSorted()
}

/** functionsFrom compares hand-copied function implementations without making shared depend on runtime. */
function functionsFrom(source: string, names: readonly string[]): string {
  return names.map(name => functionFrom(source, name)).join('\n')
}

function functionFrom(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  Assert(start >= 0, `source declares function '${name}'`, { name })
  const bodyStart = source.indexOf('{', start)
  Assert(bodyStart >= 0, `function '${name}' has a body`, { name })
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') {
      depth += 1
    }
    if (source[index] === '}') {
      depth -= 1
    }
    if (depth === 0) {
      return source.slice(start, index + 1)
    }
  }
  Assert(false, `function '${name}' has a closing brace`, { name })
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
