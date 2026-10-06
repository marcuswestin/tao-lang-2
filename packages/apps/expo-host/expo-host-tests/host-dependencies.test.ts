import { HostDependencies, RuntimeToolchainPaths } from '@expo-host'
import { CLI, FS, Platform, Repo } from '@shared'
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
      // Jest resolves from the host's own files, so the install is linked beside them.
      Expect(await FS.realPath(FS.resolvePath('node_modules', host.hostFiles)))
        .toBe(await FS.realPath(FS.resolvePath('node_modules', host.installRoot)))
    })
  })

  Test('copies patch files before install and includes their bytes in the install identity', async () => {
    await withHost(async host => {
      const patchPath = 'patches/@expo__metro-file-map@57.0.3.patch'
      const source = FS.resolvePath(patchPath, host.hostFiles)
      const captured: string[] = []
      await FS.mkdir(FS.resolvePath('patches', host.hostFiles))
      await FS.writeText(source, 'first patch contents\n')
      await FS.writeJson(FS.resolvePath('package.json', host.hostFiles), {
        name: 'tao-expo-host',
        patchedDependencies: { '@expo/metro-file-map@57.0.3': patchPath },
      })
      const install = host.install
      host.install = async installRoot => {
        captured.push(await FS.readText(FS.resolvePath(patchPath, installRoot)))
        await install(installRoot)
      }

      await HostDependencies.ensureIn(host, approved)
      await FS.writeText(source, 'second patch contents\n')
      await HostDependencies.ensureIn(host, approved)

      Expect(captured).toEqual(['first patch contents\n', 'second patch contents\n'])
      Expect(host.installs).toHaveLength(2)
      Expect(await FS.readText(FS.resolvePath('bun.lock', host.installRoot))).toBe('lock one\n')
    })
  })

  Test('rejects traversing and missing patch paths before invoking the installer', async () => {
    for (
      const scenario of [
        { path: 'patches/../outside.patch', error: 'invalid patched dependency path' },
        { path: 'patches/missing.patch', error: 'missing or outside patches/' },
      ]
    ) {
      await withHost(async host => {
        await FS.writeJson(FS.resolvePath('package.json', host.hostFiles), {
          name: 'tao-expo-host',
          patchedDependencies: { 'metro@0.84.5': scenario.path },
        })

        await Expect(HostDependencies.ensureIn(host, approved)).rejects.toThrow(scenario.error)

        Expect(host.installs).toEqual([])
      })
    }
  })

  Test('repairs a missing owned launcher on a stamped install and preserves unexpected entries', async () => {
    await withHost(async host => {
      await HostDependencies.ensureIn(host, approved)
      const launcher = FS.resolvePath('.tao-runtime-bin/node', host.installRoot)
      const original = await FS.readText(launcher)
      await FS.remove(launcher)
      await HostDependencies.ensureIn(host, approved)
      Expect(await FS.readText(launcher)).toBe(original)
      Expect(host.installs).toHaveLength(1)
      await FS.writeText(launcher, 'unrelated executable')
      await Expect(HostDependencies.ensureIn(host, approved)).rejects.toThrow('unrecognized runtime launcher')
      Expect(await FS.readText(launcher)).toBe('unrelated executable')
    })
  })

  Test('refuses a redirected launcher directory before invoking the installer', async () => {
    await withHost(async host => {
      const elsewhere = FS.resolvePath('elsewhere', FS.dirname(host.installRoot))
      await FS.mkdir(elsewhere)
      await FS.symlink(elsewhere, FS.resolvePath('.tao-runtime-bin', host.installRoot))
      await Expect(HostDependencies.ensureIn(host, approved)).rejects.toThrow('is not a directory')
      Expect(host.installs).toEqual([])
      Expect(await FS.listDir(elsewhere)).toEqual([])
    })
  })

  Test('compiled runtime runs absolute extensionless scripts and owned child node without recursion', async () => {
    const root = await mkTestDir('tao-runtime-launcher-')
    try {
      const entry = FS.resolvePath('entry.ts', root)
      const binary = FS.resolvePath("space's runtime", root)
      const toolchain = Repo.resolvePath('packages/apps/expo-host/expo-host-src/runtime-toolchain-paths.ts')
      const shared = Repo.resolvePath('packages/shared/shared-src/shared.ts')
      await FS.writeText(
        entry,
        `import {RuntimeToolchainPaths} from ${JSON.stringify(toolchain)};
import {Platform} from ${JSON.stringify(shared)};
Platform.runtimeConsole.info(JSON.stringify(RuntimeToolchainPaths.expoCommand(Platform.runtimeProcess.argv[2], ['parent argument'])));`,
      )

      await CLI.mustRun(Platform.runtimeProcess.execPath, {
        args: ['build', '--compile', entry, '--outfile', binary],
        cwd: Repo.getRoot(),
      })
      await RuntimeToolchainPaths.prepareNodeLauncher(FS.resolvePath('host', root), binary)
      const installRoot = FS.resolvePath('host', root)
      const script = FS.resolvePath('node_modules/.bin/expo', root)
      const probe = FS.resolvePath('probe.ts', root)
      // Bundle the shared wrappers so the installed runtime executes standalone JavaScript.
      // Its Node shebang and child node invocation still exercise the actual launcher boundary.
      await FS.writeText(
        probe,
        `#!/usr/bin/env node
import {CLI, FS, Platform} from ${JSON.stringify(shared)};
const args = Platform.runtimeProcess.argv;
const runtime = {bun: !!Platform.runtimeBunVersion, executable: Platform.runtimeProcess.execPath};
if (args[2] === '--lifecycle') {
  await FS.writeJson('lifecycle.json', runtime);
} else if (args[2] === '--child') {
  Platform.runtimeConsole.info(JSON.stringify({...runtime, args: args.slice(3)}));
} else {
  const child = await CLI.run('node', {args: [args[1], '--child', 'child argument']});
  Platform.runtimeConsole.info(JSON.stringify({bun: runtime.bun, args: args.slice(2), child: JSON.parse(child.stdout), status: child.exitCode}));
}
`,
      )
      await CLI.mustRun(Platform.runtimeProcess.execPath, {
        args: ['build', '--target=bun', probe, '--outfile', script],
        cwd: Repo.getRoot(),
      })
      const standalone = await FS.readText(script)
      await FS.writeJson(FS.resolvePath('package.json', installRoot), {
        name: 'runtime-launcher-fixture',
        scripts: { postinstall: 'node lifecycle.js --lifecycle' },
      })
      await FS.writeText(FS.resolvePath('lifecycle.js', installRoot), standalone)
      // Verify the fallback is available before invoking install: a broken mutation must not
      // exercise Bun's global missing-node fallback on the developer's machine.
      Expect(await FS.isFile(FS.resolvePath('.tao-runtime-bin/node', installRoot))).toBe(true)
      await CLI.mustRun(binary, {
        args: ['install', '--frozen-lockfile', '--cwd', installRoot],
        env: {
          NODE_ENV: 'test',
          BUN_BE_BUN: '1',
          BUN_INSTALL_CACHE_DIR: FS.resolvePath('cache', root),
          ...RuntimeToolchainPaths.nodeLauncherEnvironment(installRoot),
        },
      })
      Expect(await FS.readJson(FS.resolvePath('lifecycle.json', installRoot)))
        .toEqual({ bun: true, executable: binary })
      const planned = await CLI.mustRun(binary, {
        args: [root],
        env: { NODE_ENV: 'test', TAO_RESOURCES: FS.resolvePath('resources', root) },
      })
      const invocation = JSON.parse(planned.stdout)
      Expect(invocation.args).toEqual([script, 'parent argument'])
      const result = await CLI.run(invocation.command, {
        args: invocation.args,
        env: invocation.env,
      })
      Expect(result.exitCode).toBe(0)
      Expect(JSON.parse(result.stdout)).toEqual({
        bun: true,
        args: ['parent argument'],
        child: { bun: true, executable: binary, args: ['child argument'] },
        status: 0,
      })
    } finally {
      await FS.remove(root)
    }
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
      Expect(await FS.exists(FS.resolvePath('.tao-runtime-bin', host.installRoot))).toBe(false)
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
      Expect(await FS.exists(FS.resolvePath('.tao-runtime-bin', host.installRoot))).toBe(false)
    })
  })

  Test('lets two first runs share one install', async () => {
    await withHost(async host => {
      await Promise.all([HostDependencies.ensureIn(host, approved), HostDependencies.ensureIn(host, approved)])

      Expect(host.installs).toHaveLength(1)
    })
  })

  Test('repairs a stamped host with missing packages once across concurrent callers', async () => {
    await withHost(async host => {
      await HostDependencies.ensureIn(host, approved)
      await FS.remove(FS.resolvePath('node_modules', host.installRoot))

      await Promise.all([HostDependencies.ensureIn(host, approved), HostDependencies.ensureIn(host, approved)])

      Expect(host.installs).toHaveLength(2)
      Expect(await FS.isFile(FS.resolvePath('node_modules/jest/package.json', host.installRoot))).toBe(true)

      await FS.remove(FS.resolvePath('node_modules/jest', host.installRoot))
      await HostDependencies.ensureIn(host, approved)

      Expect(host.installs).toHaveLength(3)
      Expect(await FS.isFile(FS.resolvePath('node_modules/jest/package.json', host.installRoot))).toBe(true)
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
        Expect(await FS.isFile(FS.resolvePath('.tao-runtime-bin/node', installRoot))).toBe(true)
        installs.push(installRoot)
        await FS.writeText(FS.resolvePath('node_modules/expo/package.json', installRoot), '{}\n')
        await FS.writeText(FS.resolvePath('node_modules/jest/package.json', installRoot), '{}\n')
      },
    })
  } finally {
    await FS.remove(root)
  }
}
