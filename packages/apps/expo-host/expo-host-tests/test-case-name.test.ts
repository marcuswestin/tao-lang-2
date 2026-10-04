import { Describe, Expect, Test } from '@shared/test'
import { TestCaseName } from '../expo-host-src/testing/test-case-name'
import type * as TestCompiler from '../expo-host-src/testing/test-compiler/TestCompiler'

const file = { sourcePath: '/projects/HN Reader/HNReader.test.tao', suites: [], version: 1 } as TestCompiler.File
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
})
