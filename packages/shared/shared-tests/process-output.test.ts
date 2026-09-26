import { CLI, FS, Platform } from '@shared'
import { Describe, Expect, Test, until } from '@shared/test'

Describe('process output ownership', () => {
  Test('preserves both pipes when a fast child exits before consumers attach', async () => {
    const child = Platform.spawn('/bin/sh', {
      args: ['-c', "printf 'early stdout'; printf 'early stderr' >&2"],
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    try {
      await until(() => child.exitCode !== null, { description: 'child exit before attaching output consumers' })
      child.stdout?.on('data', chunk => stdout.push(Buffer.from(chunk)))
      child.stderr?.on('data', chunk => stderr.push(Buffer.from(chunk)))
      const code = await new Promise<number | null>(resolve => {
        Platform.onChildProcessClose(child, exitCode => resolve(exitCode))
      })
      Expect(code).toBe(0)
      Expect(Buffer.concat(stdout).toString()).toBe('early stdout')
      Expect(Buffer.concat(stderr).toString()).toBe('early stderr')
    } finally {
      child.stdout?.destroy()
      child.stderr?.destroy()
      child.kill('SIGKILL')
    }
  })

  Test('delivers a large binary stdin and drains both output tails', async () => {
    const input = Buffer.alloc(512 * 1024)
    for (let index = 0; index < input.length; index++) {
      input[index] = index % 256
    }
    const result = await CLI.run(Platform.runtimeProcess.execPath, {
      args: [
        '-e',
        "const input = await Bun.stdin.arrayBuffer(); process.stdout.write(Buffer.from(input).toString('base64')); process.stderr.write('tail');",
      ],
      stdin: input,
    })
    Expect(result.exitCode).toBe(0)
    Expect(result.stdout).toBe(input.toString('base64'))
    Expect(result.stderr).toBe('tail')
  })

  Test('reports a missing executable without losing the spawn error', async () => {
    const result = await CLI.run('/definitely-missing-tao-output-fixture')
    Expect(result.exitCode).not.toBe(0)
    Expect((result.error as NodeJS.ErrnoException).code).toBe('ENOENT')
    Expect(result.stdout).toBe('')
    Expect(result.stderr).toBe('')
  })

  Test('preserves signal termination and completes ignored output', async () => {
    const result = await CLI.run('/bin/sh', {
      args: ['-c', 'kill -TERM $$'],
      stdio: 'ignore',
    })
    Expect(result.exitCode).toBe(null)
    Expect(result.signal).toBe('SIGTERM')
    Expect(result.stdout).toBe('')
  })

  Test('preserves the caller environment and working directory', async () => {
    const result = await CLI.run('/bin/sh', {
      args: ['-c', 'printf "%s\\n%s" "$TAO_OUTPUT_FIXTURE" "$PWD"'],
      cwd: import.meta.dir,
      env: { TAO_OUTPUT_FIXTURE: 'output environment' },
    })
    Expect(result.exitCode).toBe(0)
    Expect(result.stdout).toBe(`output environment\n${import.meta.dir}`)
  })

  Test('an unreferenced child with ignored pipes does not hold its parent open', async () => {
    const result = await CLI.run(Platform.runtimeProcess.execPath, {
      args: [FS.resolvePath('fixtures/unreferenced-child.ts', import.meta.dir)],
      processPolicy: 'test',
      timeoutMs: 30_000,
    })
    const pid = Number(result.stdout.trim())
    try {
      Expect(result.exitCode).toBe(0)
      Expect(result.signal).toBe(null)
      Expect(Number.isInteger(pid) && pid > 0).toBe(true)
      Expect(Platform.processIsAlive(pid)).toBe(true)
    } finally {
      if (Number.isInteger(pid) && pid > 0) {
        Platform.spawnSync('/bin/kill', { args: ['-KILL', String(pid)], stdio: 'ignore' })
      }
    }
  })

  Test('inherits environment changes made after startup with and without command overrides', async () => {
    const result = await CLI.run(Platform.runtimeProcess.execPath, {
      args: [FS.resolvePath('fixtures/spawn-environment.ts', import.meta.dir)],
    })
    Expect(result.exitCode).toBe(0)
    Expect(JSON.parse(result.stdout)).toEqual(['set after startup', 'set after startup:per command'])
  })
})
