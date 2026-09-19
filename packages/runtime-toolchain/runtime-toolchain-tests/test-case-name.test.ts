import { Describe, Expect, Test } from '@shared/test'
import { TestCaseName } from '../runtime-toolchain-src/testing/test-case-name'
import type * as TestCompiler from '../runtime-toolchain-src/testing/test-compiler/TestCompiler'

const file = { sourcePath: '/projects/HN Reader/HNReader.test.tao', suites: [] } as TestCompiler.File
const suite = { checks: [], name: 'hn reader', source: { filePath: file.sourcePath } } as TestCompiler.Suite
const check = { name: 'adds a story' } as TestCompiler.Check

Describe('Tao journey names', () => {
  // This string is what a person writes a `tao test --name` pattern against, and what the runner
  // matches `--testNamePattern` against. Both read the same spelling, so it is a product surface.
  Test('name a journey by its file, its suite, and itself', () => {
    Expect(TestCaseName.journey(suite, check)).toBe('hn reader > adds a story')
    Expect(TestCaseName.segments(file, suite, check)).toEqual([
      'Tao test command',
      'HNReader.test.tao',
      'hn reader > adds a story',
    ])
    Expect(TestCaseName.full(file, suite, check)).toBe(
      'Tao test command HNReader.test.tao hn reader > adds a story',
    )
  })

  // Jest identifies a case by its ancestor titles and its own title joined with a single space. A
  // `full` that stopped agreeing with `segments` would let this command report a selection the
  // runner does not make.
  Test('join the runner name path exactly as the runner does', () => {
    Expect(TestCaseName.full(file, suite, check)).toBe(TestCaseName.segments(file, suite, check).join(' '))
  })
})
