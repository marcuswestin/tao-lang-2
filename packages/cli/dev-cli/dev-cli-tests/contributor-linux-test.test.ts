import { CLI, FS, Platform, Repo } from '@shared'
import { Describe, Expect, initGitTestRepository, mkGitTestDir, Test } from '@shared/test'

const ENVIRONMENT = 'packages/cli/dev-cli/dev-cli-src/environment'
const ENTRY = `${ENVIRONMENT}/contributor-linux-test.sh`

Describe('contributor Linux container runner', () => {
  Test('rejects extra arguments before consulting Docker', async () => {
    await withFixture(async fixture => {
      for (
        const args of [
          ['--mode', 'host'],
          ['--probe', '--privileged'],
          ['--mode'],
          ['--mount', '/'],
          [
            '--native-arm64',
            '--qemu-compat',
          ],
          ['--native-arm64', '--mode', 'both'],
          ['--mode', 'cached', '--native-arm64'],
          [
            '--qemu-compat',
            '--mode',
            'cached',
          ],
        ]
      ) {
        const result = await run(fixture, args)
        Expect(result.exitCode).toBe(2)
      }
      Expect(await FS.exists(fixture.log)).toBe(false)
    })
  })

  Test('probes fixed read-only Docker operations and leaves quota proof pending', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, ['--probe'])
      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(fixture.log)).trim().split('\n')).toEqual([
        'version',
        'info',
        'info --format {{.Architecture}} {{.Driver}} {{json .DriverStatus}}',
      ])
      Expect(result.stdout).toContain('disk_hard_limit=enforcement-not-proven')
      Expect(result.stdout).toContain('not enforcement of the 30 GiB budget')
    })
  })

  Test('rejects inspection paths, patterns, and option injection before consulting Docker', async () => {
    await withFixture(async fixture => {
      for (
        const id of ['../run', '*', '--all', '20260926T161634Z-', '20260926T161634Z-x-123', '20260926T161634Z-123/']
      ) {
        Expect((await run(fixture, ['--inspect-run', id])).exitCode).toBe(2)
      }
      Expect(await FS.exists(fixture.log)).toBe(false)
    })
  })

  Test('inspects only the selected run without creating or removing Docker resources', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, ['--inspect-run', '20260926T161634Z-57262'])
      Expect(result.exitCode).toBe(0)
      Expect((await FS.readText(fixture.log)).trim().split('\n')).toEqual([
        'version',
        'info',
        'info --format {{.Architecture}} {{.Driver}} {{json .DriverStatus}}',
        'image ls --all --filter reference=tao-contributor-linux-base:20260926T161634Z-57262 --format {{.ID}} {{.Repository}}:{{.Tag}}',
        'container ls --all --no-trunc --filter name=^/tao-contributor-linux-20260926T161634Z-57262-(cold|tools|cached)$ --format {{.ID}} {{.Names}} {{.Status}} owner={{.Label "tao.owner"}} run={{.Label "tao.run"}}',
      ])
      Expect(result.stdout).toContain('No run-specific images remain')
      Expect(result.stdout).toContain('No run-specific containers remain')
      const output = await latestOutput(fixture)
      Expect(await FS.readText(`${output}/inspection.txt`)).toContain('state=complete')
      Expect(await FS.exists(`${output}/checkout.tar`)).toBe(false)
    })
  })

  Test('reports retained inspection resources and keeps daemon failures unknown', async () => {
    await withFixture(async fixture => {
      await FS.writeText(fixture.container, 'retained-container\n')
      const result = await run(fixture, ['--inspect-run', '20260926T161634Z-57262'])
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('retained-container')
      Expect(result.stdout).not.toContain('No run-specific containers remain')
      const failed = await run(fixture, ['--inspect-run', '20260926T161634Z-57262'], 'disconnected')
      Expect(failed.exitCode).toBe(5)
      Expect(failed.stdout).not.toContain('No run-specific')
      Expect(await FS.readText(`${await latestOutput(fixture)}/inspection.txt`)).toContain('state=unknown')
      Expect(await FS.exists(fixture.container)).toBe(true)
    })
  })

  Test('snapshots logs from an exact owned live container without executing or stopping it', async () => {
    await withFixture(async fixture => {
      const id = '20260926T161634Z-57262'
      const name = `tao-contributor-linux-${id}-cold`
      await FS.writeText(
        fixture.container,
        `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ${name} Up 10 minutes owner=contributor-linux-test run=${id}\n`,
      )
      await FS.writeText(`${fixture.container}.labels`, `contributor-linux-test ${id}\n`)
      Expect((await run(fixture, ['--inspect-run', id])).exitCode).toBe(0)
      let calls = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(
        calls.filter(call =>
          call.startsWith(
            'cp aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:/workspace/.artifacts/logs ',
          )
        ),
      ).toHaveLength(1)
      Expect(calls.some(call => /^(exec|start|stop|rm|build|commit) /u.test(call))).toBe(false)
      Expect(calls.filter(call => call.startsWith('top '))).toHaveLength(1)
      Expect(calls.filter(call => call.startsWith('stats --no-stream '))).toHaveLength(1)
      Expect(await FS.exists(fixture.container)).toBe(true)
      await FS.writeText(`${fixture.container}.labels`, 'foreign-owner another-run\n')
      Expect((await run(fixture, ['--inspect-run', id])).exitCode).toBe(0)
      calls = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(calls.filter(call => call.startsWith('cp '))).toHaveLength(1)
    })
  })

  Test('records unknown inspection state before the first Docker request can fail', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, ['--inspect-run', '20260926T161634Z-57262'], 'version')
      Expect(result.exitCode).toBe(6)
      const output = await latestOutput(fixture)
      Expect(result.stdout).toContain(`Contributor Linux evidence: ${output}`)
      Expect(await FS.readText(`${output}/inspection.txt`)).toContain('state=unknown')
      Expect((await FS.readText(fixture.log)).trim()).toBe('version')
    })
  })

  Test('recovers only an exited owned run after collecting its complete guest evidence', async () => {
    await withFixture(async fixture => {
      const id = '20260928T042401Z-16239'
      await seedRecovery(fixture, id, 'exited')
      const result = await run(fixture, ['--recover-run', id])
      Expect(result.stderr).toBe('')
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('recovery complete')
      const calls = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(calls.filter(call => call.startsWith('rm aaaaaaaaa'))).toHaveLength(1)
      Expect(calls.filter(call => call === `image rm tao-contributor-linux-base:${id}`)).toHaveLength(1)
      Expect(calls.some(call => /^(stop|start|exec|build|commit|rm --force) /u.test(call))).toBe(false)
      Expect(calls.filter(call => call.startsWith('logs aaaaaaaaa'))).toHaveLength(1)
      Expect(calls.filter(call => call.startsWith('cp aaaaaaaaa') && call.includes(':/workspace/.artifacts/')))
        .toHaveLength(2)
      Expect(await FS.exists(fixture.container)).toBe(false)
      const attempt = recoveryAttempt(result.stdout)
      Expect(await FS.readText(`${attempt}/cold/guest-console.txt`)).toContain('complete guest console')
      Expect(await FS.readText(`${attempt}/cold/guest/steps.tsv`)).toContain('check')
      Expect(await FS.readText(`${attempt}/cold/workflow-logs/complete.log`)).toContain('complete workflow log')
      Expect(await FS.readText(`${attempt}/result.txt`)).toContain('state=complete')
      const again = await run(fixture, ['--recover-run', id])
      Expect(again.exitCode).toBe(0)
      const repeated = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(repeated.filter(call => call.startsWith('rm aaaaaaaaa'))).toHaveLength(1)
      Expect(repeated.filter(call => call === `image rm tao-contributor-linux-base:${id}`)).toHaveLength(1)
    })
  })

  Test('refuses a live, foreign, or ambiguous guest without removing any resource', async () => {
    for (const [state, failure] of [['running', ''], ['exited', 'foreign'], ['exited', 'disconnected']] as const) {
      await withFixture(async fixture => {
        const id = '20260928T042401Z-16239'
        await seedRecovery(fixture, id, state)
        const result = await run(fixture, ['--recover-run', id], failure)
        Expect(result.exitCode).not.toBe(0)
        const calls = (await FS.readText(fixture.log)).trim().split('\n')
        Expect(calls.some(call => /^(rm |image rm |cp |logs )/u.test(call))).toBe(false)
        Expect(await FS.exists(fixture.container)).toBe(true)
      })
    }
  })

  Test('leaves an exited guest and its base in place when complete logs cannot be copied', async () => {
    await withFixture(async fixture => {
      const id = '20260928T042401Z-16239'
      await seedRecovery(fixture, id, 'exited')
      const result = await run(fixture, ['--recover-run', id], 'collect')
      Expect(result.exitCode).not.toBe(0)
      const calls = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(calls.some(call => /^(rm |image rm )/u.test(call))).toBe(false)
      Expect(await FS.exists(fixture.container)).toBe(true)
      Expect(await FS.exists(FS.resolvePath('.artifacts/base-image.txt', fixture.root))).toBe(true)
    })
  })

  Test('refuses a base tag with a different image ID and a guest that changes state', async () => {
    await withFixture(async fixture => {
      const id = '20260928T042401Z-16239'
      await seedRecovery(fixture, id, 'exited')
      const changedBase = await run({
        ...fixture,
        env: { ...fixture.env, TAO_TEST_DOCKER_BASE_ID: 'sha256:another-image' },
      }, ['--recover-run', id])
      Expect(changedBase.exitCode).toBe(1)
      Expect(changedBase.stderr).toContain('no longer matches this run')
      const stateChanged = await run(fixture, ['--recover-run', id], 'state-change')
      Expect(stateChanged.exitCode).toBe(1)
      Expect(stateChanged.stderr).toContain('changed state during recovery')
      const calls = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(calls.some(call => /^(rm |image rm )/u.test(call))).toBe(false)
      Expect(await FS.exists(fixture.container)).toBe(true)
    })
  })

  Test('rejects recovery without an exact existing run record before consulting Docker', async () => {
    await withFixture(async fixture => {
      for (const id of ['../run', '*', '20260928T042401Z-', '20260928T042401Z-16239/']) {
        Expect((await run(fixture, ['--recover-run', id])).exitCode).toBe(2)
      }
      Expect((await run(fixture, ['--recover-run', '20260928T042401Z-16239'])).exitCode).toBe(1)
      Expect(await FS.exists(fixture.log)).toBe(false)
    })
  })

  Test('uses committed sources and bounded independent cold, tools, and cached containers', async () => {
    await withFixture(async fixture => {
      await FS.writeText(FS.resolvePath('untracked-secret.txt', fixture.root), 'private')
      await FS.writeText(FS.resolvePath('tracked.txt', fixture.root), 'dirty')
      const result = await run(fixture)
      Expect(result.exitCode).toBe(0)
      const calls = (await FS.readText(fixture.log)).trim().split('\n')
      const creates = calls.filter(call => call.startsWith('create '))
      Expect(creates).toHaveLength(3)
      for (const [index, mode] of ['cold', 'tools', 'cached'].entries()) {
        Expect(creates[index]).toContain('--platform linux/amd64 --cpus 4 --memory 16g --memory-swap 16g')
        Expect(creates[index]).toContain(`contributor-linux ${mode}`)
        Expect(creates[index]).toContain('/usr/bin/timeout --signal=TERM --kill-after=30s 7200')
        Expect(creates[index]).not.toContain('--mount')
        Expect(creates[index]).not.toContain('--privileged')
        Expect(creates[index]).not.toContain('--volume')
      }
      Expect(calls.filter(call => call.startsWith('rm --force '))).toHaveLength(3)
      Expect(calls.filter(call => call.startsWith('image rm '))).toHaveLength(1)
      Expect(calls.some(call => call.includes('prune'))).toBe(false)
      const output = (await FS.readText(FS.resolvePath('.artifacts/contributor-linux/latest.txt', fixture.root))).trim()
      const archive = await CLI.run('tar', { args: ['-xOf', `${output}/checkout.tar`, 'tracked.txt'] })
      Expect(archive.exitCode).toBe(0)
      Expect(archive.stdout).toBe('committed')
      const listing = await CLI.run('tar', { args: ['-tf', `${output}/checkout.tar`] })
      Expect(listing.exitCode).toBe(0)
      Expect(listing.stdout).not.toContain('untracked-secret.txt')
      Expect(listing.stdout).not.toContain('node_modules')
      Expect(await FS.readText(`${output}/resources.txt`)).toContain('base_image_build_cpu_memory_limits=not-enforced')
      Expect(await FS.readText(`${output}/cache-ownership.txt`)).toContain('image=tao-contributor-linux-tools:')
    })
  })

  Test('collects and cleans a failed cold container while still attempting cached smoke', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, [], 'cold')
      Expect(result.exitCode).toBe(1)
      Expect(result.stdout).toContain('base build output')
      Expect(result.stdout).toContain('guest output before failure')
      Expect(result.stdout).toContain('cold finished (exit 7,')
      const output = await latestOutput(fixture)
      const guestLog = FS.resolvePath(['console', 'log'].join('.'), `${output}/cold`)
      Expect(await FS.readText(guestLog)).toContain('guest output before failure')
      Expect(await FS.readText(`${output}/cold/result.txt`)).toContain('exit_code=7')
      const calls = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(calls.filter(call => call.startsWith('create '))).toHaveLength(3)
      Expect(calls.filter(call => call.startsWith('rm --force '))).toHaveLength(3)
      Expect(calls.filter(call => call.startsWith('cp ') && call.includes(':/workspace/.artifacts/'))).toHaveLength(5)
      Expect(calls.some(call => call.startsWith('commit '))).toBe(true)
    })
  })

  Test('scopes the fixed QEMU experiment to guest arguments and a separate tool cache', async () => {
    await withFixture(async fixture => {
      Expect((await run(fixture)).exitCode).toBe(0)
      const baseline = await FS.readText(`${await latestOutput(fixture)}/cache-ownership.txt`)
      const identities = new Set([baseline])
      for (const flag of ['--qemu-guest-base', '--qemu-compat']) {
        Expect((await run(fixture, [flag])).exitCode).toBe(0)
        const output = await latestOutput(fixture)
        const resources = await FS.readText(`${output}/resources.txt`)
        Expect(resources).toContain('qemu_guest_base_experiment=1')
        Expect(resources).toContain(`qemu_nix_filter_disabled=${flag === '--qemu-compat' ? 1 : 0}`)
        const identity = await FS.readText(`${output}/cache-ownership.txt`)
        Expect(identities.has(identity)).toBe(false)
        identities.add(identity)
        const calls = (await FS.readText(fixture.log)).trim().split('\n')
        const creates = calls.filter(call => call.startsWith('create ') && call.endsWith(flag))
        Expect(creates).toHaveLength(3)
        for (const [index, mode] of ['cold', 'tools', 'cached'].entries()) {
          Expect(creates[index]).toContain(`contributor-linux ${mode} ${flag}`)
          Expect(creates[index]).not.toContain('--privileged')
          Expect(creates[index]).not.toContain('--security-opt')
          Expect(creates[index]).not.toContain('--cap-add')
          Expect(creates[index]).not.toContain('--env')
        }
        const native = { ...fixture, env: { ...fixture.env, TAO_TEST_DOCKER_ARCH: 'x86_64' } }
        const rejected = await run(native, [flag])
        Expect(rejected.exitCode).toBe(2)
        Expect(rejected.stderr).toContain('requires an arm64 Docker daemon')
      }
    })
  })

  Test('runs the native ARM control without QEMU settings and keeps its cache separate', async () => {
    await withFixture(async fixture => {
      Expect((await run(fixture)).exitCode).toBe(0)
      const baseline = await FS.readText(`${await latestOutput(fixture)}/cache-ownership.txt`)
      const native = {
        ...fixture,
        env: {
          ...fixture.env,
          TAO_TEST_DOCKER_IMAGE_FORMAT:
            '{{if and (eq .Os "linux") (eq .Architecture "arm64") .RootFS.Layers .Config}}linux/arm64 {{json .RootFS.Layers}} {{json .Config}}{{else}}invalid{{end}}',
          TAO_TEST_DOCKER_BASE_CONTENTS: 'linux/arm64 ["sha256:layer"] {"WorkingDir":"/workspace"}',
        },
      }
      Expect((await run(native, ['--native-arm64'])).exitCode).toBe(0)
      const output = await latestOutput(fixture)
      const resources = await FS.readText(`${output}/resources.txt`)
      Expect(resources).toContain('platform=linux/arm64')
      Expect(resources).toContain('daemon_emulation=not-required')
      Expect(resources).toContain('qemu_guest_base_experiment=0')
      Expect(resources).toContain('qemu_nix_filter_disabled=0')
      Expect(await FS.readText(`${output}/cache-ownership.txt`)).not.toBe(baseline)
      const calls = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(calls.filter(call => call.startsWith('build --platform linux/arm64 '))).toHaveLength(1)
      const creates = calls.filter(call => call.startsWith('create ') && call.includes('--platform linux/arm64 '))
      Expect(creates).toHaveLength(3)
      for (const call of creates) {
        Expect(call).not.toContain('--qemu')
      }
      Expect(
        (await run({ ...native, env: { ...native.env, TAO_TEST_DOCKER_ARCH: 'x86_64' } }, ['--native-arm64'])).exitCode,
      ).toBe(2)
      // A daemon returning an image for the wrong architecture must not seed the cache.
      Expect(
        (await run({ ...native, env: { ...native.env, TAO_TEST_DOCKER_BASE_CONTENTS: 'invalid' } }, ['--native-arm64']))
          .exitCode,
      ).toBe(1)
    })
  })

  Test('runs only native ARM cached acceptance when cold already completed', async () => {
    await withFixture(async fixture => {
      const native = {
        ...fixture,
        env: {
          ...fixture.env,
          TAO_TEST_DOCKER_IMAGE_FORMAT:
            '{{if and (eq .Os "linux") (eq .Architecture "arm64") .RootFS.Layers .Config}}linux/arm64 {{json .RootFS.Layers}} {{json .Config}}{{else}}invalid{{end}}',
          TAO_TEST_DOCKER_BASE_CONTENTS: 'linux/arm64 ["sha256:layer"] {"WorkingDir":"/workspace"}',
        },
      }
      const result = await run(native, ['--native-arm64', '--mode', 'cached'])
      Expect(result.exitCode).toBe(0)
      const output = await latestOutput(fixture)
      Expect(await FS.readText(`${output}/resources.txt`)).toContain('platform=linux/arm64')
      Expect(await FS.exists(`${output}/cold`)).toBe(false)
      Expect(await FS.exists(`${output}/tools/guest`)).toBe(true)
      Expect(await FS.exists(`${output}/cached/guest`)).toBe(true)
      const calls = (await FS.readText(fixture.log)).trim().split('\n')
      const creates = calls.filter(call => call.startsWith('create ') && call.includes('--platform linux/arm64 '))
      Expect(creates).toHaveLength(2)
      Expect(creates[0]).toContain('contributor-linux tools')
      Expect(creates[1]).toContain('contributor-linux cached')
    })
  })

  Test('cleans an owned container when creation succeeds but its client reports failure', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, ['--mode', 'cold'], 'create-after')
      Expect(result.exitCode).toBe(1)
      const calls = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(calls.filter(call => call.startsWith('rm --force '))).toHaveLength(1)
      Expect(calls.some(call => call.startsWith('inspect --format '))).toBe(true)
      Expect(await FS.exists(fixture.container)).toBe(false)
      Expect(await FS.readText(`${await latestOutput(fixture)}/cold/result.txt`)).toContain('exit_code=9')
    })
  })

  Test('confirms genuine absence after a rejected create without issuing a remove', async () => {
    await withFixture(async fixture => {
      Expect((await run(fixture, ['--mode', 'cold'], 'create-before')).exitCode).toBe(1)
      const calls = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(calls.some(call => call.startsWith('container ls --all --filter name=^/'))).toBe(true)
      Expect(calls.some(call => call.startsWith('rm '))).toBe(false)
      Expect(await FS.exists(fixture.container)).toBe(false)
    })
  })

  Test('cleans the intended owned container when interrupted during creation', async () => {
    await withFixture(async fixture => {
      Expect((await run(fixture, ['--mode', 'cold'], 'interrupt')).exitCode).toBe(143)
      Expect(await FS.exists(fixture.container)).toBe(false)
      Expect((await FS.readText(fixture.log)).split('\n').filter(call => call.startsWith('rm --force ')))
        .toHaveLength(1)
      Expect(await FS.readText(`${await latestOutput(fixture)}/cold/result.txt`)).toBe('state=running\n')
    })
  })

  Test('does not mistake failed Docker inspection and listing for confirmed absence', async () => {
    await withFixture(async fixture => {
      Expect((await run(fixture, ['--mode', 'cold'], 'disconnected')).exitCode).toBe(1)
      Expect(await FS.exists(fixture.container)).toBe(true)
      Expect((await FS.readText(fixture.log)).split('\n').some(call => call.startsWith('rm '))).toBe(false)
    })
  })

  Test('preserves a container with different ownership after an ambiguous create failure', async () => {
    await withFixture(async fixture => {
      const result = await run(fixture, ['--mode', 'cold'], 'foreign')
      Expect(result.exitCode).toBe(1)
      Expect(result.stderr).toContain('Refusing to remove container with different ownership')
      Expect(await FS.exists(fixture.container)).toBe(true)
      Expect((await FS.readText(fixture.log)).split('\n').some(call => call.startsWith('rm '))).toBe(false)
    })
  })

  Test('records cache commit and container removal failures in the final tools result', async () => {
    for (const [failure, exitCode] of [['commit', 7], ['remove', 8]] as const) {
      await withFixture(async fixture => {
        Expect((await run(fixture, ['--mode', 'cached'], failure)).exitCode).toBe(1)
        const output = await latestOutput(fixture)
        Expect(await FS.readText(`${output}/tools/result.txt`)).toContain(`state=complete\nexit_code=${exitCode}`)
        Expect(
          (await FS.readText(fixture.log)).split('\n').some(call =>
            call.startsWith('create ') && call.endsWith('contributor-linux cached')
          ),
        ).toBe(false)
      })
    }
  })

  Test('reuses the tool image across unrelated source commits', async () => {
    await withFixture(async fixture => {
      Expect((await run(fixture, ['--mode', 'cached'])).exitCode).toBe(0)
      await FS.writeText(FS.resolvePath('tracked.txt', fixture.root), 'another commit')
      await CLI.mustRun('git', { args: ['add', 'tracked.txt'], cwd: fixture.root })
      await CLI.mustRun('git', {
        args: [
          '-c',
          'user.name=Tao Test',
          '-c',
          'user.email=tao@example.test',
          'commit',
          '--quiet',
          '-m',
          'Source only',
        ],
        cwd: fixture.root,
      })
      Expect((await run(fixture, ['--mode', 'cached'])).exitCode).toBe(0)
      const calls = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(calls.filter(call => call.startsWith('commit '))).toHaveLength(1)
      Expect(calls.filter(call => call.startsWith('create ') && call.endsWith('contributor-linux cached')))
        .toHaveLength(2)
    })
  })

  Test('tool cache ignores attestations but tracks ordered layers and complete runtime config', async () => {
    await withFixture(async fixture => {
      const contents = 'linux/amd64 ["sha256:one","sha256:two"] {"WorkingDir":"/workspace"}'
      const runWith = (baseId: string, baseContents = contents) =>
        run({
          ...fixture,
          env: { ...fixture.env, TAO_TEST_DOCKER_BASE_ID: baseId, TAO_TEST_DOCKER_BASE_CONTENTS: baseContents },
        }, ['--mode', 'cached'])
      Expect((await runWith('sha256:first-attestation')).exitCode).toBe(0)
      const initial = await FS.readText(`${await latestOutput(fixture)}/cache-ownership.txt`)
      Expect(await FS.readText(`${await latestOutput(fixture)}/base-cache-identity.txt`)).toBe(`${contents}\n`)
      Expect((await runWith('sha256:second-attestation')).exitCode).toBe(0)
      Expect(await FS.readText(`${await latestOutput(fixture)}/base-identity.txt`)).toContain('second-attestation')
      Expect(await FS.readText(`${await latestOutput(fixture)}/cache-ownership.txt`)).toBe(initial)
      for (
        const changed of [
          contents.replace('sha256:one', 'sha256:new'),
          contents.replace('["sha256:one","sha256:two"]', '["sha256:two","sha256:one"]'),
          contents.replace('/workspace', '/another'),
        ]
      ) {
        Expect((await runWith('sha256:second-attestation', changed)).exitCode).toBe(0)
        Expect(await FS.readText(`${await latestOutput(fixture)}/cache-ownership.txt`)).not.toBe(initial)
      }
      Expect((await runWith('sha256:invalid', 'invalid')).exitCode).toBe(1)
      const calls = (await FS.readText(fixture.log)).trim().split('\n')
      Expect(calls.filter(call => call.startsWith('commit '))).toHaveLength(4)
    })
  })

  Test('runs guest wrappers with a clean PATH and preserves a failed check through later passing lanes', async () => {
    const root = await mkGitTestDir('tao-contributor-linux-guest-')
    try {
      const guest = FS.resolvePath(`${ENVIRONMENT}/guest-smoke.sh`, root)
      await FS.writeText(guest, await FS.readText(Repo.resolvePath(`${ENVIRONMENT}/guest-smoke.sh`)))
      await FS.writeText(FS.resolvePath('.gitignore', root), '.artifacts/\ncalls.log\n')
      await writeVersionTools(root)
      for (const name of ['bootstrap-tao-dev-env', 'agent']) {
        const path = FS.resolvePath(name, root)
        await FS.writeText(
          path,
          [
            '#!/bin/sh',
            'printf "%s|%s|%s\\n" "$*" "$PATH" "${TAO_TEST_INHERITED-unset}" >> calls.log',
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
      Expect((await FS.readText(FS.resolvePath('calls.log', root))).trim().split('\n')).toEqual([
        '|/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin|unset',
        'help|/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin|unset',
        'setup --verbose|/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin|unset',
        'test-file packages/language/parser/parser-tests/dialect.test.ts --verbose|/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin|unset',
        'check --verbose|/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin|unset',
        'test-all --verbose|/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin|unset',
        'verify --verbose|/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin|unset',
      ])
    } finally {
      await FS.remove(root)
    }
  })

  Test('records profile tool versions in the tools-only image before completing bootstrap', async () => {
    const root = await mkGitTestDir('tao-contributor-linux-tools-')
    try {
      const guest = FS.resolvePath(`${ENVIRONMENT}/guest-smoke.sh`, root)
      await FS.writeText(guest, await FS.readText(Repo.resolvePath(`${ENVIRONMENT}/guest-smoke.sh`)))
      await writeVersionTools(root)
      const bootstrap = FS.resolvePath('bootstrap-tao-dev-env', root)
      await FS.writeText(
        bootstrap,
        '#!/bin/sh\nprintf "%s|%s|%s\\n" "$*" "${QEMU_GUEST_BASE-unset}" "${NIX_CONFIG-unset}"\n',
      )
      await FS.chmod(bootstrap, 0o755)
      const result = await CLI.run('/bin/sh', {
        // Model the empty guest base and keep disk accounting away from the host.
        args: ['-c', 'command() { return 1; }; du() { :; }; df() { :; }; . "$0"', guest, 'tools'],
        cwd: root,
      })
      Expect(result.exitCode).toBe(0)
      Expect(result.stdout).toContain('--install-nix --tools-only')
      Expect(result.stdout).toContain('--install-nix --tools-only|unset|unset')
      const experiment = await CLI.run('/bin/sh', {
        args: ['-c', 'command() { return 1; }; du() { :; }; df() { :; }; . "$0"', guest, 'tools', '--qemu-guest-base'],
        cwd: root,
      })
      Expect(experiment.exitCode).toBe(0)
      Expect(experiment.stdout).toContain('--install-nix --tools-only|0x800000000000|unset')
      const compatible = await CLI.run('/bin/sh', {
        args: ['-c', 'command() { return 1; }; du() { :; }; df() { :; }; . "$0"', guest, 'tools', '--qemu-compat'],
        cwd: root,
      })
      Expect(compatible.exitCode).toBe(0)
      Expect(compatible.stdout).toContain('--install-nix --tools-only|0x800000000000|filter-syscalls = false')
      const versions = await FS.readText(
        FS.resolvePath('.artifacts/contributor-linux/guest-tools/tool-versions.log', root),
      )
      for (const tool of ['bun', 'node', 'zsh', 'just', 'python3', 'nix']) {
        Expect(versions).toContain(`${tool} (${root}/.devenv/profile/bin/${tool}): ${tool} fixture-version --version`)
      }
      Expect(await FS.exists(FS.resolvePath('.git', root))).toBe(false)
    } finally {
      await FS.remove(root)
    }
  })
})

type Fixture = { root: string; log: string; container: string; env: Platform.ProcessEnv }

function recoveryAttempt(stdout: string): string {
  const match = stdout.match(/Contributor Linux recovery evidence: (.+)/u)
  Expect(match).not.toBeNull()
  return match?.[1] ?? ''
}

async function seedRecovery(fixture: Fixture, id: string, state: string): Promise<void> {
  const output = FS.resolvePath(`.artifacts/contributor-linux/${id}`, fixture.root)
  await FS.writeText(`${output}/resources.txt`, 'platform=linux/amd64\n')
  await FS.writeText(`${output}/source-commit.txt`, 'fixture\n')
  await FS.writeText(`${output}/base-identity.txt`, 'sha256:fixture-base\n')
  await FS.writeText(
    fixture.container,
    `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa tao-contributor-linux-${id}-cold\n`,
  )
  await FS.writeText(`${fixture.container}.labels`, `contributor-linux-test ${id}\n`)
  await FS.writeText(`${fixture.container}.state`, state)
  await FS.writeText(FS.resolvePath('.artifacts/base-image.txt', fixture.root), `tao-contributor-linux-base:${id}\n`)
}

async function writeVersionTools(root: string): Promise<void> {
  for (const tool of ['bun', 'node', 'zsh', 'just', 'python3', 'nix']) {
    const executable = FS.resolvePath(`.devenv/profile/bin/${tool}`, root)
    await FS.writeText(executable, `#!/bin/sh\nprintf '${tool} fixture-version %s\\n' "$*"\n`)
    await FS.chmod(executable, 0o755)
  }
}

async function latestOutput(fixture: Fixture): Promise<string> {
  return (await FS.readText(FS.resolvePath('.artifacts/contributor-linux/latest.txt', fixture.root))).trim()
}

async function withFixture(test: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = await mkGitTestDir('tao-contributor-linux-')
  try {
    const files: Record<string, string> = {
      '.gitignore': '.artifacts/\n',
      'bootstrap-tao-dev-env': '#!/bin/sh\nexit 0\n',
      'devenv.lock': '{}\n',
      'tracked.txt': 'committed',
    }
    for (const name of ['contributor-linux-test.sh', 'Dockerfile', 'guest-smoke.sh']) {
      files[`${ENVIRONMENT}/${name}`] = await FS.readText(Repo.resolvePath(`${ENVIRONMENT}/${name}`))
    }
    await initGitTestRepository(root, { commit: { files } })
    const bin = FS.resolvePath('.artifacts/fake-bin', root)
    const log = FS.resolvePath('.artifacts/docker.log', root)
    const cache = FS.resolvePath('.artifacts/cache.txt', root)
    const container = FS.resolvePath('.artifacts/container.txt', root)
    const docker = FS.resolvePath('docker', bin)
    await FS.writeText(
      docker,
      [
        '#!/bin/sh',
        'printf "%s\\n" "$*" >> "$TAO_TEST_DOCKER_LOG"',
        'case "$1" in',
        '  version) [ "$TAO_TEST_DOCKER_FAILURE" != version ] || exit 6; printf "Docker fixture\\n" ;;',
        '  info) printf "%s overlayfs fixture\\n" "${TAO_TEST_DOCKER_ARCH:-aarch64}" ;;',
        '  build) printf "base build output\\n" ;;',
        '  create)',
        '    [ "$TAO_TEST_DOCKER_FAILURE" != create-before ] || exit 9',
        '    printf "%s\\n" "$3" > "$TAO_TEST_DOCKER_CONTAINER"',
        '    for argument in "$@"; do case "$argument" in tao.run=*) run=${argument#tao.run=} ;; esac; done',
        '    owner=contributor-linux-test',
        '    [ "$TAO_TEST_DOCKER_FAILURE" != foreign ] || owner=other-owner',
        '    printf "%s %s\\n" "$owner" "$run" > "$TAO_TEST_DOCKER_CONTAINER.labels"',
        '    [ "$TAO_TEST_DOCKER_FAILURE" != interrupt ] || kill -TERM "$PPID"',
        '    case "$TAO_TEST_DOCKER_FAILURE" in create-after|foreign) exit 9 ;; esac ;;',
        '  inspect)',
        '    if [ "$2" = --format ]; then',
        '      [ "$TAO_TEST_DOCKER_FAILURE" != disconnected ] || exit 5',
        '      [ -f "$TAO_TEST_DOCKER_CONTAINER" ] || exit 1',
        '      case "$3" in',
        '        *State.Status*)',
        '          read -r owner run < "$TAO_TEST_DOCKER_CONTAINER.labels"',
        '          [ "$TAO_TEST_DOCKER_FAILURE" != foreign ] || owner=foreign-owner',
        '          read -r ignored name < "$TAO_TEST_DOCKER_CONTAINER"',
        '          read -r state < "$TAO_TEST_DOCKER_CONTAINER.state"',
        '          printf "/%s|%s|%s|%s|1\\n" "$name" "$owner" "$run" "$state"',
        '          [ "$TAO_TEST_DOCKER_FAILURE" != state-change ] || printf "running\\n" > "$TAO_TEST_DOCKER_CONTAINER.state" ;;',
        '        *) cat "$TAO_TEST_DOCKER_CONTAINER.labels" ;;',
        '      esac',
        '    fi ;;',
        '  container)',
        '    [ "$TAO_TEST_DOCKER_FAILURE" != disconnected ] || exit 5',
        '    if [ -f "$TAO_TEST_DOCKER_CONTAINER" ]; then',
        '      read -r ignored name < "$TAO_TEST_DOCKER_CONTAINER"',
        '      case "$*" in *"-(cold|tools|cached)$"*|*"name=^/$name$"*) cat "$TAO_TEST_DOCKER_CONTAINER" ;; esac',
        '    fi ;;',
        '  rm)',
        '    [ "$TAO_TEST_DOCKER_FAILURE" != remove ] || exit 8',
        '    rm -f "$TAO_TEST_DOCKER_CONTAINER" "$TAO_TEST_DOCKER_CONTAINER.labels" "$TAO_TEST_DOCKER_CONTAINER.state" ;;',
        '  image)',
        '    if [ "$2" = ls ]; then',
        '      [ ! -f "$TAO_TEST_DOCKER_BASE_IMAGE" ] || cat "$TAO_TEST_DOCKER_BASE_IMAGE"',
        '    elif [ "$2" = rm ]; then',
        '      rm -f "$TAO_TEST_DOCKER_BASE_IMAGE"',
        '    elif [ "$2" = inspect ]; then',
        '      case "$3" in',
        '        tao-contributor-linux-tools:*) [ -f "$TAO_TEST_DOCKER_CACHE" ] && [ "$(cat "$TAO_TEST_DOCKER_CACHE")" = "$3" ] || exit 1 ;;',
        '      esac',
        '      if [ "$3" = --format ] && [ "$4" != "{{.Id}}" ]; then',
        '        expected=\'{{if and (eq .Os "linux") (eq .Architecture "amd64") .RootFS.Layers .Config}}linux/amd64 {{json .RootFS.Layers}} {{json .Config}}{{else}}invalid{{end}}\'',
        '        [ "$4" = "${TAO_TEST_DOCKER_IMAGE_FORMAT:-$expected}" ] || exit 12',
        '        default_contents=\'linux/amd64 ["sha256:layer"] {"WorkingDir":"/workspace"}\'',
        '        printf "%s\\n" "${TAO_TEST_DOCKER_BASE_CONTENTS:-$default_contents}"',
        '      else',
        '        printf "%s\\n" "${TAO_TEST_DOCKER_BASE_ID:-sha256:fixture-base}"',
        '      fi',
        '    fi ;;',
        '  start) printf "guest output before failure\\n"; case "$3" in *-"$TAO_TEST_DOCKER_FAILURE") exit 7 ;; esac ;;',
        '  logs) printf "complete guest console\\n" ;;',
        '  cp) case "$3" in */recovery-*/*/workflow-logs) [ "$TAO_TEST_DOCKER_FAILURE" != collect ] || exit 7 ;; esac',
        '    case "$2" in *:/workspace/*) mkdir -p "$3" ;; esac',
        '    case "$3" in */recovery-*/*/guest) printf "check\\n" > "$3/steps.tsv" ;;',
        '      */recovery-*/*/workflow-logs) printf "complete workflow log\\n" > "$3/complete.log" ;; esac ;;',
        '  commit)',
        '    [ "$TAO_TEST_DOCKER_FAILURE" != commit ] || exit 7',
        '    printf "%s\\n" "$3" > "$TAO_TEST_DOCKER_CACHE" ;;',
        'esac',
        'exit 0',
        '',
      ].join('\n'),
    )
    await FS.chmod(docker, 0o755)
    await test({
      root,
      log,
      container,
      env: {
        ...Platform.runtimeProcess.env,
        PATH: `${bin}:/usr/bin:/bin`,
        TAO_TEST_DOCKER_CACHE: cache,
        TAO_TEST_DOCKER_BASE_IMAGE: FS.resolvePath('.artifacts/base-image.txt', root),
        TAO_TEST_DOCKER_CONTAINER: container,
        TAO_TEST_DOCKER_LOG: log,
      },
    })
  } finally {
    await FS.remove(root)
  }
}

async function run(fixture: Fixture, args: string[] = [], failure = ''): Promise<CLI.CommandResult> {
  return await CLI.run('/bin/sh', {
    args: [FS.resolvePath(ENTRY, fixture.root), ...args],
    cwd: fixture.root,
    env: { ...fixture.env, TAO_TEST_DOCKER_FAILURE: failure },
  })
}
