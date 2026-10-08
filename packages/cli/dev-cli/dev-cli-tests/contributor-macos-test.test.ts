import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test } from '@shared/test'

const ENVIRONMENT = 'packages/cli/dev-cli/dev-cli-src/environment'
const VM_LIBRARY = 'packages/cli/tao-cli/cli-src/vm-guest-lib.sh'
const ENTRY = `${ENVIRONMENT}/contributor-macos-test.sh`
const VM_IMAGES = 'packages/cli/tao-cli/cli-src/vm-images.sh'
const VANILLA_IMAGE =
  'ghcr.io/cirruslabs/macos-tahoe-vanilla@sha256:eeec54bfe1f076e27786c5d92b89187a05b1d109b5071eb2dcdf02d596e34640'
const XCODE_IMAGE =
  'ghcr.io/cirruslabs/macos-tahoe-xcode@sha256:71d9dc1d6c4614b7ecbb328753124912b43425fc8cf1c4085d7f352026df6601'
const AGENT_SHA = '303a50d452753e36776ce8775e243be580bb3fc3ec8efde154320c37fd65b1a7'

Describe('contributor macOS VM runner', () => {
  Test('rejects extra arguments before consulting Tart or the VM helper', async () => {
    await withFixture(async fixture => {
      for (
        const args of [
          ['--base'],
          ['--base', 'ventura'],
          ['--base', 'vanilla', '--debug'],
          ['--vm', 'tao-contributor-1-2'],
          ['vanilla'],
          ['--base', '../xcode'],
        ]
      ) {
        const result = await run(fixture, args)
        Expect(result.exitCode).toBe(2)
      }
      Expect(await FS.exists(fixture.log)).toBe(false)
      Expect(await FS.exists(FS.resolvePath('.artifacts/contributor-macos', fixture.root))).toBe(false)
    })
  })

  Test('leaves another workflow lease untouched and creates no VM', async () => {
    await withFixture(async fixture => {
      const owner = FS.resolvePath('.tao/standalone-vm-lease/owner.txt', fixture.home)
      await FS.writeText(owner, 'pid=12345\nvm=someone-elses-work\n')
      const result = await run(fixture)
      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('Another VM workflow owns')
      Expect(await FS.readText(owner)).toBe('pid=12345\nvm=someone-elses-work\n')
      Expect(await FS.exists(fixture.log)).toBe(false)
    })
  })

  Test(
    'runs the journey in a clone of the local base with committed source only, then deletes the clone',
    async () => {
      await withFixture(async fixture => {
        await FS.writeText(FS.resolvePath('untracked-secret.txt', fixture.root), 'private')
        await FS.writeText(FS.resolvePath('tracked.txt', fixture.root), 'dirty')
        const result = await run(fixture)
        Expect(result.exitCode).toBe(0)
        const calls = await readCalls(fixture)
        const clones = calls.filter(call => call.startsWith('tart clone ')).map(call => call.split(' '))
        Expect(clones).toHaveLength(1)
        const name = clones[0]?.[3] ?? ''
        Expect(name).toMatch(/^tao-contributor-[0-9]+-[0-9]+$/)
        Expect(calls.filter(call => call.startsWith('tart '))).toEqual([
          'tart --version',
          'tart list --source local --quiet',
          `tart clone tao-base-vanilla ${name}`,
          `tart set ${name} --cpu 4 --memory 16384`,
          `tart get ${name} --format json`,
          `tart stop ${name}`,
          `tart delete ${name}`,
        ])
        const helper = calls.filter(call => call.startsWith('helper ')).map(call => call.split(' ').slice(1))
        Expect(helper.map(args => `${args[0]} ${args[1]}`)).toEqual([
          `idle ${name}`,
          `boot ${name}`,
          `exec ${name}`,
          `exec ${name}`,
          `push ${name}`,
          `exec ${name}`,
          `exec ${name}`,
          `exec ${name}`,
        ])
        Expect(helper.slice(4).map(args => args.slice(3).join(' '))).toEqual([
          '/Users/admin',
          '/bin/sh /Users/admin/tao-harness/input/run.sh vanilla',
          '/usr/bin/tar -cf - -C /Users/admin/tao/.artifacts contributor-macos',
          '/bin/sync',
        ])
        const pushed = await CLI.run('tar', { args: ['-tf', FS.resolvePath('.artifacts/pushed.tar', fixture.root)] })
        Expect(pushed.stdout.split('\n').filter(Boolean).sort()).toEqual([
          'tao-harness/',
          'tao-harness/input/',
          'tao-harness/input/checkout.tar',
          'tao-harness/input/run.sh',
        ])
        Expect(calls.some(call => call.includes('tao-basebuild-') || call.startsWith('tart pull'))).toBe(false)
        Expect(await FS.exists(FS.resolvePath('.tao/standalone-vm-lease', fixture.home))).toBe(false)
        Expect(result.stdout).toContain('Contributor macOS: guest steps (label, exit, seconds)')
        Expect(result.stdout).toContain('setup\t0\t12')
        const evidence = await evidenceDirectory(fixture)
        Expect(await FS.readText(`${evidence}/guest/contributor-macos/steps.tsv`)).toContain('nix-install\t0\t30')
        Expect(await FS.readText(`${evidence}/result.txt`)).toContain('exit_code=0')
        Expect(await FS.readText(`${evidence}/resources.txt`)).toContain('uncommitted changes excluded')
        Expect(await FS.readText(`${evidence}/host-dirty-state.txt`)).toContain('tracked.txt')
        const archive = await CLI.run('tar', { args: ['-xOf', `${evidence}/input/checkout.tar`, 'tao/tracked.txt'] })
        Expect(archive.exitCode).toBe(0)
        Expect(archive.stdout).toBe('committed')
        const listing = await CLI.run('tar', { args: ['-tf', `${evidence}/input/checkout.tar`] })
        Expect(listing.stdout).not.toContain('untracked-secret.txt')
        Expect(listing.stdout).toContain('tao/.git/HEAD')
        Expect(await FS.readText(`${evidence}/input/run.sh`)).toContain('contributor-macos-guest.sh "$1"')
      })
    },
  )

  Test('stops before any clone and names the command when the local base is missing or stale', async () => {
    await withFixture(async fixture => {
      for (const prepare of [() => FS.remove(fixture.base), () => FS.writeText(fixture.manifest, 'source=old\n')]) {
        await prepare()
        await FS.remove(fixture.log)
        const result = await run(fixture)
        Expect(result.exitCode).toBe(1)
        Expect(result.stderr).toContain('the local macOS base tao-base-vanilla is missing')
        Expect(result.stderr).toContain(`Run this in a terminal from ${fixture.root}`)
        Expect(result.stderr).toContain('\n  just vm-images vanilla\n')
        const calls = await readCalls(fixture)
        Expect(calls.some(call => call.startsWith('tart clone ') || call.startsWith('tart pull '))).toBe(false)
        Expect(calls.some(call => call.includes('bootstrap-agent'))).toBe(false)
        Expect(await FS.exists(FS.resolvePath('.tao/standalone-vm-lease', fixture.home))).toBe(false)
      }
    })
  })

  Test('selects the Xcode image only for the named base', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, ['--base', 'xcode'])
      Expect(result.exitCode).toBe(0)
      const calls = await readCalls(fixture)
      // The Xcode image ships its own agent, so no local base is built.
      Expect(calls.filter(call => call.startsWith('tart clone '))).toHaveLength(1)
      Expect(calls.find(call => call.startsWith('tart clone '))).toContain(XCODE_IMAGE)
      Expect(calls.some(call => call.includes('bootstrap-agent'))).toBe(false)
      Expect(calls.some(call => call.endsWith('run.sh xcode'))).toBe(true)

      // An uncached Xcode image stops the run with the command that downloads it.
      await FS.remove(fixture.log)
      const missing = await run(fixture, ['--base', 'xcode'], { FAKE_NO_IMAGES: '1' })
      Expect(missing.exitCode).toBe(1)
      Expect(missing.stderr).toContain(`the pinned xcode image is not cached on this Mac: ${XCODE_IMAGE}`)
      Expect(missing.stderr).toContain('\n  just vm-images xcode\n')
      Expect((await readCalls(fixture)).some(call => call.startsWith('tart clone '))).toBe(false)
    })
  })

  Test('reports a failed guest journey with its status after collecting evidence and deleting the clone', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, [], { FAKE_GUEST_EXIT: '7' })
      Expect(result.exitCode).toBe(7)
      const calls = await readCalls(fixture)
      Expect(calls.some(call => call.startsWith('tart delete '))).toBe(true)
      Expect(calls.some(call => call.includes('/usr/bin/tar -cf -'))).toBe(true)
      Expect(await FS.readText(`${await evidenceDirectory(fixture)}/result.txt`)).toContain('exit_code=7')
      Expect(await FS.exists(FS.resolvePath('.tao/standalone-vm-lease', fixture.home))).toBe(false)
    })
  })

  Test('keeps a clone whose guest evidence was not collected, and names it', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, [], { FAKE_COLLECT: 'fail' })
      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('retaining stopped VM tao-contributor-')
      const calls = await readCalls(fixture)
      Expect(calls.some(call => call.startsWith('tart delete '))).toBe(false)
      Expect(calls.some(call => call.startsWith('tart stop '))).toBe(true)
      Expect(await FS.exists(FS.resolvePath('.tao/standalone-vm-lease', fixture.home))).toBe(false)
    })
  })
})

