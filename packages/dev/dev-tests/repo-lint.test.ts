import { FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  duplicateDescribeTitleIssues,
  missingTestAppReadmeEntries,
  repoLintIssues,
  wordFlowerDirectoryIssues,
} from '../dev-src/repository-tests/repo-lint'

const absorbed = '// Tranche status: absorbed'
const open = '// Tranche status: open'

Describe('repo lint contracts', () => {
  Test('accepts absorbed byte-identical mapped WordFlower directories', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`), file('nested/Feature.test.tao', 'test "Feature" { }')],
      [
        file('WordFlower.tao-next', `${absorbed}\nview Main { }`),
        file('nested/Feature.test.tao-next', 'test "Feature" { }'),
      ],
    ))).toEqual([])
  })

  Test('accepts explicitly open content divergence', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [file('WordFlower.tao-next', `${open}\nview Main { render New() }`)],
    ))).toEqual([])
  })

  Test('accepts an open directory when a mapped Current file is missing from Next', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [
        file('WordFlower.tao', `${absorbed}\nview Main { }`),
        file('Documents.tao', 'view Documents { }'),
      ],
      [file('WordFlower.tao-next', `${open}\nview Main { }`)],
    ))).toEqual([])
  })

  Test('accepts an open directory when Next has an extra mapped file', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [
        file('WordFlower.tao-next', `${open}\nview Main { }`),
        file('Documents.tao-next', 'view Documents { }'),
      ],
    ))).toEqual([])
  })

  Test('keeps Next open while the nested scratch package exists', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [
        file('WordFlower.tao-next', `${open}\nview Main { }`),
        file('@tao-next/Prelude.tao-next', 'primitive item'),
      ],
    ))).toEqual([])
  })

  Test('allows either Next status when mapped content matches', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [file('WordFlower.tao-next', `${open}\nview Main { }`)],
    ))).toEqual([])
  })

  Test('rejects absorbed Current and Next content divergence', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [file('WordFlower.tao-next', `${absorbed}\nview Main { render New() }`)],
    ))).toEqual(['Next is absorbed but WordFlower.tao differs from Current.'])
  })

  Test('rejects absorbed Current and Next mapped file-set divergence', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }`)],
      [
        file('WordFlower.tao-next', `${absorbed}\nview Main { }`),
        file('Shared.tao-next', 'let Shared = 1'),
      ],
    ))).toEqual(['Next is absorbed but Shared.tao is missing from Current.'])
  })

  Test('rejects an absorbed Current file missing from mapped Next', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [
        file('WordFlower.tao', `${absorbed}\nview Main { }`),
        file('Documents.tao', 'view Documents { }'),
      ],
      [file('WordFlower.tao-next', `${absorbed}\nview Main { }`)],
    ))).toEqual(['Next is absorbed but Documents.tao is missing from its mapped files.'])
  })

  Test('rejects absorbed mapped whitespace differences', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${absorbed}\nview Main { }\n`)],
      [file('WordFlower.tao-next', `${absorbed}\nview Main { } \n`)],
    ))).toEqual(['Next is absorbed but WordFlower.tao differs from Current.'])
  })

  Test('rejects absorbed mapped byte differences', () => {
    Expect(wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', absorbed, Buffer.from([...Buffer.from(absorbed), 0x80]))],
      [file('WordFlower.tao-next', absorbed, Buffer.from([...Buffer.from(absorbed), 0x81]))],
    ))).toEqual(['Next is absorbed but WordFlower.tao differs from Current.'])
  })

  Test('rejects hidden file divergence in an absorbed repository tranche', async () => {
    const root = await FS.mkTmpDir(FS.resolvePath('tao-repo-lint-', FS.tmpdir()))
    try {
      await FS.writeText(
        FS.resolvePath('Apps/WordFlower/1 - Current/WordFlower.tao', root),
        absorbed,
      )
      await FS.writeText(
        FS.resolvePath('Apps/WordFlower/2 - Next/WordFlower.tao-next', root),
        absorbed,
      )
      await FS.writeFile(
        FS.resolvePath('Apps/WordFlower/1 - Current/.contract.bin', root),
        Buffer.from([0x80]),
      )
      await FS.writeFile(
        FS.resolvePath('Apps/WordFlower/2 - Next/.contract.bin', root),
        Buffer.from([0x81]),
      )
      await FS.writeText(FS.resolvePath('Apps/Test Apps/README.md', root), '# Test Apps\n')
      await FS.mkdir(FS.resolvePath('packages', root))

      Expect(await repoLintIssues(root)).toEqual([
        'Apps/WordFlower/2 - Next is absorbed but .contract.bin differs from Apps/WordFlower/1 - Current.',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('requires Current to remain absorbed', () => {
    const issues = wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', `${open}\nview Main { }`)],
      [file('WordFlower.tao-next', `${open}\nview Main { render New() }`)],
    ))

    Expect(issues).toEqual(['Current must remain at tranche status absorbed.'])
  })

  Test('requires exactly one status header across each WordFlower directory', () => {
    const issues = wordFlowerDirectoryIssues(directory(
      [file('WordFlower.tao', 'view Main { }')],
      [
        file('WordFlower.tao-next', `${open}\nview Main { }`),
        file('WordFlower.test.tao-next', `${open}\ntest "Main" { }`),
      ],
    ))

    Expect(issues).toEqual([
      'Current must contain exactly one tranche status header across the directory.',
      'Next must contain exactly one tranche status header across the directory.',
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

function directory(currentFiles: readonly TestFile[], nextFiles: readonly TestFile[]) {
  return {
    currentFiles,
    currentPath: 'Current',
    nextFiles,
    nextPath: 'Next',
  }
}

type TestFile = {
  bytes?: Uint8Array
  path: string
  source: string
}

function file(path: string, source: string, bytes?: Uint8Array): TestFile {
  return { bytes, path, source }
}
