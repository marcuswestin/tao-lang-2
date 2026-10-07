import { CLI, FS, Repo } from '@shared'
import { Describe, Expect, mkGitTestDir, Test } from '@shared/test'

const ENVIRONMENT = 'packages/cli/dev-cli/dev-cli-src/environment'
const STEP = `${ENVIRONMENT}/contributor-journey-step.sh`
const CHANGE_FILE = 'packages/compiler/compiler-src/codegen/react-native/app/FilesCompiler.ts'
const ANCHOR = 'const useTaoGeneratedAgentCommands = TR.Agent.useCommands'
const MARKER = 'contributor-journey-marker'

Describe('contributor journey actions', () => {
  Test('rejects an unknown action', async () => {
    await withFixture(async fixture => {
      Expect((await act(fixture, 'launch')).exitCode).toBe(2)
      Expect((await act(fixture, '')).exitCode).toBe(2)
    })
  })

  Test(
    'serves the page and bundle, and sees a compiler change only after the loop is stopped and started',
    async () => {
      await withFixture(async fixture => {
        Expect((await act(fixture, 'loop-start')).stdout).toContain('dev loop abc-123 ready at http://127.0.0.1:19999')
        const serve = await act(fixture, 'loop-serve')
        Expect(serve.exitCode).toBe(0)
        Expect(serve.stdout).toContain(`without ${MARKER}`)

        const change = await act(fixture, 'toolchain-change')
        Expect(change.exitCode).toBe(0)
        const source = await FS.readText(FS.resolvePath(CHANGE_FILE, fixture.root))
        Expect(source.split('\n').filter(line => line.includes(MARKER))).toHaveLength(1)
        Expect(source).toContain(ANCHOR)
        Expect(source.indexOf(MARKER)).toBeGreaterThan(source.indexOf(ANCHOR))

        // The running loop still serves the old toolchain, as the real one does.
        const stale = await act(fixture, 'loop-reflect')
        Expect(stale.exitCode).toBe(1)
        Expect(stale.stderr).toContain('does not serve the compiler change')

        const restart = await act(fixture, 'loop-restart')
        Expect(restart.exitCode).toBe(0)
        const reflect = await act(fixture, 'loop-reflect')
        Expect(reflect.exitCode).toBe(0)
        Expect(reflect.stdout).toContain('serves the compiler change (1 occurrence)')

        Expect((await act(fixture, 'loop-stop')).exitCode).toBe(0)
        const calls = (await FS.readText(fixture.log)).trim().split('\n')
        Expect(calls.filter(call => call.startsWith('dev-loop start '))).toEqual([
          'dev-loop start Apps/Starters/Notebook --app Notebook --json',
          'dev-loop start Apps/Starters/Notebook --app Notebook --json',
        ])
        Expect(calls.filter(call => call.startsWith('dev-loop stop '))).toEqual([
          'dev-loop stop --session abc-123 --json',
          'dev-loop stop --session abc-123 --json',
        ])
        // Stopping twice in a row is harmless: the second finds no session recorded.
        Expect((await act(fixture, 'loop-stop')).exitCode).toBe(0)
        Expect((await FS.readText(fixture.log)).trim().split('\n').filter(call => call.startsWith('dev-loop stop ')))
          .toHaveLength(2)
      })
    },
  )

  Test('fails when the untouched toolchain already serves the marker', async () => {
    await withFixture(async fixture => {
      await FS.writeText(FS.resolvePath('serves-marker', fixture.root), '')
      Expect((await act(fixture, 'loop-start')).exitCode).toBe(0)
      const serve = await act(fixture, 'loop-serve')
      Expect(serve.exitCode).toBe(1)
      Expect(serve.stderr).toContain('already serves')
    })
  })

  Test('refuses to change a compiler that moved or already carries the change', async () => {
    await withFixture(async fixture => {
      const path = FS.resolvePath(CHANGE_FILE, fixture.root)
      Expect((await act(fixture, 'toolchain-change')).exitCode).toBe(0)
      const again = await act(fixture, 'toolchain-change')
      Expect(again.exitCode).toBe(1)
      Expect(again.stderr).toContain('already carries the journey change')
      await FS.writeText(path, 'export const moved = true\n')
      const moved = await act(fixture, 'toolchain-change')
      Expect(moved.exitCode).toBe(1)
      Expect(moved.stderr).toContain('the compiler line to extend moved')
    })
  })

  Test('fails a dev loop that stops before it is ready or never reports a session', async () => {
    await withFixture(async fixture => {
      const failed = await act(fixture, 'loop-start', { FAKE_STATE: 'failed' })
      Expect(failed.exitCode).toBe(1)
      Expect(failed.stderr).toContain('stopped before it was ready')
      const silent = await act(fixture, 'loop-start', { FAKE_START_REPLY: '{}' })
      Expect(silent.exitCode).toBe(1)
      Expect(silent.stderr).toContain('reported no session')
    })
  })
})

type Fixture = { root: string; log: string; bin: string }

async function act(fixture: Fixture, action: string, extra: Record<string, string> = {}): Promise<CLI.CommandResult> {
  return await CLI.run('/bin/sh', {
    args: [FS.resolvePath(STEP, fixture.root), action],
    cwd: fixture.root,
    env: { PATH: `${fixture.bin}:/usr/bin:/bin`, FAKE_LOG: fixture.log, ...extra },
    processPolicy: 'test',
    timeoutMs: 60_000,
  })
}

/**
 * A scratch checkout holding the real action script, a compiler file with the anchor line, a recording `./dev`,
 * and a `curl` that serves the marker only from a loop started after the compiler file carried it.
 */
async function withFixture(test: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkGitTestDir('tao-contributor-journey-')
  try {
    const bin = FS.resolvePath('fake-bin', root)
    const log = FS.resolvePath('calls.log', root)
    await FS.writeText(FS.resolvePath(STEP, root), await FS.readText(Repo.resolvePath(STEP)))
    await FS.writeText(
      FS.resolvePath(CHANGE_FILE, root),
      `export const files = () => {\n      ${'`'}x${'`'}\n      ${ANCHOR}\n      other()\n}\n`,
    )
    const scripts: Record<string, string> = {
      [FS.resolvePath('dev', root)]: [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$FAKE_LOG"',
        'case "$2" in',
        '  start)',
        // The loop serves what the compiler file held when it started.
        `    if grep -q ${MARKER} ${CHANGE_FILE} || [ -f serves-marker ]; then : > served; else rm -f served; fi`,
        '    reply=${FAKE_START_REPLY-}',
        '    [ -n "$reply" ] || reply=\'{"session":"abc-123"}\'',
        '    printf "%s\\n" "$reply" ;;',
        '  status) printf \'{"state":"%s","url":"http://127.0.0.1:19999"}\\n\' "${FAKE_STATE:-ready}" ;;',
        '  stop) printf "{}\\n" ;;',
        'esac',
        '',
      ].join('\n'),
      [FS.resolvePath('curl', bin)]: [
        '#!/bin/sh',
        'for argument in "$@"; do url=$argument; done',
        'case "$url" in',
        '  */) printf \'<html><script src="/bundle.js"></script></html>\\n\' ;;',
        '  *) printf "bundle\\n"; ! [ -f served ] || printf "%s\\n" "const m = \\"' + MARKER + '\\""  ;;',
        'esac',
        '',
      ].join('\n'),
    }
    for (const [path, content] of Object.entries(scripts)) {
      await FS.writeText(path, content)
      await FS.chmod(path, 0o755)
    }
    await test({ root, log, bin })
  } finally {
    await FS.remove(root)
  }
}
