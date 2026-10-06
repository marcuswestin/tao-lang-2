import { CLI, Errors, FS, HCI, Platform, ReleaseCapabilities } from '@shared'
import { Describe, Expect, MockModule, Test, testOverrideSlot, withCapturedOutput } from '@shared/test'

Describe('Public release preparation', () => {
  Test('rejects development profiles before invoking packaging or account commands', async () => {
    const { ReleaseWorkflow } = await import('../dev-cli-src/release/ReleaseWorkflow')
    await Expect(ReleaseWorkflow.prepareIde('development')).rejects.toThrow(
      'Public releases require a numbered release phase.',
    )
    await Expect(ReleaseWorkflow.prepareStudio('invalid', 'invalid', 'development')).rejects.toThrow(
      'Public releases require a numbered release phase.',
    )
    await Expect(ReleaseWorkflow.prepareStudio('invalid', 'invalid', 1)).rejects.toThrow(
      'Studio is unavailable in Tao release phase 1.',
    )
  })

  Test('explains repository and login prerequisites before checking GitHub authentication', async () => {
    const calls: string[] = []
    const captured = await withCapturedOutput(async () => {
      const restore = commandSlot.install(async (command, spec = {}) => {
        calls.push(`${command} ${(spec.args ?? []).join(' ')}`)
        HCI.writeLine('AUTH CHECK STARTED')
        return { command, args: [...spec.args ?? []], exitCode: 1, signal: null, stdout: '', stderr: 'Not logged in' }
      })
      try {
        const { ReleaseWorkflow } = await import('../dev-cli-src/release/ReleaseWorkflow')
        await Expect(ReleaseWorkflow.prepareStudio('example/releases', '0.0.1')).rejects.toThrow('Not logged in')
      } finally {
        restore()
      }
    })
    Expect(captured.stdout).toContain('https://github.com/example/releases')
    Expect(captured.stdout).toContain('two URL segments after github.com are owner/name (example/releases)')
    Expect(captured.stdout).toContain('repository write access')
    Expect(captured.stdout).toContain('https://cli.github.com')
    Expect(captured.stdout).toContain('gh auth login --hostname github.com')
    Expect(captured.stdout.indexOf('GitHub prerequisite:')).toBeLessThan(
      captured.stdout.indexOf('AUTH CHECK STARTED'),
    )
    Expect(calls).toEqual(['gh auth status'])
  })

  Test('keeps the public repository check after successful GitHub authentication', async () => {
    const calls: string[] = []
    await withCapturedOutput(async () => {
      const restore = commandSlot.install(async (command, spec = {}) => {
        const args = [...spec.args ?? []]
        calls.push(`${command} ${args.join(' ')}`)
        return {
          command,
          args,
          exitCode: 0,
          signal: null,
          stdout: args[0] === 'repo' ? '{"visibility":"PRIVATE"}' : '',
          stderr: '',
        }
      })
      try {
        const { ReleaseWorkflow } = await import('../dev-cli-src/release/ReleaseWorkflow')
        await Expect(ReleaseWorkflow.prepareStudio('example/releases', '0.0.1')).rejects.toThrow(
          'example/releases must be public for unauthenticated Studio updates.',
        )
        Expect(calls).toEqual(['gh auth status', 'gh repo view example/releases --json visibility'])
      } finally {
        restore()
      }
    })
  })

  Test('missing Marketplace token explains account, publisher, token scope and local variable', async () => {
    await withCapturedOutput(async () => {
      const fixture = idePublicationFixture()
      try {
        const diagnostic = await publicationDiagnostic('marketplace')
        Expect(diagnostic).toContain('https://dev.azure.com/')
        Expect(diagnostic).toContain('Microsoft account')
        Expect(diagnostic).toContain('https://marketplace.visualstudio.com/manage')
        Expect(diagnostic).toContain("Reuse publisher 'example'")
        Expect(diagnostic).toContain('User settings > Personal access tokens > New Token')
        Expect(diagnostic).toContain('All accessible organizations')
        Expect(diagnostic).toContain('Marketplace > Manage')
        Expect(diagnostic).toContain(
          'https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token',
        )
        Expect(diagnostic).toContain('local VSCE_PAT environment variable')
        Expect(fixture.calls.some(call => call.command === 'bunx')).toBe(false)
      } finally {
        fixture.restore()
      }
    })
  })

  Test('missing Open VSX token explains agreement, namespace access and token acquisition', async () => {
    await withCapturedOutput(async () => {
      const fixture = idePublicationFixture()
      try {
        const diagnostic = await publicationDiagnostic('open-vsx')
        Expect(diagnostic).toContain('https://open-vsx.org with GitHub')
        Expect(diagnostic).toContain('https://accounts.eclipse.org/ with the same GitHub username')
        Expect(diagnostic).toContain('https://open-vsx.org/user-settings/profile')
        Expect(diagnostic).toContain('Publisher Agreement')
        Expect(diagnostic).toContain("Reuse namespace 'example' with Owner or Contributor access")
        Expect(diagnostic).toContain('https://open-vsx.org/user-settings/tokens')
        Expect(diagnostic).toContain('avatar > Settings > Access Tokens')
        Expect(diagnostic).toContain('Generate New Token')
        Expect(diagnostic).toContain('no selectable scopes')
        Expect(diagnostic).toContain('local OVSX_PAT environment variable')
        Expect(fixture.calls.some(call => call.command === 'bunx')).toBe(false)
      } finally {
        fixture.restore()
      }
    })
  })
})