Describe('VM image preparation', () => {
  Test('builds the local base once from the pinned image, writing only the agent before its one boot', async () => {
    await withFixture(async fixture => {
      await FS.remove(fixture.base)
      await FS.remove(fixture.manifest)
      const result = await CLI.run('/bin/bash', {
        args: [FS.resolvePath(VM_IMAGES, fixture.root), 'vanilla'],
        cwd: fixture.root,
        env: { ...fixture.env, FAKE_NO_IMAGES: '1' },
        processPolicy: 'test',
        timeoutMs: 60_000,
      })
      Expect(result.exitCode).toBe(0)
      const calls = await readCalls(fixture)
      const build = calls.find(call => call.startsWith('tart clone '))?.split(' ')[3] ?? ''
      Expect(build).toMatch(/^tao-basebuild-[0-9]+-[0-9]+$/)
      Expect(calls.filter(call => call.startsWith('tart '))).toEqual([
        'tart --version',
        'tart list --source oci --quiet',
        `tart pull ${VANILLA_IMAGE}`,
        `tart clone ${VANILLA_IMAGE} ${build}`,
        `tart stop ${build}`,
        'tart list --source local --quiet',
        `tart rename ${build} tao-base-vanilla`,
      ])
      const helper = calls.filter(call => call.startsWith('helper ')).map(call => call.split(' ').slice(1))
      Expect(helper.map(args => `${args[0]} ${args[1]}`)).toEqual([
        `idle ${build}`,
        `bootstrap-agent ${build}`,
        `boot ${build}`,
        `exec ${build}`,
        `exec ${build}`,
        `exec ${build}`,
      ])
      Expect(await FS.readText(fixture.manifest)).toContain(
        `source=${VANILLA_IMAGE}\nagent=0.10.0 ${AGENT_SHA}\nbuilt=`,
      )
      Expect(await FS.exists(FS.resolvePath('.tao/standalone-vm-lease', fixture.home))).toBe(false)

      // A current base and a cached image leave nothing to do.
      await FS.remove(fixture.log)
      Expect(
        (await CLI.run('/bin/bash', {
          args: [FS.resolvePath(VM_IMAGES, fixture.root), 'vanilla'],
          cwd: fixture.root,
          env: fixture.env,
          processPolicy: 'test',
          timeoutMs: 60_000,
        })).exitCode,
      ).toBe(0)
      const again = await readCalls(fixture)
      Expect(again.some(call => call.startsWith('tart clone ') || call.startsWith('tart pull '))).toBe(false)
    })
  })
})

