// A demonstration for a decision Ro deferred, not a gate: what a lint against `.kind`-chain dispatch
// would see. `packages/AGENTS.md` asks for the shared `Switch` helpers over native `switch`, and
// `repo-lint` bans `switch (`, but an `if (x.kind === 'a') … else if (x.kind === 'b') …` chain does
// the same dispatch without exhaustiveness and the ban cannot see it. Run it to see the current
// picture:
//
//     bun run packages/dev/dev-src/repository-tests/kind-chain-demo.ts
//
// The two ways to settle it: wire `kindChainIssues` into `CONVENTION_RULES` with an allowlist and
// ratchet the chains down, or drop the `Switch` mandate from `packages/AGENTS.md` and let both
// forms coexist. This file lets the choice be made on the actual count rather than a guess.
import { FS, HCI, Repo } from '@shared'

/** A KindChain is a run of `if`/`else if` branches that test the same discriminant against literals. */
export type KindChain = {
  discriminant: string
  length: number
  line: number
  path: string
}

/**
 * kindChainsIn finds every chain of at least `minimum` consecutive branches on one discriminant.
 * A branch is `if (` or `} else if (` whose condition compares `<expr>.kind`, `.type`, or `.$type`
 * to a string literal; branches belong to one chain while they name the same expression and no
 * more than `gapLines` lines separate them, which is how far a branch body usually runs.
 */
export function kindChainsIn(path: string, source: string, minimum = 3, gapLines = 24): KindChain[] {
  const branch = /^\s*(?:\}\s*)?(?:else\s+)?if\s*\(\s*(?:!)?([\w.$?]+)\.(kind|type|\$type)\s*[!=]==\s*['"]/
  const chains: KindChain[] = []
  let current: KindChain | undefined
  let lastLine = -Infinity
  source.split('\n').forEach((text, index) => {
    const match = branch.exec(text)
    const line = index + 1
    if (match === undefined || match === null) {
      return
    }
    const discriminant = `${match[1]}.${match[2]}`
    if (current !== undefined && current.discriminant === discriminant && line - lastLine <= gapLines) {
      current.length += 1
    } else {
      if (current !== undefined && current.length >= minimum) {
        chains.push(current)
      }
      current = { discriminant, length: 1, line, path }
    }
    lastLine = line
  })
  if (current !== undefined && current.length >= minimum) {
    chains.push(current)
  }
  return chains
}

/** kindChainIssues is the shape a `CONVENTION_RULES` entry would report, one line per chain. */
export function kindChainIssues(files: readonly { path: string; source: string }[]): string[] {
  return files
    .flatMap(file => kindChainsIn(file.path, file.source))
    .map(chain =>
      `${chain.path}:${chain.line} dispatches ${chain.length} branches on \`${chain.discriminant}\`;`
      + ' a `Switch.kind` over the union would be checked for exhaustiveness.'
    )
    .sort()
}

if (import.meta.main) {
  const repoRoot = Repo.getRoot()
  const files: { path: string; source: string }[] = []
  for await (
    const path of FS.walk(FS.resolvePath('packages', repoRoot), {
      excludeDirectory: name => name === 'node_modules' || name.startsWith('_gen_'),
      extensions: ['.ts', '.tsx'],
    })
  ) {
    files.push({ path: FS.relativePath(repoRoot, path), source: await FS.readText(path) })
  }
  const chains = files.flatMap(file => kindChainsIn(file.path, file.source))
  const byFile = new Map<string, number>()
  for (const chain of chains) {
    byFile.set(chain.path, (byFile.get(chain.path) ?? 0) + chain.length)
  }
  HCI.writeLine(
    `${chains.length} chains of 3+ branches, ${
      chains.reduce((sum, chain) => sum + chain.length, 0)
    } branches, in ${byFile.size} files.`,
  )
  HCI.writeLine('')
  HCI.writeLine('Files with the most chained branches:')
  for (const [path, branches] of [...byFile].sort((left, right) => right[1] - left[1]).slice(0, 15)) {
    HCI.writeLine(`  ${String(branches).padStart(4)}  ${path}`)
  }
  HCI.writeLine('')
  HCI.writeLine('Longest chains:')
  for (const chain of chains.toSorted((left, right) => right.length - left.length).slice(0, 10)) {
    HCI.writeLine(`  ${String(chain.length).padStart(4)}  ${chain.path}:${chain.line}  on \`${chain.discriminant}\``)
  }
}
