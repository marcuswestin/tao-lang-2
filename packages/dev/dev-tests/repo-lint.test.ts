import { Describe, Expect, Test } from '@shared/test'
import {
  duplicateDescribeTitleIssues,
  missingTestAppReadmeEntries,
  wordFlowerPairIssues,
} from '../dev-src/commands/repo-lint'

const absorbed = '// Tranche status: absorbed'
const open = '// Tranche status: open'

Describe('repo lint contracts', () => {
  Test('accepts an absorbed byte-identical WordFlower pair', () => {
    Expect(wordFlowerPairIssues(pair(`${absorbed}\nview Main { }`, `${absorbed}\nview Main { }`))).toEqual([])
  })

  Test('accepts an explicitly open divergent WordFlower pair', () => {
    Expect(wordFlowerPairIssues(pair(`${absorbed}\nview Main { }`, `${open}\nview Main { render New() }`))).toEqual([])
  })

  Test('rejects a stale open marker when the contracts otherwise match', () => {
    const issues = wordFlowerPairIssues(pair(`${absorbed}\nview Main { }`, `${open}\nview Main { }`))

    Expect(issues).toEqual([
      'Next.tao-next matches Current.tao after normalizing the status header and must be absorbed.',
    ])
  })

  Test('rejects an absorbed marker while the contracts diverge', () => {
    const issues = wordFlowerPairIssues(
      pair(`${absorbed}\nview Main { }`, `${absorbed}\nview Main { render New() }`),
    )

    Expect(issues).toEqual(['Next.tao-next diverges from Current.tao and must be open.'])
  })

  Test('requires exactly one status header in each WordFlower file', () => {
    const issues = wordFlowerPairIssues(pair('view Main { }', `${open}\n${open}\nview Main { }`))

    Expect(issues).toEqual([
      'Current.tao must contain exactly one tranche status header.',
      'Next.tao-next must contain exactly one tranche status header.',
    ])
  })

  Test('reports Test App directories without README contracts', () => {
    Expect(missingTestAppReadmeEntries(
      ['Data MVP', 'Navigation MVP'],
      '# Test Apps\n\n## Navigation MVP\n\nNavigation behavior.\n',
    )).toEqual(['Data MVP'])
  })

  Test('reports Describe titles duplicated across test files', () => {
    Expect(duplicateDescribeTitleIssues([
      { path: 'a.test.ts', source: "Describe('shared title', () => {})" },
      { path: 'b.test.ts', source: 'Describe("shared title", () => {})' },
      { path: 'c.test.ts', source: "Describe('distinct title', () => {})" },
    ])).toEqual(['Describe title "shared title" is duplicated across a.test.ts, b.test.ts.'])
  })

  Test('reports Describe titles duplicated across backtick literals', () => {
    Expect(duplicateDescribeTitleIssues([
      { path: 'a.test.ts', source: 'Describe(`template title`, () => {})' },
      { path: 'b.test.ts', source: 'Describe(`template title`, () => {})' },
      { path: 'c.test.ts', source: 'Describe(`title ${variant}`, () => {})' },
      { path: 'd.test.ts', source: 'Describe(`title ${variant}`, () => {})' },
    ])).toEqual(['Describe title "template title" is duplicated across a.test.ts, b.test.ts.'])
  })

  Test('allows a Describe title repeated within one test file', () => {
    Expect(duplicateDescribeTitleIssues([{
      path: 'a.test.ts',
      source: "Describe('local grouping', () => {})\nDescribe('local grouping', () => {})",
    }])).toEqual([])
  })
})

function pair(currentSource: string, nextSource: string) {
  return {
    currentPath: 'Current.tao',
    currentSource,
    label: 'app contract',
    nextPath: 'Next.tao-next',
    nextSource,
  }
}