Describe('contributor path documentation', () => {
  Test('gives the commands the macOS and Linux guests run, in the form the guests run them', async () => {
    const doc = await FS.readText(Repo.resolvePath('CONTRIBUTING.md'))
    const macos = await FS.readText(Repo.resolvePath(`${ENVIRONMENT}/contributor-macos-guest.sh`))
    const linux = await FS.readText(Repo.resolvePath(`${ENVIRONMENT}/guest-smoke.sh`))
    const loop = await FS.readText(Repo.resolvePath(`${ENVIRONMENT}/contributor-journey-step.sh`))
    const installer = 'curl -sSfL https://artifacts.nixos.org/nix-installer | sh -s -- install'
    Expect(doc).toContain(installer)
    // The guest has no terminal to confirm at; --no-confirm is the installer's own unattended form.
    Expect(macos).toContain(`${installer} --no-confirm`)
    for (
      const command of [
        'nix-env --install --attr devenv -f https://github.com/NixOS/nixpkgs/tarball/nixpkgs-unstable',
        './enter-tao-dev-env',
      ]
    ) {
      Expect(doc).toContain(command)
      Expect(macos).toContain(command)
    }
    for (
      const test of [
        './dev test-file packages/language/parser/parser-tests/dialect.test.ts',
        './dev test-file packages/language/source-actions',
      ]
    ) {
      Expect(doc).toContain(test)
      Expect(macos).toContain(test)
    }
    Expect(doc).toContain('./.config/bootstrap-tao-dev-env')
    Expect(linux).toContain('./.config/bootstrap-tao-dev-env')
    Expect(doc).toContain('./dev dev-loop start Apps/Starters/Notebook --app Notebook --json')
    Expect(loop).toContain('starter=Apps/Starters/Notebook')
    Expect(loop).toContain('./dev dev-loop start "$starter" --app "$app" --json')
    Expect(doc).toContain('./dev dev-loop stop --session <session> --json')
    Expect(loop).toContain('./dev dev-loop stop --session')
  })

  Test('points the README at the contributor path and tells humans only human commands', async () => {
    const readme = await FS.readText(Repo.resolvePath('README.md'))
    Expect(readme).toContain('(CONTRIBUTING.md)')
    Expect(readme).not.toContain('./agent')
    Expect(await FS.exists(Repo.resolvePath('CONTRIBUTING.md'))).toBe(true)
    const doc = await FS.readText(Repo.resolvePath('CONTRIBUTING.md'))
    Expect(doc).toContain('(README.md#licence)')
    Expect(doc).toContain('just contributor-macos-test')
    Expect(doc).toContain('just contributor-linux-test')
  })
})

