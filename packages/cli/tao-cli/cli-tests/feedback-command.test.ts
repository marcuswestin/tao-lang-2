import { CLI, FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { visitorFingerprint } from '../cli-src/feedback-command'

const SOURCE_CLI = FS.resolvePath('../cli-src/tao-cli.ts', import.meta.dir)
const RESOURCE_HASH = 'a'.repeat(64)

Describe('visitor feedback commands', () => {
  Test('rejects personal text from hostile host probes', () => {
    const output = visitorFingerprint({
      architecture: 'arm64 /Users/person',
      bunVersion: '1.4.2',
      kernelName: 'Darwin',
      kernelVersion: '25.0.0',
      nodeVersion: '/Users/person 22.1.0',
      osBuild: '25A100',
      osName: 'macOS',
      osVersion: '15.0',
      resourcesStamp: '/Users/person/' + RESOURCE_HASH,
      xcodeOutput: 'Xcode 26.0\nBuild version account@example.com',
    })
    const json = JSON.stringify(output)
    Expect(json).not.toContain('/Users/person')
    Expect(json).not.toContain('account@example.com')
    Expect(output.architecture).toBeUndefined()
    Expect(output.toolchain[2]?.hash).toBeUndefined()
    Expect(output.toolchain[0]?.version).toBe('1.4.2')
    Expect(output.toolchain[1]?.version).toBeUndefined()
    Expect(output.xcode?.version).toBe('26.0')
    Expect(output.xcode?.build).toBeUndefined()
  })

  Test('rejects single-word personal values even when they fit a generic token shape', () => {
    const output = visitorFingerprint({
      architecture: 'Alice',
      kernelName: 'Alice',
      kernelVersion: 'Alice',
      osBuild: 'Alice',
      osName: 'Alice',
      osVersion: 'Alice',
      xcodeOutput: 'Xcode Alice\nBuild version Alice',
    })
    Expect(JSON.stringify(output)).not.toContain('Alice')
    Expect(output.architecture).toBeUndefined()
    Expect(output.os.name).toBeUndefined()
  })

  Test('does not extract a version-shaped IP address from unexpected probe output', () => {
    const output = visitorFingerprint({
      bunVersion: 'bun 192.168.1.42',
      kernelVersion: 'host 192.168.1.42',
      nodeVersion: '192.168.1.42\nprivate host',
      osVersion: 'macOS 192.168.1.42',
      xcodeOutput: 'Xcode 192.168.1.42 extra\nBuild version 17A1234',
    })
    Expect(JSON.stringify(output)).not.toContain('192.168.1.42')
  })

  Test('prints a bundled-resource hash and feedback route outside any checkout', async () => {
    const root = await mkTestDir('tao-feedback-installed-', { location: 'host' })
    try {
      await FS.writeText(FS.resolvePath('.tao-resources', root), RESOURCE_HASH)
      const env = { ...Platform.runtimeProcess.env, TAO_RESOURCES: root }
      const doctor = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [SOURCE_CLI, 'doctor', '--fingerprint'],
        cwd: root,
        env,
      })
      Expect(doctor.exitCode).toBe(0)
      const fingerprint = JSON.parse(doctor.stdout)
      Expect(fingerprint.toolchain).toContainEqual({ name: 'tao-resources', present: true, hash: RESOURCE_HASH })
      Expect(fingerprint.tao.version).toBe('development')

      const bug = await CLI.run(Platform.runtimeProcess.execPath, {
        args: [SOURCE_CLI, 'bug-report'],
        cwd: root,
        env,
      })
      Expect(bug.exitCode).toBe(0)
      Expect(bug.stdout).toContain('What I was trying to build:')
      Expect(bug.stdout).toContain('template=could-not-build-it.yml')
      Expect(bug.stdout).toContain('template=this-confused-me.yml')
      Expect(bug.stdout).toContain(RESOURCE_HASH)
      Expect(bug.stdout).toContain('Nothing was sent automatically.')
    } finally {
      await FS.remove(root)
    }
  })
})
