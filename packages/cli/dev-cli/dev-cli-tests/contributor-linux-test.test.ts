import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test } from '@shared/test'

const ENVIRONMENT = 'packages/cli/dev-cli/dev-cli-src/environment'
const VM_LIBRARY = 'packages/cli/tao-cli/cli-src/vm-guest-lib.sh'
const ENTRY = `${ENVIRONMENT}/contributor-linux-test.sh`
const UBUNTU_IMAGE = 'ghcr.io/cirruslabs/ubuntu@sha256:e004f7f4f6765e2b3ae2738a95040c5d03867b667eb21a57ea0c3729aad640b6'
const GUEST_RUN = '/bin/sh /home/admin/tao-harness/input/run.sh'

Describe('contributor Linux VM runner', () => {
  Test('rejects extra arguments before consulting Tart or the VM helper', async () => {
    await withFixture(async fixture => {
      for (
        const args of [
          ['--mode'],
          ['--mode', 'host'],
          ['--mode', 'cold', '--debug'],
          ['--probe'],
          ['--native-arm64'],
          ['--qemu-compat'],
          ['--inspect-run', '20260926T161634Z-57262'],
          ['--vm', 'tao-contributor-1-2'],
          ['cold'],
        ]
      ) {
        const result = await run(fixture, args)
        Expect(result.exitCode).toBe(2)
      }
      Expect(await FS.exists(fixture.log)).toBe(false)
      Expect(await FS.exists(FS.resolvePath('.artifacts/contributor-linux', fixture.root))).toBe(false)
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

  Test('runs the cold journey in a clone of the pinned image with committed source only, then deletes it', async () => {
    await withFixture(async fixture => {
      await FS.writeText(FS.resolvePath('untracked-secret.txt', fixture.root), 'private')
      await FS.writeText(FS.resolvePath('tracked.txt', fixture.root), 'dirty')
      const result = await run(fixture, ['--mode', 'cold'])
      Expect(result.exitCode).toBe(0)
      const calls = await readCalls(fixture)
      const clones = calls.filter(call => call.startsWith('tart clone ')).map(call => call.split(' '))
      Expect(clones).toHaveLength(1)
      const name = clones[0]?.[3] ?? ''
      Expect(name).toMatch(/^tao-contributor-[0-9]+-[0-9]+-cold$/)
      Expect(calls.filter(call => call.startsWith('tart '))).toEqual([
        'tart --version',
        `tart clone ${UBUNTU_IMAGE} ${name}`,
        `tart set ${name} --cpu 4 --memory 16384 --disk-size 50`,
        `tart get ${name} --format json`,
        `tart stop ${name}`,
        `tart delete ${name}`,
      ])
      const stem = name.replace(/-cold$/, '')
      const helper = calls.filter(call => call.startsWith('helper ')).map(call => call.split(' ').slice(1))
      Expect(helper.map(args => `${args[0]} ${args[1]}`)).toEqual([
        `idle ${stem}`,
        `boot ${name}`,
        `exec ${name}`,
        `exec ${name}`,
        `push ${name}`,
        `exec ${name}`,
        `exec ${name}`,
        `exec ${name}`,
      ])
      Expect(helper.slice(5).map(args => args.slice(2).join(' '))).toEqual([
        `7200000 ${GUEST_RUN} cold`,
        '300000 /usr/bin/tar -cf - -C /home/admin/tao/.artifacts contributor-linux/guest-cold logs',
        '30000 /bin/sync',
      ])
      Expect(helper[4]?.slice(2)).toEqual(['1800000', '/home/admin'])
      const pushed = await CLI.run('tar', {
        args: ['-tf', FS.resolvePath(`.artifacts/pushed/${name}.tar`, fixture.root)],
      })
      Expect(pushed.stdout.split('\n').filter(Boolean).sort()).toEqual([
        'tao-harness/',
        'tao-harness/input/',
        'tao-harness/input/checkout.tar',
        'tao-harness/input/run.sh',
      ])

      Expect(await FS.exists(FS.resolvePath('.tao/standalone-vm-lease', fixture.home))).toBe(false)
      Expect(result.stdout).toContain('Contributor Linux: cold guest steps (label, exit, seconds)')
      Expect(result.stdout).toContain('setup\t0\t12')
      const evidence = await evidenceDirectory(fixture)
      Expect(await FS.readText(`${evidence}/cold/guest/contributor-linux/guest-cold/steps.tsv`)).toContain(
        'bootstrap\t0\t30',
      )
      Expect(await FS.readText(`${evidence}/cold/guest/logs/check.log`)).toContain('workflow log')
      Expect(await FS.readText(`${evidence}/cold/logs/console.log`)).toContain('guest console')
      Expect(await FS.readText(`${evidence}/result.txt`)).toContain('exit_code=0')
      Expect(await FS.readText(`${evidence}/source-commit.txt`)).toMatch(/^[0-9a-f]{40}\n$/)
      Expect(await FS.readText(`${evidence}/host-dirty-state.txt`)).toContain('tracked.txt')
      Expect(await FS.readText(`${evidence}/resources.txt`)).toEqual(
        [
          'platform=linux/arm64 (Tart Ubuntu VM)',
          'guest_cpus=4',
          'guest_memory_mib=16384',
          'guest_disk_gb=50',
          'guest_timeout_seconds=7200',
          `image=${UBUNTU_IMAGE}`,
          'host_only_native_ui_lanes=unrun',
          'source=git archive HEAD; uncommitted changes excluded',
          'amd64=not covered locally; hosted Verify runs ubuntu-24.04 x86-64',
          '',
        ].join('\n'),
      )
      const archive = await CLI.run('tar', { args: ['-xOf', `${evidence}/input/checkout.tar`, 'tracked.txt'] })
      Expect(archive.exitCode).toBe(0)
      Expect(archive.stdout).toBe('committed')
      const listing = await CLI.run('tar', { args: ['-tf', `${evidence}/input/checkout.tar`] })
      Expect(listing.stdout).not.toContain('untracked-secret.txt')
      const guestScript = await FS.readText(`${evidence}/input/run.sh`)
      Expect(guestScript).toContain(
        'sudo DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \\\n'
          + '      curl ca-certificates xz-utils git tar coreutils util-linux',
      )
      Expect(guestScript).toContain('guest-smoke.sh "$1"')
      Expect(guestScript).toContain('cold|tools)')
    })
  })

  Test('reports a failed guest journey with its status after collecting evidence and deleting the clone', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, ['--mode', 'cold'], { FAKE_GUEST_EXIT: '7' })
      Expect(result.exitCode).toBe(7)
      const calls = await readCalls(fixture)
      Expect(calls.some(call => call.startsWith('tart delete '))).toBe(true)
      Expect(calls.some(call => call.includes('/usr/bin/tar -cf -'))).toBe(true)
      Expect(calls.findIndex(call => call.includes('/usr/bin/tar -cf -')))
        .toBeLessThan(calls.findIndex(call => call.startsWith('tart delete ')))
      Expect(await FS.readText(`${await evidenceDirectory(fixture)}/result.txt`)).toContain('exit_code=7')
      Expect(await FS.exists(FS.resolvePath('.tao/standalone-vm-lease', fixture.home))).toBe(false)
    })
  })

  Test('keeps a clone whose guest evidence was not collected, and names it', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, ['--mode', 'cold'], { FAKE_COLLECT: 'fail' })
      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('retaining stopped VM tao-contributor-')
      Expect(result.stderr).toMatch(/delete it with tart delete tao-contributor-[0-9]+-[0-9]+-cold/u)
      const calls = await readCalls(fixture)
      Expect(calls.some(call => call.startsWith('tart delete '))).toBe(false)
      Expect(calls.some(call => call.startsWith('tart stop '))).toBe(true)
      Expect(await FS.exists(FS.resolvePath('.tao/standalone-vm-lease', fixture.home))).toBe(false)
    })
  })

  Test('builds the tools VM once, names it by its inputs, and reuses it until those inputs change', async () => {
    await withFixture(async fixture => {
      Expect((await run(fixture, ['--mode', 'cached'])).exitCode).toBe(0)
      const first = await readCalls(fixture)
      const clones = first.filter(call => call.startsWith('tart clone ')).map(call => call.split(' '))
      const tools = clones[0]?.[3] ?? ''
      const cached = clones[1]?.[3] ?? ''
      Expect(tools).toMatch(/^tao-contributor-[0-9]+-[0-9]+-tools$/)
      Expect(cached).toMatch(/^tao-contributor-[0-9]+-[0-9]+-cached$/)
      const cache = clones[1]?.[2] ?? ''
      Expect(cache).toMatch(/^tao-linux-tools-[0-9a-f]{40}$/)
      Expect(clones[0]?.[2]).toBe(UBUNTU_IMAGE)
      Expect(first.filter(call => call.startsWith('tart '))).toEqual([
        'tart --version',
        `tart get ${cache} --format json`,
        `tart clone ${UBUNTU_IMAGE} ${tools}`,
        `tart set ${tools} --cpu 4 --memory 16384 --disk-size 50`,
        `tart get ${tools} --format json`,
        `tart stop ${tools}`,
        `tart rename ${tools} ${cache}`,
        `tart clone ${cache} ${cached}`,
        `tart set ${cached} --cpu 4 --memory 16384`,
        `tart get ${cached} --format json`,
        `tart stop ${cached}`,
        `tart delete ${cached}`,
      ])
      const collections = first.filter(call => call.includes('/usr/bin/tar -cf -'))
      Expect(collections.map(call => call.split('.artifacts ')[1])).toEqual([
        'contributor-linux/guest-tools',
        'contributor-linux/guest-cached logs',
      ])
      Expect(first.filter(call => call.endsWith('run.sh tools'))).toHaveLength(1)
      Expect(first.filter(call => call.endsWith('run.sh cached'))).toHaveLength(1)
      const evidence = await evidenceDirectory(fixture)
      const ownership = await FS.readText(`${evidence}/cache-ownership.txt`)
      Expect(ownership).toContain('owner=contributor-linux-test')
      Expect(ownership).toContain(`vm=${cache}`)
      Expect(ownership).toContain(`tart delete ${cache}`)
      Expect(await FS.exists(`${evidence}/tools/guest/contributor-linux/guest-tools/steps.tsv`)).toBe(true)
      Expect(await FS.exists(`${evidence}/tools/guest/logs`)).toBe(false)
      Expect(await FS.exists(`${evidence}/cached/guest/logs/check.log`)).toBe(true)

      // An unrelated source commit leaves the key alone, so the second run clones the existing tools VM.
      await commitFile(fixture, 'tracked.txt', 'another commit')
      await FS.remove(fixture.log)
      Expect((await run(fixture, ['--mode', 'cached'])).exitCode).toBe(0)
      const second = await readCalls(fixture)
      Expect(second.filter(call => call.startsWith('tart clone ')).map(call => call.split(' ')[2])).toEqual([cache])
      Expect(second.some(call => call.startsWith('tart rename '))).toBe(false)
      Expect(second.some(call => call.endsWith('run.sh tools'))).toBe(false)
      Expect(second.filter(call => call.endsWith('run.sh cached'))).toHaveLength(1)

      // A changed tool input names a different VM, which is built afresh.
      await commitFile(fixture, 'devenv.lock', '{"changed":true}\n')
      await FS.remove(fixture.log)
      Expect((await run(fixture, ['--mode', 'cached'])).exitCode).toBe(0)
      const third = await readCalls(fixture)
      const renamed = third.find(call => call.startsWith('tart rename '))?.split(' ')[3]
      Expect(renamed).toMatch(/^tao-linux-tools-[0-9a-f]{40}$/)
      Expect(renamed).not.toBe(cache)
      Expect(third.filter(call => call.endsWith('run.sh tools'))).toHaveLength(1)
    })
  })

  Test(
    'runs cold then cached in both mode, each in its own clone, and fails with the first failing status',
    async () => {
      await withFixture(async fixture => {
        const result = await run(fixture, [], { FAKE_GUEST_EXIT: '7', FAKE_GUEST_EXIT_PHASE: 'cold' })
        Expect(result.exitCode).toBe(7)
        const calls = await readCalls(fixture)
        Expect(calls.filter(call => call.endsWith('run.sh cold'))).toHaveLength(1)
        Expect(calls.filter(call => call.endsWith('run.sh tools'))).toHaveLength(1)
        Expect(calls.filter(call => call.endsWith('run.sh cached'))).toHaveLength(1)
        Expect(calls.filter(call => call.startsWith('tart delete '))).toHaveLength(2)
        Expect(calls.filter(call => call.startsWith('tart rename '))).toHaveLength(1)
      })
    },
  )

  Test('does not run cached smoke when the tools VM fails, and does not keep it as the cache', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, ['--mode', 'cached'], { FAKE_GUEST_EXIT: '7', FAKE_GUEST_EXIT_PHASE: 'tools' })
      Expect(result.exitCode).toBe(7)
      Expect(result.stderr).toContain('Cached smoke unrun')
      const calls = await readCalls(fixture)
      Expect(calls.some(call => call.startsWith('tart rename '))).toBe(false)
      Expect(calls.some(call => call.endsWith('run.sh cached'))).toBe(false)
      Expect(calls.filter(call => call.startsWith('tart delete '))).toHaveLength(1)
      Expect(await FS.exists(FS.resolvePath('.tao/standalone-vm-lease', fixture.home))).toBe(false)
    })
  })

  Test('runs guest wrappers as the current user with a clean PATH and preserves a failed check', async () => {
    const root = await mkGitTestDir('tao-contributor-linux-guest-')
    try {
      const guest = FS.resolvePath(`${ENVIRONMENT}/guest-smoke.sh`, root)
      await FS.writeText(guest, await FS.readText(Repo.resolvePath(`${ENVIRONMENT}/guest-smoke.sh`)))
      await FS.writeText(FS.resolvePath('.gitignore', root), '.artifacts/\ncalls.log\n')
      await writeVersionTools(root)
      await writeJourneyStub(root)
      for (const name of ['.config/bootstrap-tao-dev-env', 'agent']) {
        const path = FS.resolvePath(name, root)
        await FS.writeText(
          path,
          [
            '#!/bin/sh',
            'printf "%s|%s|%s|%s|%s\\n" "$*" "$PATH" "${TAO_TEST_INHERITED-unset}" "$HOME" "$USER" >> calls.log',
            'printf "wrapper output: %s\\n" "$*"',
            '[ "${1:-}" != check ]',
            '',
          ].join('\n'),
        )
        await FS.chmod(path, 0o755)
      }
      const result = await CLI.run('/bin/sh', {
        // Disk accounting is irrelevant here and must never traverse the host's Nix store.
        args: ['-c', 'du() { :; }; df() { :; }; . "$0"', guest, 'cached'],
        cwd: root,
        env: { ...Platform.runtimeProcess.env, TAO_TEST_INHERITED: 'fixture-value' },
      })
      Expect(result.exitCode).toBe(1)
      Expect(result.stdout).toContain('wrapper output: check')
      Expect(result.stdout).toContain('check finished (exit 1,')
      const versions = await FS.readText(
        FS.resolvePath('.artifacts/contributor-linux/guest-cached/tool-versions.log', root),
      )
      for (const tool of ['bun', 'node', 'zsh', 'just', 'python3', 'nix']) {
        Expect(versions).toContain(`${tool} (${root}/.devenv/profile/bin/${tool}): ${tool} fixture-version --version`)
      }
      const path = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
      const user = (await CLI.mustRun('id', { args: ['-un'] })).stdout.trim()
      const home = Platform.runtimeProcess.env['HOME'] ?? ''
      const identity = `${path}|unset|${home}|${user}`
      Expect((await FS.readText(FS.resolvePath('calls.log', root))).trim().split('\n')).toEqual([
        `|${identity}`,
        `help|${identity}`,
        `setup --verbose|${identity}`,
        `test-file packages/language/parser/parser-tests/dialect.test.ts --verbose|${identity}`,
        `check --verbose|${identity}`,
        `test-all --verbose|${identity}`,
        `verify --verbose|${identity}`,
        // The shared journey runs after the lanes that judge the committed tree, in its fixed order.
        ...JOURNEY_ACTIONS.map(action => `journey ${action}`),
      ])
      const steps = (await FS.readText(FS.resolvePath('.artifacts/contributor-linux/guest-cached/steps.tsv', root)))
        .trim().split('\n').map(line => line.split('\t')[0])
      Expect(steps.slice(-6)).toEqual([
        'dev-loop-start',
        'dev-loop-serve',
        'toolchain-change',
        'dev-loop-restart',
        'dev-loop-reflect',
        'dev-loop-stop',
      ])
      // The kernel's memory view after each step, so a silent OOM kill is attributable to it.
      Expect(await FS.exists(FS.resolvePath('.artifacts/contributor-linux/guest-cached/check.memory.txt', root)))
        .toBe(true)
    } finally {
      await FS.remove(root)
    }
  })

  Test('skips later journey actions after a failure but always stops the dev loop and fails the guest', async () => {
    const root = await mkGitTestDir('tao-contributor-linux-journey-')
    try {
      const guest = FS.resolvePath(`${ENVIRONMENT}/guest-smoke.sh`, root)
      await FS.writeText(guest, await FS.readText(Repo.resolvePath(`${ENVIRONMENT}/guest-smoke.sh`)))
      await FS.writeText(FS.resolvePath('.gitignore', root), '.artifacts/\ncalls.log\nfail-*\n')
      await writeVersionTools(root)
      await writeJourneyStub(root)
      await FS.writeText(FS.resolvePath('fail-loop-serve', root), '')
      for (const name of ['.config/bootstrap-tao-dev-env', 'agent']) {
        const path = FS.resolvePath(name, root)
        await FS.writeText(path, '#!/bin/sh\nprintf "%s\\n" "$*" >> calls.log\n')
        await FS.chmod(path, 0o755)
      }
      const result = await CLI.run('/bin/sh', {
        args: ['-c', 'du() { :; }; df() { :; }; . "$0"', guest, 'cached'],
        cwd: root,
      })
      Expect(result.exitCode).toBe(1)
      const calls = (await FS.readText(FS.resolvePath('calls.log', root))).trim().split('\n')
      Expect(calls.filter(call => call.startsWith('journey '))).toEqual([
        'journey loop-start',
        'journey loop-serve',
        'journey loop-stop',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('records profile tool versions in the tools-only VM before completing bootstrap', async () => {
    const root = await mkGitTestDir('tao-contributor-linux-tools-')
    try {
      const guest = FS.resolvePath(`${ENVIRONMENT}/guest-smoke.sh`, root)
      await FS.writeText(guest, await FS.readText(Repo.resolvePath(`${ENVIRONMENT}/guest-smoke.sh`)))
      await writeVersionTools(root)
      const bootstrap = FS.resolvePath('.config/bootstrap-tao-dev-env', root)
      await FS.writeText(bootstrap, '#!/bin/sh\nprintf "%s\\n" "$*"\n')
      await FS.chmod(bootstrap, 0o755)
      const result = await CLI.run('/bin/sh', {
        // Model the empty guest base and keep disk accounting away from the host.
        args: ['-c', 'command() { return 1; }; du() { :; }; df() { :; }; . "$0"', guest, 'tools'],
        cwd: root,
      })
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('--install-nix --tools-only')
      const versions = await FS.readText(
        FS.resolvePath('.artifacts/contributor-linux/guest-tools/tool-versions.log', root),
      )
      for (const tool of ['bun', 'node', 'zsh', 'just', 'python3', 'nix']) {
        Expect(versions).toContain(`${tool} (${root}/.devenv/profile/bin/${tool}): ${tool} fixture-version --version`)
      }
      Expect(await FS.exists(FS.resolvePath('.git', root))).toBe(false)
      // The container-only emulation options are gone: the guest takes exactly its mode.
      const extra = await CLI.run('/bin/sh', { args: [guest, 'tools', '--qemu-compat'], cwd: root })
      Expect(extra.exitCode).toBe(2)
    } finally {
      await FS.remove(root)
    }
  })
})

type Fixture = { root: string; home: string; log: string; env: Platform.ProcessEnv }

const JOURNEY_ACTIONS = ['loop-start', 'loop-serve', 'toolchain-change', 'loop-restart', 'loop-reflect', 'loop-stop']

/** The real journey order with a recording action script; a `fail-<action>` file makes that action fail. */
async function writeJourneyStub(root: string): Promise<void> {
  await FS.writeText(
    FS.resolvePath(`${ENVIRONMENT}/contributor-journey.sh`, root),
    await FS.readText(Repo.resolvePath(`${ENVIRONMENT}/contributor-journey.sh`)),
  )
  await FS.writeText(
    FS.resolvePath(`${ENVIRONMENT}/contributor-journey-step.sh`, root),
    'printf "journey %s\\n" "$1" >> calls.log\n[ ! -f "fail-$1" ]\n',
  )
}

async function writeVersionTools(root: string): Promise<void> {
  for (const tool of ['bun', 'node', 'zsh', 'just', 'python3', 'nix']) {
    const executable = FS.resolvePath(`.devenv/profile/bin/${tool}`, root)
    await FS.writeText(executable, `#!/bin/sh\nprintf '${tool} fixture-version %s\\n' "$*"\n`)
    await FS.chmod(executable, 0o755)
  }
}

async function readCalls(fixture: Fixture): Promise<string[]> {
  return (await FS.readText(fixture.log)).trim().split('\n')
}

async function evidenceDirectory(fixture: Fixture): Promise<string> {
  return (await FS.readText(FS.resolvePath('.artifacts/contributor-linux/latest.txt', fixture.root))).trim()
}

async function commitFile(fixture: Fixture, path: string, content: string): Promise<void> {
  await FS.writeText(FS.resolvePath(path, fixture.root), content)
  await CLI.mustRun('git', { args: ['add', path], cwd: fixture.root })
  await CLI.mustRun('git', {
    args: [
      '-c',
      'user.name=Tao Test',
      '-c',
      'user.email=tao@example.test',
      'commit',
      '--quiet',
      '-m',
      `Change ${path}`,
    ],
    cwd: fixture.root,
  })
}

/**
 * A committed fixture repository holding the real runner and VM library, a recording `tart`, and a recording
 * stand-in for the checkout Bun that answers the VM helper's commands. No VM, network, or Tart store is touched.
 * `FAKE_GUEST_EXIT` fails the guest journey, only for the phase named by `FAKE_GUEST_EXIT_PHASE` when given.
 */
async function withFixture(test: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkGitTestDir('tao-contributor-linux-')
  try {
    const files: Record<string, string> = {
      '.gitignore': '.artifacts/\n',
      '.config/bootstrap-tao-dev-env': '#!/bin/sh\nexit 0\n',
      'devenv.lock': '{}\n',
      'tracked.txt': 'committed',
    }
    for (const path of [ENTRY, VM_LIBRARY, `${ENVIRONMENT}/guest-smoke.sh`]) {
      files[path] = await FS.readText(Repo.resolvePath(path))
    }
    await initGitTestRepository(root, { commit: { files } })
    const home = FS.resolvePath('home', root)
    const bin = FS.resolvePath('.artifacts/fake-bin', root)
    const log = FS.resolvePath('.artifacts/calls.log', root)
    const stopped = FS.resolvePath('.artifacts/stopped', root)
    const guest = FS.resolvePath('.artifacts/fake-guest', root)
    for (const phase of ['cold', 'tools', 'cached']) {
      await FS.writeText(
        FS.resolvePath(`contributor-linux/guest-${phase}/steps.tsv`, guest),
        'bootstrap\t0\t30\nsetup\t0\t12\n',
      )
    }
    await FS.writeText(FS.resolvePath('logs/check.log', guest), 'workflow log\n')
    await FS.mkdir(FS.resolvePath('.artifacts/pushed', root))
    const executables: Record<string, string> = {
      tart: [
        '#!/bin/sh',
        'printf "tart %s\\n" "$*" >> "$FAKE_LOG"',
        'case "$1" in',
        '  --version) printf "2.32.1\\n" ;;',
        // The tools cache exists once a clone has been renamed to its name.
        '  get) case "$2" in tao-linux-tools-*) [ "$(cat "$FAKE_CACHE" 2>/dev/null)" = "$2" ] || exit 1 ;; esac; printf "{}\\n" ;;',
        '  rename) printf "%s\\n" "$3" > "$FAKE_CACHE" ;;',
        '  stop) : > "$FAKE_STOPPED" ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n'),
      bun: [
        '#!/bin/sh',
        'printf "helper %s\\n" "$*" | sed "s|^helper run [^ ]* |helper |" >> "$FAKE_LOG"',
        '[ "$1" = run ] || exit 64',
        'shift 2',
        'case "$1" in',
        '  idle) exit 0 ;;',
        '  push) cat > "$FAKE_PUSHED/$2.tar"; exit 0 ;;',
        '  boot)',
        '    rm -f "$FAKE_STOPPED"',
        '    trap "exit 0" TERM',
        '    while [ ! -f "$FAKE_STOPPED" ]; do sleep 0.1; done',
        '    exit 0 ;;',
        '  exec)',
        '    shift 3',
        '    case "$1 $2" in',
        '      "/bin/sh /home/admin/tao-harness/input/run.sh")',
        '        printf "guest console\\n"',
        '        [ -z "${FAKE_GUEST_EXIT_PHASE:-}" ] || [ "$3" = "$FAKE_GUEST_EXIT_PHASE" ] || exit 0',
        '        exit "${FAKE_GUEST_EXIT:-0}" ;;',
        '      "/usr/bin/tar -cf") [ "${FAKE_COLLECT:-}" != fail ] || exit 9; exec /usr/bin/tar -cf - -C "$FAKE_GUEST" "$6" ${7:-} ;;',
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
    await test({
      root,
      home,
      log,
      env: {
        HOME: home,
        PATH: `${bin}:/usr/bin:/bin`,
        FAKE_LOG: log,
        FAKE_STOPPED: stopped,
        FAKE_CACHE: FS.resolvePath('.artifacts/cache-vm.txt', root),
        FAKE_PUSHED: FS.resolvePath('.artifacts/pushed', root),
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
