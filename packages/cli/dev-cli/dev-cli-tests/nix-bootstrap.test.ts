import { Assert, CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

const SCRIPT = 'packages/cli/dev-cli/dev-cli-src/environment/nix-bootstrap.sh'
const CHECKSUMS = {
  x86_64: '0c3960a9792331a22081c3c7a5d8465db9b17c50b3acdf18587fa4c6f2cb1158',
  aarch64: '4d0302a2910f5eec1c33b8deef634f04899a75737e7001ec49908d003ae5efda',
}

type Fixture = {
  root: string
  bin: string
  script: string
  calls: string
  archiveName: string
  env: Platform.ProcessEnv
}

async function executable(path: string, body: string): Promise<void> {
  await FS.writeText(path, `#!/bin/sh\nset -eu\n${body}\n`)
  await FS.chmod(path, 0o755)
}

async function withFixture(
  run: (fixture: Fixture) => Promise<void>,
  architecture: keyof typeof CHECKSUMS = 'x86_64',
): Promise<void> {
  const root = await mkTestDir('nix-bootstrap-')
  try {
    const bin = FS.resolvePath('bin', root)
    const script = FS.resolvePath(SCRIPT, root)
    const calls = FS.resolvePath('calls', root)
    const archiveName = `nix-2.35.2-${architecture}-linux`
    const archive = FS.resolvePath(`${archiveName}.tar.xz`, root)
    const home = FS.resolvePath('home', root)
    await FS.mkdir(home)
    for (const tool of ['cp', 'mkdir', 'mktemp', 'mv', 'readlink', 'rm', 'sha256sum', 'tar', 'xz']) {
      const resolved = await CLI.commandPath(tool)
      Assert.defined(resolved, `fixture executable ${tool} is available`)
      await FS.symlink(resolved, FS.resolvePath(tool, bin))
    }
    await executable(
      FS.resolvePath('uname', bin),
      'case "$1" in -s) echo "${TAO_TEST_OS:-Linux}" ;; -m) echo "${TAO_TEST_ARCH:-x86_64}" ;; esac',
    )
    await executable(FS.resolvePath('id', bin), 'echo "${TAO_TEST_UID:-0}"')
    // The real kernel lock is exercised by the Linux guest; this fixture also runs on macOS.
    await executable(
      FS.resolvePath('flock', bin),
      `
[ "$1" = -w ] && [ "$2" = 600 ] && [ "$3" = 9 ]
if [ "\${TAO_TEST_LOCK_FAIL:-}" = yes ]; then exit 1; fi
if [ "\${TAO_TEST_INSTALL_WHILE_WAITING:-}" = yes ]; then
  mkdir -p "$HOME/.nix-profile/bin"
  printf '#!/bin/sh\\nexit 0\\n' > "$HOME/.nix-profile/bin/nix-build"
  "$TAO_TEST_CHMOD" +x "$HOME/.nix-profile/bin/nix-build"
fi`,
    )
    await executable(
      FS.resolvePath('curl', bin),
      `
printf 'download\\n' >> "$TAO_TEST_CALLS"
[ "$1" = --fail ] && [ "$2" = --location ]
[ "$3" = --proto ] && [ "$4" = '=https' ]
[ "$5" = --proto-redir ] && [ "$6" = '=https' ]
[ "$7" = --output ]
[ "$9" = 'https://releases.nixos.org/nix/nix-2.35.2/${archiveName}.tar.xz' ]
if [ "\${TAO_TEST_DOWNLOAD_FAIL:-}" = yes ]; then
  printf partial > "$8"
  exit 22
fi
cp "$TAO_TEST_ARCHIVE" "$8"`,
    )
    await executable(
      FS.resolvePath(`payload/${archiveName}/install`, root),
      `
printf 'install %s\\n' "$*" >> "$TAO_TEST_CALLS"
printf '%s\\n' "\${NIX_CONFIG:-}" > "$TAO_TEST_INSTALL_CONFIG"
mkdir -p "$TAO_TEST_STORE"
printf 'installer-owned state' > "$TAO_TEST_STORE/partial"
if [ "\${TAO_TEST_INSTALL_FAIL:-}" = yes ]; then exit 23; fi
if [ "\${TAO_TEST_INSTALL_EMPTY:-}" = yes ]; then exit 0; fi
mkdir -p "$HOME/.nix-profile/bin"
printf '#!/bin/sh\\nexit 0\\n' > "$HOME/.nix-profile/bin/nix-build"
"$TAO_TEST_CHMOD" +x "$HOME/.nix-profile/bin/nix-build"
if [ "\${TAO_TEST_INSTALL_FAIL_AFTER_PROFILE:-}" = yes ]; then exit 23; fi`,
    )
    await CLI.mustRun('tar', { args: ['-cJf', archive, '-C', FS.resolvePath('payload', root), archiveName] })
    const digest = Platform.sha256Hex(await FS.readFile(archive))
    // The fixture substitutes its local archive digest and system-profile path only;
    // download policy and the real checksum check remain production behavior.
    const source = (await FS.readText(Repo.resolvePath(SCRIPT)))
      .replace(CHECKSUMS[architecture], digest)
      .replaceAll('/nix/var/nix/profiles/default', `${root}/system-profile`)
      .replace('mkdir -p /nix\n', `mkdir -p "${root}/nix"\n`)
    await FS.writeText(script, source)
    const chmod = await CLI.commandPath('chmod')
    Assert.defined(chmod, 'fixture chmod executable is available')
    await run({
      root,
      bin,
      script,
      calls,
      archiveName,
      env: {
        PATH: bin,
        HOME: home,
        TAO_TEST_ARCH: architecture,
        TAO_TEST_CALLS: calls,
        TAO_TEST_ARCHIVE: archive,
        TAO_TEST_CHMOD: chmod,
        TAO_TEST_INSTALL_CONFIG: FS.resolvePath('installer-config', root),
        TAO_TEST_STORE: FS.resolvePath('nix', root),
      },
    })
  } finally {
    await FS.remove(root)
  }
}

async function bootstrap(fixture: Fixture, env: Platform.ProcessEnv = {}) {
  return await CLI.run('/bin/sh', { args: [fixture.script], cwd: fixture.root, env: { ...fixture.env, ...env } })
}

async function expectDownloadsRemoved(fixture: Fixture): Promise<void> {
  const entries = await FS.listDir(FS.resolvePath('.artifacts/nix-bootstrap', fixture.root))
  Expect(entries.filter(name => name.startsWith('download.'))).toEqual([])
}

Describe('explicit Nix bootstrap', () => {
  Test('installs once with scoped root settings, preserves user config, and records owned guest paths', async () => {
    await withFixture(async fixture => {
      const config = FS.resolvePath('home/.config/nix/nix.conf', fixture.root)
      await FS.writeText(config, 'sandbox = true\n')
      const result = await bootstrap(fixture, { NIX_CONFIG: 'max-jobs = 2' })
      Expect(result.exitCode).toBe(0)
      Expect(await FS.readText(fixture.calls)).toBe(
        'download\ninstall --no-daemon --no-channel-add --no-modify-profile --yes\n',
      )
      Expect(await FS.readText(fixture.env['TAO_TEST_INSTALL_CONFIG']!)).toBe(
        'max-jobs = 2\nstore = local\nbuild-users-group =\nsandbox = false\n',
      )
      Expect(await FS.readText(config)).toBe('sandbox = true\n')
      const marker = FS.resolvePath('home/.local/state/tao-contributor/nix-bootstrap', fixture.root)
      const installed = await FS.realPath(FS.resolvePath('home/.nix-profile/bin/nix-build', fixture.root))
      Expect(await FS.readText(marker)).toBe(`${installed}\n`)
      Expect(await FS.exists(`${marker}.pending`)).toBe(false)
      const reused = await bootstrap(fixture)
      Expect(reused.exitCode).toBe(0)
      Expect(await FS.readText(fixture.calls)).toBe(
        'download\ninstall --no-daemon --no-channel-add --no-modify-profile --yes\n',
      )
      Expect(await FS.readText(marker)).toBe(`${installed}\n`)
      Expect(await FS.readText(FS.resolvePath('.artifacts/nix-bootstrap/ownership.txt', fixture.root))).toContain(
        'cleanup=remove the disposable guest',
      )
      await expectDownloadsRemoved(fixture)
    })
  })

  Test('keeps nonroot configuration unchanged and does not create the root marker', async () => {
    await withFixture(async fixture => {
      const result = await bootstrap(fixture, { TAO_TEST_UID: '1000', NIX_CONFIG: 'max-jobs = 2' })
      Expect(result.exitCode).toBe(0)
      Expect(await FS.readText(fixture.env['TAO_TEST_INSTALL_CONFIG']!)).toBe('max-jobs = 2\n')
      Expect(await FS.exists(FS.resolvePath('home/.local/state/tao-contributor/nix-bootstrap', fixture.root))).toBe(
        false,
      )
      await expectDownloadsRemoved(fixture)
    })
  })

  Test('installs the pinned ARM Linux archive with the same scoped root configuration', async () => {
    await withFixture(async fixture => {
      const result = await bootstrap(fixture)
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('Nix 2.35.2 for aarch64-linux')
      Expect(await FS.readText(fixture.calls)).toBe(
        'download\ninstall --no-daemon --no-channel-add --no-modify-profile --yes\n',
      )
    }, 'aarch64')
  })

  Test('rejects a changed archive before executing its installer and removes the download', async () => {
    for (const architecture of ['x86_64', 'aarch64'] as const) {
      await withFixture(async fixture => {
        await FS.writeText(
          FS.resolvePath(`payload/${fixture.archiveName}/install`, fixture.root),
          'printf "tampered installer executed\\n" >> "$TAO_TEST_CALLS"\nexit 42\n',
        )
        await CLI.mustRun('tar', {
          args: [
            '-cJf',
            fixture.env['TAO_TEST_ARCHIVE']!,
            '-C',
            FS.resolvePath('payload', fixture.root),
            fixture.archiveName,
          ],
        })
        const result = await bootstrap(fixture)
        Expect(result.exitCode).toBe(1)
        Expect(result.stderr).toContain('checksum verification failed')
        Expect(await FS.readText(fixture.calls)).toBe('download\n')
        Expect(await FS.exists(FS.resolvePath('home/.nix-profile', fixture.root))).toBe(false)
        Expect(await FS.exists(FS.resolvePath('nix', fixture.root))).toBe(false)
        await expectDownloadsRemoved(fixture)
      }, architecture)
    }
  })

  Test('reuses PATH, user-profile, and system-profile installations without downloading or configuring', async () => {
    for (const relative of ['bin/nix-build', 'home/.nix-profile/bin/nix-build', 'system-profile/bin/nix-build']) {
      await withFixture(async fixture => {
        const installed = FS.resolvePath(relative, fixture.root)
        await executable(installed, 'exit 0')
        const result = await bootstrap(fixture)
        Expect(result.exitCode).toBe(0)
        Expect(result.stdout).toContain(`reusing ${installed}`)
        Expect(await FS.exists(fixture.calls)).toBe(false)
        Expect(await FS.exists(FS.resolvePath('.artifacts', fixture.root))).toBe(false)
      })
    }
  })

  Test('rejects unsupported operating systems and architectures before downloading', async () => {
    await withFixture(async fixture => {
      for (const env of [{ TAO_TEST_OS: 'Darwin' }, { TAO_TEST_ARCH: 'riscv64' }]) {
        const result = await bootstrap(fixture, env)
        Expect(result.exitCode).toBe(1)
        Expect(result.stderr).toContain('supports Linux')
        Expect(await FS.exists(fixture.calls)).toBe(false)
      }
    })
  })

  Test('rechecks installation after acquiring the lock and stops on lock failure', async () => {
    await withFixture(async fixture => {
      const blocked = await bootstrap(fixture, { TAO_TEST_LOCK_FAIL: 'yes' })
      Expect(blocked.exitCode).toBe(1)
      Expect(blocked.stderr).toContain('Timed out waiting for Nix installation')
      Expect(await FS.exists(fixture.calls)).toBe(false)
      const reused = await bootstrap(fixture, { TAO_TEST_INSTALL_WHILE_WAITING: 'yes' })
      Expect(reused.exitCode).toBe(0)
      Expect(reused.stdout).toContain('reusing')
      Expect(await FS.exists(fixture.calls)).toBe(false)
    })
  })

  Test('preserves download failures and removes partial files', async () => {
    await withFixture(async fixture => {
      const result = await bootstrap(fixture, { TAO_TEST_DOWNLOAD_FAIL: 'yes' })
      Expect(result.exitCode).toBe(22)
      Expect(await FS.readText(fixture.calls)).toBe('download\n')
      await expectDownloadsRemoved(fixture)
    })
  })

  Test('preserves installer failure and cleans only its download, without publishing success', async () => {
    await withFixture(async fixture => {
      const unrelated = FS.resolvePath('.artifacts/nix-bootstrap/download.unrelated/keep', fixture.root)
      await FS.writeText(unrelated, 'owned by another run')
      const result = await bootstrap(fixture, { TAO_TEST_INSTALL_FAIL: 'yes' })
      Expect(result.exitCode).toBe(23)
      Expect(await FS.readText(fixture.calls)).toBe(
        'download\ninstall --no-daemon --no-channel-add --no-modify-profile --yes\n',
      )
      Expect(await FS.readText(unrelated)).toBe('owned by another run')
      Expect(await FS.readText(FS.resolvePath('nix/partial', fixture.root))).toBe('installer-owned state')
      Expect(await FS.listDir(FS.resolvePath('.artifacts/nix-bootstrap', fixture.root))).toEqual([
        'download.unrelated',
        'ownership.txt',
      ])
      Expect(await FS.exists(FS.resolvePath('home/.local/state/tao-contributor/nix-bootstrap', fixture.root))).toBe(
        false,
      )
    })
  })

  Test('does not publish success when the installer leaves no usable Nix', async () => {
    await withFixture(async fixture => {
      const result = await bootstrap(fixture, { TAO_TEST_INSTALL_EMPTY: 'yes' })
      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('without an executable user-profile nix-build')
      Expect(await FS.exists(FS.resolvePath('home/.local/state/tao-contributor/nix-bootstrap', fixture.root))).toBe(
        false,
      )
      await expectDownloadsRemoved(fixture)
    })
  })

  Test('rejects a retry after the failed installer has already created an executable profile', async () => {
    await withFixture(async fixture => {
      const failed = await bootstrap(fixture, { TAO_TEST_INSTALL_FAIL_AFTER_PROFILE: 'yes' })
      Expect(failed.exitCode).toBe(23)
      const installed = FS.resolvePath('home/.nix-profile/bin/nix-build', fixture.root)
      Expect((await CLI.run(installed)).exitCode).toBe(0)
      const marker = FS.resolvePath('home/.local/state/tao-contributor/nix-bootstrap', fixture.root)
      Expect(await FS.exists(marker)).toBe(false)
      Expect(await FS.exists(`${marker}.pending`)).toBe(true)
      const retried = await bootstrap(fixture)
      Expect(retried.exitCode).toBe(1)
      Expect(retried.stderr).toContain(`pending installation marker: ${marker}.pending`)
      Expect(retried.stderr).toContain('Discard and recreate the disposable Linux guest')
      Expect(await FS.readText(fixture.calls)).toBe(
        'download\ninstall --no-daemon --no-channel-add --no-modify-profile --yes\n',
      )
      Expect(await FS.exists(installed)).toBe(true)
      Expect(await FS.exists(`${marker}.pending`)).toBe(true)
      await expectDownloadsRemoved(fixture)
    })
  })
})
