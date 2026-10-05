import { Diagnostic, FS } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/source-commands'
import { checkedWorkspaces, TWO_WORKSPACES } from './helpers/check-cache-fixtures'
import { withTaoFixture } from './test-cli-files'

Describe('tao check cache replay', () => {
  // `tao check` reports errors, and its exit code rides on them, so a stamp that replayed one would
  // keep failing a run whose source the author may already have fixed. A workspace carrying an error
  // is never stamped; its neighbour, which carries none, still is.
  Test('never stamps a workspace with an error, and reports that error on every run', async () => {
    await withTaoFixture(
      { ...TWO_WORKSPACES, 'AppOne/Main.tao': 'view MainView() {\n   render Unknown()\n}\n' },
      async rootDir => {
        const cold = await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })
        const errors = cold.flatMap(result => (result.diagnostics ?? []).filter(Diagnostic.isError))

        Expect(errors.map(error => error.message)).toContain("No view named 'Unknown' is in scope.")
        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
        Expect(await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })).toEqual(cold)
      },
    )
  })

  Test('never stamps a workspace holding a file that does not parse', async () => {
    await withTaoFixture(
      {
        ...TWO_WORKSPACES,
        'AppOne/Main.tao': 'use Column, Text from @tao/ui\n\nview MainView() {\n   render Column(,) {\n   }\n}\n',
      },
      async rootDir => {
        const results = await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })
        Expect(results.some(result => result.status === 'error')).toBe(true)

        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
      },
    )
  })

  Test('never stamps a workspace holding a file that is not canonical', async () => {
    await withTaoFixture(
      {
        ...TWO_WORKSPACES,
        'AppOne/Main.tao': 'use Text from @tao/ui\n\nview   MainView() {\n   render Text("Hello")\n}\n',
      },
      async rootDir => {
        await checkedWorkspaces(rootDir)

        Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'checked', AppTwo: 'replayed' })
      },
    )
  })

  Test("replays a stamped workspace's warnings word for word", async () => {
    await withTaoFixture({
      ...TWO_WORKSPACES,
      'AppOne/Main.tao': 'use Placeholder from @tao/ui\n\nview MainView() {\n   render Placeholder("Main")\n}\n',
    }, async rootDir => {
      const cold = await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })
      const warm = await runCheck(rootDir, { cache: { repositoryRoot: rootDir } })

      Expect(cold.some(result => (result.diagnostics ?? []).some(Diagnostic.isWarning))).toBe(true)
      Expect(warm).toEqual(cold)
      Expect(await checkedWorkspaces(rootDir)).toEqual({ AppOne: 'replayed', AppTwo: 'replayed' })
    })
  })

  Test('stamps nothing for a workspace outside the stamp repository root', async () => {
    await withTaoFixture(TWO_WORKSPACES, async rootDir => {
      const boundary = FS.resolvePath('AppTwo', rootDir)
      await runCheck(FS.resolvePath('AppOne', rootDir), { cache: { repositoryRoot: boundary } })

      Expect(await FS.exists(FS.resolvePath('.artifacts/tao-check-stamp.json', boundary))).toBe(false)
    })
  })
})
