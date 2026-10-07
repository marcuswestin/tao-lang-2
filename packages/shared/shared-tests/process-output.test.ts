import { CLI, Errors, FS, Platform, ProcessTree, type TrackedProcess } from '@shared'
import { Describe, Expect, Test, until } from '@shared/test'

Describe('process output ownership', () => {
  Test('joins an explicitly owned auxiliary pipe while preserving unknown-descriptor native close', async () => {
    const child = Platform.spawn('/bin/sh', {
      args: ['-c', 'IFS= read -r admission <&3; exec 3<&-; exit 0'],
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    })
    const pipe = child.stdio[3]
    if (pipe === undefined || pipe === null || !('write' in pipe)) {
      return Errors.throwUnexpected('Expected an owned test control pipe.')
    }
    const emit = child.emit.bind(child)
    child.emit = (event, ...args) => event === 'close' ? false : emit(event, ...args)
    let unknownClosed = false
    const releaseUnknown = Platform.onChildProcessClose(child, () => {
      unknownClosed = true
    })
    let releaseOwned = () => {}
    const ownedClosed = new Promise<number | null>(resolve => {
      releaseOwned = Platform.onChildProcessClose(child, code => resolve(code), [pipe])
    })
    try {
      if ('resume' in pipe && typeof pipe.resume === 'function') {
        pipe.resume()
      }
      pipe.write('admitted\n')
      pipe.end()
      Expect(await ownedClosed).toBe(0)
      Expect(pipe.closed).toBe(true)
      Expect(unknownClosed).toBe(false)
      emit('close', 0, null)
      Expect(unknownClosed).toBe(true)
    } finally {
      releaseOwned()
      releaseUnknown()
      pipe.destroy()
      child.kill('SIGKILL')
    }
  })

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

  Test('handles a closed stdin pipe without crashing the parent', async () => {
    const result = await CLI.run('/bin/sh', {
      args: ['-c', "exec 0<&-; sleep 0.1; printf 'closed'"],
      stdin: Buffer.alloc(8 * 1024 * 1024),
    })
    Expect(result.exitCode).toBe(0)
    Expect(result.stdout).toBe('closed')
    Expect(result.error === undefined || (result.error as NodeJS.ErrnoException).code === 'EPIPE').toBe(true)
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

  Test('reports and stops an unreferenced test descendant even when its pipes are ignored', async () => {
    const result = await CLI.run(Platform.runtimeProcess.execPath, {
      args: [FS.resolvePath('fixtures/unreferenced-child.ts', import.meta.dir)],
      detached: true,
      processPolicy: 'test',
      timeoutMs: 30_000,
    })
    const owned = JSON.parse(result.stdout.trim()) as TrackedProcess
    const pid = owned.pid
    try {
      Expect(result.exitCode).toBe(1)
      Expect(result.signal).toBe(null)
      Expect(Number.isInteger(pid) && pid > 0).toBe(true)
      Expect(result.stderr).toContain('Child exited 0 with owned processes still running')
      Expect(result.stderr).toContain('stopping them before returning')
      Expect(ProcessTree.sameProcess(ProcessTree.identities([pid]).get(pid), owned)).toBe(false)
    } finally {
      ProcessTree.signalTracked([owned], 'SIGKILL')
      await ProcessTree.waitForTrackedExit([owned])
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
