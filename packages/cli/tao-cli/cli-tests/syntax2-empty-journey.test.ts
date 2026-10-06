import { FS, Repo, Text } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runTaoCliForTest, withTaoFixture } from './test-cli-files'

const SYNTAX2_APP_ROOT = Repo.resolvePath('Apps/Syntax2')
const EMPTY_LIBRARY_JOURNEY = `use LibraryApp from ./Main

test "Syntax2 Library" {
   test "renders the header and an available empty collection" {
      run LibraryApp
      expect text "Ada Lovelace"
      expect text "No books."
      press "Group"
      expect text "No books."
   }
}
`

Describe('Syntax2 empty collection journey', () => {
  Test('runs the real library app and journey against an empty provider seed', async () => {
    const files = await syntax2FixtureFiles()

    await withTaoFixture(files, async rootDir => {
      const result = await runTaoCliForTest(['test', rootDir])
      const output = Text.stripAnsi(`${result.stdout}${result.stderr}`)

      Expect(output).toContain('Tao tests finished')
      Expect(result.exitCode).toBe(0)
      Expect(output).toMatch(/Tests:\s+1 passed, 1 total/)
    })
  })
})

async function syntax2FixtureFiles(): Promise<Record<string, string>> {
  const files: Record<string, string> = {
    '.tao/.gitkeep': '',
    'Library.test.tao': EMPTY_LIBRARY_JOURNEY,
    'tsconfig.json': await FS.readText(FS.resolvePath('tsconfig.json', SYNTAX2_APP_ROOT)),
  }
  for await (const sourcePath of FS.walk(SYNTAX2_APP_ROOT, { extensions: ['.tao', '.ts'] })) {
    const relativePath = FS.relativePath(SYNTAX2_APP_ROOT, sourcePath)
    if (relativePath.endsWith('.test.tao') || relativePath.endsWith('.future')) {
      continue
    }
    files[relativePath] = await FS.readText(sourcePath)
  }

  const providerPath = 'library/BookStoreProvider.ts'
  const provider = files[providerPath]
  Expect(provider).toBeDefined()
  const populatedSeed =
    /backend\.seedServer\(Array\.from\(\{ length: 83 \}, \(_, index\) => \(\{[\s\S]*?^\s{6}\}\)\)\)/gm
  const matches = [...provider!.matchAll(populatedSeed)]
  Expect(matches).toHaveLength(1)
  files[providerPath] = provider!.replace(matches[0]![0], 'backend.seedServer([])')
  return files
}