const originalCLI = { ...CLI }
const originalFS = { ...FS }
const commandSlot = testOverrideSlot({
  read: () => CLI.run,
  write: value =>
    MockModule(
      new URL('../../../shared/shared-src/CLI.ts', import.meta.url).pathname,
      () => ({ ...originalCLI, run: value }),
    ),
})
const filesSlot = testOverrideSlot({
  read: () => ({ isFile: FS.isFile, readJson: FS.readJson }),
  write: value =>
    MockModule(
      new URL('../../../shared/shared-src/FS.ts', import.meta.url).pathname,
      () => ({ ...originalFS, ...value }),
    ),
  equals: (left, right) => left.isFile === right.isFile && left.readJson === right.readJson,
})
const envSlot = testOverrideSlot({
  read: () => Platform.runtimeProcess.env,
  write: value => {
    Platform.runtimeProcess.env = value
  },
})

function idePublicationFixture() {
  const commit = 'fixture-commit'
  const hash = 'a'.repeat(64)
  const identity = { name: 'extension', publisher: 'example', version: '0.0.1' }
  const calls: { command: string; args: string[] }[] = []
  const readJson: typeof FS.readJson = async <T>(path: string): Promise<T> => {
    Expect(path.endsWith('tao-ide-extension.release.json') || path.endsWith('ide-extension/package.json')).toBe(true)
    return (path.endsWith('tao-ide-extension.release.json')
      ? {
        ...identity,
        commit,
        sha256: hash,
        releasePhase: 1,
        releaseFingerprint: ReleaseCapabilities.fingerprint(ReleaseCapabilities.profile(1)),
      }
      : identity) as T
  }
  const restores = [
    envSlot.install({}),
    filesSlot.install({ isFile: async path => path.endsWith('tao-ide-extension.release.json'), readJson }),
    commandSlot.install(async (command, spec = {}) => {
      const args = [...spec.args ?? []]
      calls.push({ command, args })
      Expect(['git', 'shasum', 'bunx']).toContain(command)
      let stdout = ''
      if (args[0] === 'rev-parse') {
        stdout = commit
      }
      if (args[0] === 'ls-remote') {
        stdout = `${commit}\trefs/heads/main`
      }
      if (command === 'shasum') {
        stdout = `${hash}  fixture.vsix`
      }
      return { command, args, exitCode: 0, signal: null, stdout, stderr: '' }
    }),
  ]
  return {
    calls,
    restore: () => {
      for (const restore of restores.reverse()) {
        restore()
      }
    },
  }
}

async function publicationDiagnostic(target: 'marketplace' | 'open-vsx'): Promise<string> {
  try {
    const { ReleaseWorkflow } = await import('../dev-cli-src/release/ReleaseWorkflow')
    await ReleaseWorkflow.publishIde(target)
  } catch (error) {
    return Errors.formatForUser(error)
  }
  return 'Publication unexpectedly succeeded'
}
