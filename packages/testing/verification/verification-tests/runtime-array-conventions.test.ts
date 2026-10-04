import { Describe, Expect, Test } from '@shared/test'
import { runtimeArrayConventionIssues } from '../verification-src/RuntimeArrayConventions'

const runtimePath = 'packages/apps/runtime/TaoRuntime-src/new-feature.ts'

Describe('runtime array ordering boundary', () => {
  Test('rejects mutating and unavailable ordering methods, including extracted members', () => {
    const source = [
      'nodes.sort(compare)',
      'nodes.reverse()',
      'nodes?.toSorted(compare)',
      'nodes["toReversed"]()',
      'const sort = nodes.sort',
      'const { reverse: backwards } = nodes',
      'const { ["sort"]: sorted } = nodes',
      'let sort; ({ sort } = nodes)',
      '({ nested: { reverse: backwards } } = state)',
      '([{ ["toSorted"]: sorted }] = arrays)',
      'for ({ sort } of arrays) {}',
      'for ({ reverse } in values) {}',
    ].join('\n')
    const issues = runtimeArrayConventionIssues([{ path: runtimePath, source }])
    Expect(issues.map(issue => issue.split(' accesses')[0])).toEqual([
      `${runtimePath}:1`,
      `${runtimePath}:2`,
      `${runtimePath}:3`,
      `${runtimePath}:4`,
      `${runtimePath}:5`,
      `${runtimePath}:6`,
      `${runtimePath}:7`,
      `${runtimePath}:8`,
      `${runtimePath}:9`,
      `${runtimePath}:10`,
      `${runtimePath}:11`,
      `${runtimePath}:12`,
    ])
    Expect(issues[0]).toContain('Arrays.sorted')
    Expect(issues[1]).toContain('Arrays.reversed')
  })

  Test('allows the implementation boundary and does not inspect comments or emitted text', () => {
    Expect(runtimeArrayConventionIssues([
      { path: 'packages/apps/runtime/TaoRuntime-src/core/Arrays.ts', source: 'return [...values].sort(compare)' },
      { path: 'packages/dev/tool.ts', source: 'values.toSorted()' },
      {
        path: runtimePath,
        source: `
          // values.sort()
          const message = 'values.toReversed()'
          Arrays.sorted(values)
          Arrays.reversed(values)
          Arrays.sortInPlace(owned, compare)
          values.toString()
          const options = { sort: true, reverse: false }
        `,
      },
    ])).toEqual([])
  })
})
