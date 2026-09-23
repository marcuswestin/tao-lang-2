import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

// The binary here is a shell script standing in for Tao, so these cover the install script alone
// and run anywhere; `just standalone-cli-acceptance` installs a real build the same way.
const INSTALL_SCRIPT = Repo.resolvePath('packages/cli/tao-cli/cli-src/standalone-install.sh')
const STAND_IN = '#!/bin/sh\n[ "$1" = --version ] && echo 0.4.0\n'

Describe('standalone install script', () => {
  Test('installs the release under the Tao home and links it into a user bin directory on PATH', async () => {
    await withRelease(async ({ home, install }) => {
      const userBin = FS.resolvePath('.local/bin', home)
      await FS.mkdir(userBin)

      const result = await install({ PATH: `${userBin}:/usr/bin:/bin` })

      Expect(result.exitCode).toBe(0)
      const installed = FS.resolvePath('.local/share/tao/versions/0.4.0/tao', home)
      Expect(await FS.isFile(installed)).toBe(true)
      Expect(await FS.realPath(FS.resolvePath('tao', userBin))).toBe(await FS.realPath(installed))
      Expect(result.stdout).not.toContain('export PATH')
    })
  })

  Test('prints the PATH line when no user bin directory is on PATH', async () => {
    await withRelease(async ({ home, install }) => {
      const result = await install({ PATH: '/usr/bin:/bin' })

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain(`export PATH="${FS.resolvePath('.local/share/tao/bin', home)}:$PATH"`)
    })
  })

  // Someone else's `tao` on PATH is theirs; the installer falls back to printing the PATH line.
  Test('leaves another tao in a user bin directory alone', async () => {
    await withRelease(async ({ home, install }) => {
      const userBin = FS.resolvePath('bin', home)
      await FS.writeText(FS.resolvePath('tao', userBin), '#!/bin/sh\necho theirs\n')

      const result = await install({ PATH: `${userBin}:/usr/bin:/bin` })

      Expect(result.exitCode).toBe(0)
      Expect(await FS.readText(FS.resolvePath('tao', userBin))).toBe('#!/bin/sh\necho theirs\n')
      Expect(result.stdout).toContain('export PATH=')
    })
  })

  Test('refuses a download that does not match its published checksum', async () => {
    await withRelease(async ({ home, install, releases }) => {
      await FS.writeText(
        FS.resolvePath('latest/download/tao-darwin-arm64.gz.sha256', releases),
        `${'0'.repeat(64)}  x\n`,
      )

      const result = await install({ PATH: '/usr/bin:/bin' })

      Expect(result.exitCode).not.toBe(0)
      Expect(result.stderr).toContain('does not match its published checksum')
      Expect(await FS.exists(FS.resolvePath('.local/share/tao/versions/0.4.0', home))).toBe(false)
    })
  })

  Test('refuses a pinned version the download does not report', async () => {
    await withRelease(async ({ install, releases }) => {
      for (const name of ['tao-darwin-arm64.gz', 'tao-darwin-arm64.gz.sha256']) {
        await FS.copyFile(
          FS.resolvePath(`latest/download/${name}`, releases),
          FS.resolvePath(`download/v0.5.0/${name}`, releases),
        )
      }

      const result = await install({ PATH: '/usr/bin:/bin', TAO_VERSION: '0.5.0' })

      Expect(result.exitCode).not.toBe(0)
      Expect(result.stderr).toContain('asked for 0.5.0, but the download is 0.4.0')
    })
  })
})

type Release = {
  home: string
  releases: string
  install: (env: Record<string, string>) => Promise<CLI.CommandResult>
}

async function withRelease(run: (release: Release) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-standalone-install-')
  try {
    const releases = FS.resolvePath('releases', root)
    const asset = Bun.gzipSync(new TextEncoder().encode(STAND_IN))
    const download = FS.resolvePath('latest/download', releases)
    await FS.writeFile(FS.resolvePath('tao-darwin-arm64.gz', download), asset)
    await FS.writeText(
      FS.resolvePath('tao-darwin-arm64.gz.sha256', download),
      `${Platform.sha256Hex(asset)}  tao-darwin-arm64.gz\n`,
    )
    const home = FS.resolvePath('home', root)
    await FS.mkdir(home)
    await run({
      home,
      releases,
      install: env =>
        CLI.run('/bin/sh', {
          args: [INSTALL_SCRIPT],
          cwd: home,
          env: { HOME: home, TAO_RELEASES: `file://${releases}`, ...env },
        }),
    })
  } finally {
    await FS.remove(root)
  }
}
