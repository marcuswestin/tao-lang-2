import { Describe, Expect, Test } from '@shared/test'
import { instructionBudgetIssues, kindChainIssues } from '../verification-src/repo-lint'
import { simplifyAudit } from '../verification-src/simplify-audit/SimplifyAudit'

const chainPath = 'packages/studio/studio-src/StudioNew.ts'
const chain = [
  'function handle(message: Message) {',
  "  if (message.type === 'a') {",
  '    one()',
  "  } else if (message.type === 'b') {",
  '    two()',
  "  } else if (message.type === 'c') {",
  '    three()',
  '  }',
  '}',
].join('\n')

Describe('simplify audit', () => {
  Test('rejects a three-branch chain over one discriminant', () => {
    Expect(kindChainIssues([{ path: chainPath, source: chain }], [])).toEqual([
      `${chainPath}:2 dispatches 3 branches on \`message.type\`; use a \`Switch\` helper over the union instead.`,
    ])
  })

  Test('allows a chain in an allowlisted file and reports the entry once the chain is gone', () => {
    Expect(kindChainIssues([{ path: chainPath, source: chain }], [chainPath])).toEqual([])
    Expect(kindChainIssues([{ path: chainPath, source: 'export const none = 1' }], [chainPath])).toEqual([
      `${chainPath} no longer dispatches through a discriminant chain; drop its repo lint allowlist entry.`,
    ])
  })

  Test('leaves two-branch checks and test files alone', () => {
    const twoBranches = chain.split('\n').filter(line => !line.includes("'c'")).join('\n')
    Expect(kindChainIssues([{ path: chainPath, source: twoBranches }], [])).toEqual([])
    Expect(kindChainIssues([{ path: 'packages/studio/studio-tests/new.test.ts', source: chain }], [])).toEqual([])
  })

  Test('does not join guards from separate functions into one chain', () => {
    const guard = (
      kind: string,
    ) => [`function is${kind}(type: Type) {`, `  if (type.kind === '${kind}') {`, '    return true', '  }', '}']
    const source = ['a', 'b', 'c'].flatMap(guard).join('\n')
    Expect(kindChainIssues([{ path: chainPath, source }], [])).toEqual([])
  })

  Test('reports an instruction file over its budget and leaves reference files alone', () => {
    const issues = instructionBudgetIssues([
      { path: 'AGENTS.md', source: 'x'.repeat(12_761) },
      { path: 'packages/AGENTS.md', source: 'x'.repeat(6_001) },
      { path: 'agents/skills/git-workflow/SKILL.md', source: 'x'.repeat(12_000) },
      { path: 'agents/skills/git-workflow/references/landing.md', source: 'x'.repeat(50_000) },
    ])

    Expect(issues.length).toEqual(2)
    Expect(issues[0]).toContain('AGENTS.md is 12761 characters, over its 12760-character budget')
    Expect(issues[1]).toContain('packages/AGENTS.md is 6001 characters, over its 6000-character budget')
  })

  Test('counts what an agent carries, so folding one bullet into another does not clear the budget', () => {
    // A line budget is why this mattered: on 2026-09-21 AGENTS.md went over by a line and was brought
    // back under by merging two bullets, leaving the file the same size and the budget satisfied.
    const spreadOut = { path: 'AGENTS.md', source: `${'x'.repeat(12_860)}\n`.replace(/(.{50})/g, '$1\n') }
    const folded = { path: 'AGENTS.md', source: 'x'.repeat(12_860) }

    Expect(instructionBudgetIssues([spreadOut]).length).toEqual(1)
    Expect(instructionBudgetIssues([folded]).length).toEqual(1)
  })

  Test('measures source, constants, instructions, and docs from the files it is given', () => {
    const report = simplifyAudit([
      { path: chainPath, source: `const LIMIT = 200\n${chain}` },
      { path: 'packages/apps/runtime/TaoRuntime-src/TR-new.ts', source: 'const LIMIT = 200\n' },
      { path: 'packages/studio/studio-tests/new.test.ts', source: chain },
      { path: 'AGENTS.md', source: 'rule\n'.repeat(61) },
      { path: 'Docs/Roadmap/Topic/Plan.md', source: 'one\ntwo\n' },
    ])
    Expect(report.packages.map(entry => [entry.name, entry.lines, entry.kindChains])).toEqual([
      ['studio', 10, 1],
      ['apps/runtime', 1, 0],
    ])
    Expect(report.duplicatedConstants).toEqual([
      { name: 'LIMIT', paths: ['packages/apps/runtime/TaoRuntime-src/TR-new.ts', chainPath], value: '200' },
    ])
    Expect(report.instructions).toEqual([{ budget: 12_760, characters: 304, lines: 61, path: 'AGENTS.md' }])
    Expect(report.docs).toEqual([{ files: 1, lines: 2, subtree: 'Docs/Roadmap/Topic' }])
  })
})
