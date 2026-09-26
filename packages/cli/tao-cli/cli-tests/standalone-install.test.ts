import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

// The binary here is a shell script standing in for Tao, so these cover the install script alone
// and run anywhere; `just standalone-cli-acceptance` installs a real build the same way.
const INSTALL_SCRIPT = Repo.resolvePath('packages/cli/tao-cli/cli-src/standalone-install.sh')
// It answers only when asked the way the installer must ask, from `/` and naming no version, because a
// real release asked from inside a pinned project would hand the question to the release pinned there.
const STAND_IN = '#!/bin/sh\n[ "$1" = --version ] && [ "$(pwd)" = / ] && [ -z "${TAO_VERSION:-}" ] && echo 0.4.0\n'

Describe('standalone install script', () => {
  Test('installs and links the release inside the Tao home only', async () => {
    await withRelease(async ({ home, install }) => {
      const userBin = FS.resolvePath('.tao/bin', home)
      await FS.mkdir(userBin)

      const result = await install({ PATH: `${userBin}:/usr/bin:/bin` })

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('Downloading Tao 0.4.0')
      const installed = FS.resolvePath('.tao/versions/0.4.0/tao', home)
      Expect(await FS.isFile(installed)).toBe(true)
      Expect(await FS.isSymbolicLink(installed)).toBe(false)
      Expect(await FS.isSymbolicLink(FS.resolvePath('tao', userBin))).toBe(true)
      Expect(await FS.realPath(FS.resolvePath('tao', userBin))).toBe(await FS.realPath(installed))
      Expect(result.stdout).not.toContain('export PATH')
      Expect(await FS.exists(FS.resolvePath('.local', home))).toBe(false)
    })
  })

  Test('prints the PATH line when no user bin directory is on PATH', async () => {
    await withRelease(async ({ home, install }) => {
      const result = await install({ PATH: '/usr/bin:/bin' })

      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain(`export PATH="${FS.resolvePath('.tao/bin', home)}:$PATH"`)
    })
  })

  Test('links through the first writable user-owned directory already on PATH', async () => {
    await withRelease(async ({ home, install }) => {
      const userBin = FS.resolvePath('bin', home)
      await FS.mkdir(userBin)

      const result = await install({ PATH: `${userBin}:/usr/bin:/bin` })

      Expect(result.exitCode).toBe(0)
      Expect(await FS.isSymbolicLink(FS.resolvePath('tao', userBin))).toBe(true)
      Expect(await FS.realPath(FS.resolvePath('tao', userBin)))
        .toBe(await FS.realPath(FS.resolvePath('.tao/versions/0.4.0/tao', home)))
      Expect(await FS.isSymbolicLink(FS.resolvePath('.tao/bin/tao', home))).toBe(true)
      Expect(result.stdout).toContain(`Linked tao in ${userBin}`)
      Expect(result.stdout).not.toContain('export PATH')
    })
  })

  Test('rejects relative TAO_HOME before creating an installation', async () => {
    await withRelease(async ({ home, install }) => {
      const result = await install({ PATH: '/usr/bin:/bin', TAO_HOME: 'relative-home' })

      Expect(result.exitCode).not.toBe(0)
      Expect(result.stderr).toContain('TAO_HOME must be an absolute path')
      Expect(await FS.exists(FS.resolvePath('relative-home', home))).toBe(false)
    })
  })

  Test('ignores XDG_DATA_HOME and installs under the single default home', async () => {
    await withRelease(async ({ home, install }) => {
      const result = await install({ PATH: '/usr/bin:/bin', XDG_DATA_HOME: '/other-data' })

      Expect(result.exitCode).toBe(0)
      Expect(await FS.isFile(FS.resolvePath('.tao/versions/0.4.0/tao', home))).toBe(true)
      Expect(await FS.exists(FS.resolvePath('.local', home))).toBe(false)
    })
  })

  Test('installs into an absolute declared home', async () => {
    await withRelease(async ({ home, install }) => {
      const declared = FS.resolvePath('chosen-home', home)
      const result = await install({ PATH: '/usr/bin:/bin', TAO_HOME: declared, XDG_DATA_HOME: 'ignored-relative' })

      Expect(result.exitCode).toBe(0)
      Expect(await FS.isFile(FS.resolvePath('versions/0.4.0/tao', declared))).toBe(true)
      Expect(await FS.exists(FS.resolvePath('.tao', home))).toBe(false)
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
        FS.resolvePath('download/v0.4.0/tao-darwin-arm64.gz.sha256', releases),
        `${'0'.repeat(64)}  x\n`,
      )

      const result = await install({ PATH: '/usr/bin:/bin' })

      Expect(result.exitCode).not.toBe(0)
      Expect(result.stderr).toContain('does not match its published checksum')
      Expect(await FS.exists(FS.resolvePath('.tao/versions/0.4.0', home))).toBe(false)
    })
  })

  Test('refuses a pinned version the download does not report', async () => {
    await withRelease(async ({ install, releases }) => {
      for (const name of ['tao-darwin-arm64.gz', 'tao-darwin-arm64.gz.sha256']) {
        await FS.copyFile(
          FS.resolvePath(`download/v0.4.0/${name}`, releases),
          FS.resolvePath(`download/v0.5.0/${name}`, releases),
        )
      }

      const result = await install({ PATH: '/usr/bin:/bin', TAO_VERSION: '0.5.0' })

      Expect(result.exitCode).not.toBe(0)
      Expect(result.stderr).toContain('asked for 0.5.0, but the download is 0.4.0')
    })
  })

  Test('a pinned version does not need a release listing', async () => {
    await withRelease(async ({ install, listing }) => {
      await FS.remove(listing)
      const result = await install({ PATH: '/usr/bin:/bin', TAO_VERSION: '0.4.0' })

      Expect(result.exitCode).toBe(0)
    })
  })

  Test('asks the download its version from outside the current project, naming none', async () => {
    await withRelease(async ({ install }) => {
      const result = await install({ PATH: '/usr/bin:/bin', TAO_VERSION: '0.4.0' })

      Expect(result.stderr).toBe('')
      Expect(result.exitCode).toBe(0)
    })
  })

  Test('rejects a version that could alter the download path', async () => {
    await withRelease(async ({ install }) => {
      const result = await install({ PATH: '/usr/bin:/bin', TAO_VERSION: '../studio' })

      Expect(result.exitCode).not.toBe(0)
      Expect(result.stderr).toContain('TAO_VERSION must be a stable three-part version')
    })
  })
})

