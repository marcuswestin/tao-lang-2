import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { VerificationLanes } from '../verification-src/VerificationLanes'

/**
 * A lane name that matches nothing looks exactly like a lane that was never run, which is why
 * `Finalize` asked for `full-verify` for months without anyone noticing that it re-verified every
 * branch. These tests are the thing that would have noticed: every name the code uses has to be a
 * recipe the `Justfile` really defines, and every lane the `Justfile` records a green tree under
 * has to be a name the code knows.
 */

/** Recipe names as `just` defines them: a name at column zero, before its parameters and colon. */
async function justRecipeNames(): Promise<Set<string>> {
  const text = await FS.readText(FS.resolvePath('Justfile', Repo.getRoot()))
  const names = new Set<string>()
  for (const line of text.split('\n')) {
    // A recipe is a name at column zero, then optional parameters — which may contain `=` in their
    // defaults — then a colon that is not `:=`, which is an assignment rather than a recipe.
    const match = /^([a-z_][\w-]*)(?:[^:\n]*)?:(?!=)/u.exec(line)
    if (match?.[1] !== undefined) {
      names.add(match[1])
    }
  }
  return names
}

/** Lanes the Justfile names in a `--lane` argument, which is what a run's records are keyed under. */
async function justLaneArguments(): Promise<Set<string>> {
  const text = await FS.readText(FS.resolvePath('Justfile', Repo.getRoot()))
  return new Set([...text.matchAll(/--lane ([\w-]+)/gu)].map(match => match[1]!))
}

Describe('verification lane names', () => {
  Test('every lane name the code uses is a recipe the Justfile defines', async () => {
    const recipes = await justRecipeNames()
    // Guard against a parser that silently matched nothing, which would make this test vacuous.
    Expect(recipes.has('verify')).toBe(true)
    Expect(recipes.has('verify-full')).toBe(true)
    const missing = VerificationLanes.ALL.filter(lane => !recipes.has(lane))
    Expect(missing).toEqual([])
  })

  Test('accepts real full and sandbox lanes as proof of verify', async () => {
    const recipes = await justRecipeNames()
    Expect(VerificationLanes.VERIFY_OR_WIDER.filter(lane => !recipes.has(lane))).toEqual([])
    // The exact bug: two of these three used to be `full-verify`-style names that match no record.
    Expect(VerificationLanes.VERIFY_OR_WIDER).toContain('verify-full')
    Expect(VerificationLanes.VERIFY_OR_WIDER).toContain('verify-full-sandbox')
  })

  Test('every lane the landing lock serializes is a recipe, so none of them escapes it by typo', async () => {
    const recipes = await justRecipeNames()
    Expect(VerificationLanes.LOCKED.filter(lane => !recipes.has(lane))).toEqual([])
  })

  Test('every --lane the Justfile passes is a name the code knows', async () => {
    const declared = new Set(VerificationLanes.ALL)
    const unknown = [...await justLaneArguments()].filter(lane => !declared.has(lane))
    // A lane the Justfile runs but the code cannot name is how a locked lane silently goes free,
    // and how a green record is written under a lane nothing will ever accept.
    Expect(unknown).toEqual([])
  })
})