type Fixture = {
  root: string
  home: string
  log: string
  base: string
  manifest: string
  env: Platform.ProcessEnv
}

async function readCalls(fixture: Fixture): Promise<string[]> {
  return (await FS.readText(fixture.log)).trim().split('\n')
}

async function evidenceDirectory(fixture: Fixture): Promise<string> {
  return (await FS.readText(FS.resolvePath('.artifacts/contributor-macos/latest.txt', fixture.root))).trim()
}

/**
 * A committed fixture repository holding the real runner and VM library, a recording `tart`, and a recording
 * stand-in for the checkout Bun that answers the VM helper's commands. No VM, network, or Tart store is touched.
 * The pinned images are cached unless `FAKE_NO_IMAGES` is set, and the local vanilla base starts current.
 */
async function withFixture(test: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkGitTestDir('tao-contributor-macos-')
  try {
    const files: Record<string, string> = {
      '.gitignore': '.artifacts/\n',
      'tracked.txt': 'committed',
    }
    for (const path of [ENTRY, VM_LIBRARY, VM_IMAGES]) {
      files[path] = await FS.readText(Repo.resolvePath(path))
    }
    await initGitTestRepository(root, { commit: { files } })
    const home = FS.resolvePath('home', root)
    const bin = FS.resolvePath('.artifacts/fake-bin', root)
    const log = FS.resolvePath('.artifacts/calls.log', root)
    const stopped = FS.resolvePath('.artifacts/stopped', root)
    const guest = FS.resolvePath('.artifacts/fake-guest', root)
    await FS.writeText(FS.resolvePath('contributor-macos/steps.tsv', guest), 'nix-install\t0\t30\nsetup\t0\t12\n')
    // The pinned guest agent is already cached, so no download is attempted.
    await FS.writeText(FS.resolvePath('tart-guest-agent', guest), 'agent\n')
    await FS.mkdir(FS.resolvePath('.artifacts/standalone-toolchain', root))
    await CLI.mustRun('tar', {
      args: [
        '-czf',
        FS.resolvePath('.artifacts/standalone-toolchain/tart-guest-agent-0.10.0.tar.gz', root),
        '-C',
        guest,
        'tart-guest-agent',
      ],
    })
    const executables: Record<string, string> = {
      tart: [
        '#!/bin/sh',
        'printf "tart %s\\n" "$*" >> "$FAKE_LOG"',
        'case "$1" in',
        '  --version) printf "2.32.1\\n" ;;',
        '  get) [ "$2" != tao-base-vanilla ] || [ -f "$FAKE_BASE" ] || exit 1; printf "{}\\n" ;;',
        '  list) case "$3" in',
        `    oci) [ -n "\${FAKE_NO_IMAGES:-}" ] || printf "%s\\n" ${VANILLA_IMAGE} ${XCODE_IMAGE} ;;`,
        '    local) [ ! -f "$FAKE_BASE" ] || printf "tao-base-vanilla\\n" ;;',
        '  esac ;;',
        '  rename) : > "$FAKE_BASE" ;;',
        '  stop) : > "$FAKE_STOPPED" ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n'),
      // The runner checks the pinned archive's digest; the fixture's archive stands in for it.
      shasum: `#!/bin/sh\nprintf '${AGENT_SHA}  -\\n'\n`,
      bun: [
        '#!/bin/sh',
        'printf "helper %s\\n" "$*" | sed "s|^helper run [^ ]* |helper |" >> "$FAKE_LOG"',
        '[ "$1" = run ] || exit 64',
        'shift 2',
        'case "$1" in',
        '  idle|bootstrap-agent) exit 0 ;;',
        '  push) cat > "$FAKE_PUSHED"; exit 0 ;;',
        '  boot)',
        '    rm -f "$FAKE_STOPPED"',
        '    trap "exit 0" TERM',
        '    while [ ! -f "$FAKE_STOPPED" ]; do sleep 0.1; done',
        '    exit 0 ;;',
        '  exec)',
        '    shift 3',
        '    case "$1 $2" in',
        '      "/bin/sh /Users/admin/tao-harness/input/run.sh") printf "guest console\\n"; exit "${FAKE_GUEST_EXIT:-0}" ;;',
        '      "/usr/bin/tar -cf") [ "${FAKE_COLLECT:-}" != fail ] || exit 9; exec /usr/bin/tar -cf - -C "$FAKE_GUEST" contributor-macos ;;',
        '    esac',
        '    exit 0 ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n'),
    }
    for (const [name, content] of Object.entries(executables)) {
      const path = FS.resolvePath(name, bin)
      await FS.writeText(path, content)
      await FS.chmod(path, 0o755)
    }
    // The clean PATH would otherwise reach macOS's /usr/bin/git shim, which warns on stderr when the sandbox
    // denies the per-user temporary directory.
    const git = await CLI.commandPath('git')
    if (git !== undefined) {
      await FS.symlink(git, FS.resolvePath('git', bin))
    }
    const base = FS.resolvePath('.artifacts/base-exists', root)
    const manifest = FS.resolvePath('.tao/vm-bases/tao-base-vanilla.txt', home)
    await FS.writeText(base, '')
    await FS.writeText(manifest, `source=${VANILLA_IMAGE}\nagent=0.10.0 ${AGENT_SHA}\nbuilt=2026-10-07T00:00:00Z\n`)
    await test({
      root,
      home,
      log,
      base,
      manifest,
      env: {
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        FAKE_LOG: log,
        FAKE_STOPPED: stopped,
        FAKE_BASE: base,
        FAKE_PUSHED: FS.resolvePath('.artifacts/pushed.tar', root),
        FAKE_GUEST: guest,
        TAO_STANDALONE_BUN: FS.resolvePath('bun', bin),
      },
    })
  } finally {
    await FS.remove(root)
  }
}

async function run(
  fixture: Fixture,
  args: string[] = [],
  extra: Record<string, string> = {},
): Promise<CLI.CommandResult> {
  return await CLI.run('/bin/bash', {
    args: [FS.resolvePath(ENTRY, fixture.root), ...args],
    cwd: fixture.root,
    env: { ...fixture.env, ...extra },
    processPolicy: 'test',
    timeoutMs: 60_000,
  })
}