type Release = {
  home: string
  releases: string
  listing: string
  install: (env: Record<string, string>) => Promise<CLI.CommandResult>
}

async function withRelease(run: (release: Release) => Promise<void>): Promise<void> {
  const root = await mkTestDir('tao-standalone-install-')
  try {
    const releases = FS.resolvePath('releases', root)
    const asset = Bun.gzipSync(new TextEncoder().encode(STAND_IN))
    const download = FS.resolvePath('download/v0.4.0', releases)
    await FS.writeFile(FS.resolvePath('tao-darwin-arm64.gz', download), asset)
    await FS.writeText(
      FS.resolvePath('tao-darwin-arm64.gz.sha256', download),
      `${Platform.sha256Hex(asset)}  tao-darwin-arm64.gz\n`,
    )
    const listing = FS.resolvePath('releases.json', root)
    await FS.writeJson(listing, [
      { tag_name: 'studio-v0.4.1', draft: false, prerelease: false },
      { tag_name: 'v0.3.0', draft: false, prerelease: false },
      { tag_name: 'v0.5.0', draft: true, prerelease: false },
      { tag_name: 'v0.6.0', draft: false, prerelease: true },
      { tag_name: 'v0.4.0', draft: false, prerelease: false },
    ])
    const home = FS.resolvePath('home', root)
    await FS.mkdir(home)
    await run({
      home,
      releases,
      listing,
      install: env =>
        CLI.run('/bin/sh', {
          args: [INSTALL_SCRIPT],
          cwd: home,
          env: {
            HOME: home,
            TAO_HOME: '',
            TAO_RELEASES: `file://${releases}`,
            TAO_RELEASE_INDEX_URL: `file://${listing}`,
            ...env,
          },
        }),
    })
  } finally {
    await FS.remove(root)
  }
}
