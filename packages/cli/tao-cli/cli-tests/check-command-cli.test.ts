import { FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { checkedProjectFile, checkedView, runTaoCliForTest, withTaoFixture } from './test-cli-files'

Describe('tao check CLI', () => {
  Test('exits zero when files are canonical', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'canonical.tao': checkedView('MainView'),
    }, async (rootDir) => {
      const result = await runTaoCliForTest(['check', rootDir])

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('0 noncanonical, 2 unchanged')
    })
  })

  Test('reports an imported file error when checking only its entry file', async () => {
    await withTaoFixture({
      'App.tao':
        'use Bad from @ui\n\nproject {\n   id "tao-cli-test"\n   name "Tao CLI test"\n}\n\nview Main() {\n   render Bad()\n}\n',
      '@ui/Bad.tao': 'public view Bad() {\n   render NoSuchView()\n}\n',
    }, async rootDir => {
      const result = await runTaoCliForTest(['check', FS.resolvePath('App.tao', rootDir)])

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain("@ui/Bad.tao:2:11 error: No view named 'NoSuchView' is in scope.")
      Expect(result.stderr).toContain('0 noncanonical, 1 unchanged, 1 error')
    })
  })

  Test('prints validator warnings without turning them into check failures', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'App.tao': 'use Placeholder from @tao/ui\n\nview Main() {\n   render Placeholder("Main")\n}\n',
    }, async rootDir => {
      const result = await runTaoCliForTest(['check', rootDir])

      Expect(result.exitCode).toBe(0)
      Expect(result.stderr).toContain('Placeholder ships as an empty box in release.')
      Expect(result.stdout).toContain('0 noncanonical, 2 unchanged, 1 warning')
    })
  })

  Test('exits nonzero and reports noncanonical files', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'drift.tao': checkedView('MainView').replace('view ', 'view   '),
    }, async (rootDir) => {
      const result = await runTaoCliForTest(['check', rootDir])

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('Needs fixes')
      Expect(result.stderr).toContain('1 noncanonical, 1 unchanged')
    })
  })

  // This is the mistake a newcomer makes first, and it used to produce no output and exit zero.
  Test('reports an unresolved view with its file, line, column, and source line, and exits nonzero', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'App.tao': 'view Main() {\n   render NoSuchView()\n}\n',
    }, async rootDir => {
      const result = await runTaoCliForTest(['check', rootDir])

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain("App.tao:2:11 error: No view named 'NoSuchView' is in scope.")
      Expect(result.stderr).toContain('2 |    render NoSuchView()')
      Expect(result.stderr).toContain('  |           ^^^^^^^^^^')
      Expect(result.stdout).not.toContain('error')
    })
  })

  // The previous output was the source-fix assertion's `Expected: …` text, with no position at all.
  Test('reports a syntax error as a positioned parser diagnostic rather than an assertion message', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'broken.tao': 'view Broken() {\n   render Text(\n}\n',
    }, async (rootDir) => {
      const result = await runTaoCliForTest(['check', rootDir])

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('broken.tao:3:1 error:')
      Expect(result.stderr).not.toContain('Expected: Tao source without syntax errors')
      Expect(result.stderr).not.toContain('Failed to check')
      Expect(result.stderr).toContain('0 noncanonical, 1 unchanged, 1 error')
    })
  })

  Test('counts errors and warnings separately in the summary', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'App.tao':
        'use Placeholder from @tao/ui\n\nview Main() {\n   render Placeholder("Main")\n}\n\nview Other() {\n   render NoSuchView()\n}\n',
    }, async rootDir => {
      const result = await runTaoCliForTest(['check', rootDir])

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('0 noncanonical, 2 unchanged, 1 error, 1 warning')
    })
  })

  // Project identity is a validator error like any other, and `check` is where a person meets it
  // before `tao compile` or `tao test` refuses the same source.
  Test('reports missing project identity with the command that fixes it', async () => {
    await withTaoFixture({
      'App.tao': checkedView('Main'),
    }, async rootDir => {
      const result = await runTaoCliForTest(['check', rootDir])

      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain("Run 'tao project id <id> [path]'")
      Expect(result.stderr).toContain('App.tao:1:1 error:')
    })
  })

  Test('shows an outside diagnostic path absolutely rather than as parent traversal', async () => {
    await withTaoFixture({
      ...checkedProjectFile,
      'App.tao': 'view Main() {\n   render NoSuchView()\n}\n',
    }, async rootDir => {
      const cwd = await mkTestDir('tao-cli-shallow-cwd-')
      const previousCwd = Platform.runtimeProcess.cwd()
      try {
        Platform.runtimeProcess.chdir(cwd)
        const result = await runTaoCliForTest(['check', rootDir])

        Expect(result.stderr).toContain(`${rootDir}/App.tao:2:11`)
        // Before the fix, this shallow sibling path rendered as `../${FS.basename(rootDir)}/App.tao`.
        Expect(result.stderr).not.toContain('../')
      } finally {
        Platform.runtimeProcess.chdir(previousCwd)
        await FS.remove(cwd)
      }
    })
  })
})
