import { HostDependencies } from '@expo-host'
import { FS } from '@shared'
import { Describe, Expect, fakeTerminal, mkTestDir, Test } from '@shared/test'

// The install here is a fake that records its calls; `just standalone-cli-acceptance` runs the real
// one through an installed binary.
Describe('HostDependencies', () => {
  Test('installs once, beside the embedded manifest and lockfile, and reuses the install after', async () => {
    await withHost(async host => {
      await HostDependencies.ensureIn(host, approved)
      await HostDependencies.ensureIn(host, approved)

      Expect(host.installs).toEqual([host.installRoot])
      Expect(await FS.readText(FS.resolvePath('bun.lock', host.installRoot))).toBe('lock one\n')
      Expect(await FS.isFile(FS.resolvePath('package.json', host.installRoot))).toBe(true)
    })
  })

  // A new release embeds a new lockfile, and must not run against the last release's packages.
  Test('installs again when the embedded lockfile changes', async () => {
    await withHost(async host => {
      await HostDependencies.ensureIn(host, approved)
      await FS.writeText(FS.resolvePath('bun.lock', host.hostFiles), 'lock two\n')

      await HostDependencies.ensureIn(host, approved)

      Expect(host.installs).toHaveLength(2)
      Expect(await FS.readText(FS.resolvePath('bun.lock', host.installRoot))).toBe('lock two\n')
    })
  })

  Test('refuses without a terminal or advance approval, and says how to give it', async () => {
    await withHost(async host => {
      await Expect(HostDependencies.ensureIn(host, { environment: {}, interactive: false }))
        .rejects.toThrow('TAO_HOST_INSTALL=yes')

      Expect(host.installs).toEqual([])
    })
  })

  Test('asks a terminal first, and a no installs nothing', async () => {
    await withHost(async host => {
      const terminal = fakeTerminal()
      terminal.input.write('n\n')

      await Expect(HostDependencies.ensureIn(host, { ...terminal, environment: {} }))
        .rejects.toThrow('download its Expo host once')

      Expect(terminal.outputText()).toContain('Download it now?')
      Expect(host.installs).toEqual([])
    })
  })

  Test('lets two first runs share one install', async () => {
    await withHost(async host => {
      await Promise.all([HostDependencies.ensureIn(host, approved), HostDependencies.ensureIn(host, approved)])

      Expect(host.installs).toHaveLength(1)
    })
  })
})

const approved = { environment: { [HostDependencies.CONSENT_ENV]: 'yes' }, interactive: false }

type FakeHost = {
  hostFiles: string
  install: (installRoot: string) => Promise<void>
  installRoot: string
  installs: string[]
}

async function withHost(run: (host: FakeHost) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-host-dependencies-')
  try {
    const hostFiles = FS.resolvePath('resources/host', root)
    await FS.writeText(FS.resolvePath('package.json', hostFiles), '{"name":"tao-expo-host"}\n')
    await FS.writeText(FS.resolvePath('bun.lock', hostFiles), 'lock one\n')
    const installs: string[] = []
    await run({
      hostFiles,
      installRoot: FS.resolvePath('host', root),
      installs,
      async install(installRoot) {
        installs.push(installRoot)
        await FS.mkdir(FS.resolvePath('node_modules', installRoot))
      },
    })
  } finally {
    await FS.remove(root)
  }
}
