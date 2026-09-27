import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'

Describe('portable contributor bootstrap', () => {
  Test('reuses a locked generation and preserves it when a changed lock cannot build', async () => {
    const root = await mkTestDir('portable-bootstrap-')
    try {
      const script = FS.resolvePath('bootstrap-tao-dev-env', root)
      const bin = FS.resolvePath('fixture-bin', root)
      const environment = FS.resolvePath('packages/cli/dev-cli/dev-cli-src/environment', root)
      const calls = FS.resolvePath('calls', root)
      const configLog = FS.resolvePath('nix-config', root)
      await FS.writeText(script, await FS.readText(Repo.resolvePath('bootstrap-tao-dev-env')))
      await FS.writeText(FS.resolvePath('devenv.lock', root), 'first lock')
      await FS.writeText(FS.resolvePath('toolchain-packages.nix', environment), 'tool definition')
      await FS.writeText(FS.resolvePath('portable-profile.nix', environment), 'profile definition')
      const executable = async (path: string, body: string) => {
        await FS.writeText(path, `#!/bin/sh\nset -eu\n${body}\n`)
        await FS.chmod(path, 0o755)
      }
      await executable(
        FS.resolvePath('uname', bin),
        'case "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) echo "Linux x86_64" ;; esac',
      )
      // The real kernel lock is exercised in the Linux guest; this fixture tests publication on macOS too.
      await executable(FS.resolvePath('flock', bin), ':')
      await executable(
        FS.resolvePath('nix-build', bin),
        `
printf 'build\\n' >> "$TAO_BOOTSTRAP_TEST_CALLS"
printf '%s' "\${NIX_CONFIG:-}" > "$TAO_BOOTSTRAP_TEST_CONFIG"
if [ "\${TAO_BOOTSTRAP_TEST_FAIL:-}" = yes ]; then exit 23; fi
[ "$2" = --out-link ]
mkdir -p "$3/bin"
for tool in bun node zsh; do
  printf '#!/bin/sh\\nexit 0\\n' > "$3/bin/$tool"
  chmod +x "$3/bin/$tool"
done`,
      )
      await executable(FS.resolvePath('agent', root), 'printf "agent %s\\n" "$*" >> "$TAO_BOOTSTRAP_TEST_CALLS"')
      const env = {
        ...Platform.runtimeProcess.env,
        HOME: FS.resolvePath('home', root),
        PATH: `${bin}:${Repo.resolvePath('.devenv/profile/bin')}:${Platform.runtimeProcess.env['PATH'] ?? ''}`,
        TAO_BOOTSTRAP_TEST_CALLS: calls,
        TAO_BOOTSTRAP_TEST_CONFIG: configLog,
        NIX_CONFIG: 'keep-outputs = true',
      }
      const first = await CLI.run('/bin/sh', { args: [script], cwd: root, env })
      Expect(first.exitCode).toBe(0)
      Expect(await FS.readText(configLog)).toBe('keep-outputs = true')
      const profile = FS.resolvePath('.devenv/profile', root)
      const firstTarget = await FS.realPath(profile)
      const cached = await CLI.run('/bin/sh', { args: [script, '--tools-only'], cwd: root, env })
      Expect(cached.exitCode).toBe(0)
      Expect(await FS.readText(calls)).toBe('build\nagent setup\n')
      Expect(await FS.realPath(profile)).toBe(firstTarget)

      await FS.writeText(FS.resolvePath('devenv.lock', root), 'changed lock')
      const failed = await CLI.run('/bin/sh', {
        args: [script],
        cwd: root,
        env: { ...env, TAO_BOOTSTRAP_TEST_FAIL: 'yes' },
      })
      Expect(failed.exitCode).toBe(23)
      Expect(await FS.realPath(profile)).toBe(firstTarget)
      Expect(await FS.readText(calls)).toBe('build\nagent setup\nbuild\n')

      const marker = FS.resolvePath('home/.local/state/tao-contributor/nix-bootstrap', root)
      await FS.writeText(marker, `${await FS.realPath(FS.resolvePath('nix-build', bin))}\n`)
      const managed = await CLI.run('/bin/sh', { args: [script, '--tools-only'], cwd: root, env })
      Expect(managed.exitCode).toBe(0)
      Expect(await FS.readText(configLog)).toBe(
        'keep-outputs = true\nstore = local\nbuild-users-group =\nsandbox = false',
      )

      await FS.writeText(marker, '/an-unrelated-installation/nix-build\n')
      await FS.writeText(FS.resolvePath('devenv.lock', root), 'another lock')
      const unrelated = await CLI.run('/bin/sh', { args: [script, '--tools-only'], cwd: root, env })
      Expect(unrelated.exitCode).toBe(0)
      Expect(await FS.readText(configLog)).toBe('keep-outputs = true')

      const callsBeforePartial = await FS.readText(calls)
      const targetBeforePartial = await FS.realPath(profile)
      await FS.writeText(`${marker}.pending`, 'interrupted installation\n')
      const partial = await CLI.run('/bin/sh', { args: [script, '--tools-only'], cwd: root, env })
      Expect(partial.exitCode).toBe(1)
      Expect(await FS.readText(calls)).toBe(callsBeforePartial)

      await FS.writeText(
        FS.resolvePath('nix-bootstrap.sh', environment),
        await FS.readText(Repo.resolvePath('packages/cli/dev-cli/dev-cli-src/environment/nix-bootstrap.sh')),
      )
      const interrupted = await CLI.run('/bin/sh', {
        args: [script, '--install-nix', '--tools-only'],
        cwd: root,
        env,
      })
      Expect(interrupted.exitCode).toBe(1)
      Expect(await FS.exists(`${marker}.pending`)).toBe(true)

      // Model the first installer completing while the second waits on its lock.
      // The real installer must arbitrate the marker before the profile can be reused.
      await executable(
        FS.resolvePath('flock', bin),
        `
if [ "$1" = -w ]; then
  printf 'lock acquired\\n' >> "$TAO_BOOTSTRAP_TEST_CALLS"
  rm -f "$HOME/.local/state/tao-contributor/nix-bootstrap.pending"
fi`,
      )
      const overlapping = await CLI.run('/bin/sh', {
        args: [script, '--install-nix', '--tools-only'],
        cwd: root,
        env,
      })
      Expect({ exitCode: overlapping.exitCode, stderr: overlapping.stderr }).toEqual({ exitCode: 0, stderr: '' })
      Expect(await FS.exists(`${marker}.pending`)).toBe(false)
      Expect(await FS.readText(calls)).toBe(`${callsBeforePartial}lock acquired\nlock acquired\n`)
      Expect(await FS.realPath(profile)).toBe(targetBeforePartial)
    } finally {
      await FS.remove(root)
    }
  })
})
