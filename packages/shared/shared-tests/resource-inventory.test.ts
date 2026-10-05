import { FS, Platform } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import type { TrackedProcess } from '../shared-src/ProcessTree'
import {
  beginLaunch,
  formatReport,
  inspect,
  notifyStartup,
  publishLaunch,
  registerDirectory,
  registerProcess,
  retireProcess,
  updateProcess,
} from '../shared-src/ResourceInventory'

const ID = '00000000-0000-4000-8000-000000000001'
const owner: TrackedProcess = { pid: 42, startedAt: '100:200', command: 'owner' }
const child: TrackedProcess = { pid: 43, startedAt: '101:201', command: 'child' }

async function fixture() {
  const checkout = await mkTestDir('resource-inventory')
  return {
    checkout,
    mode: 'startup' as const,
    indexRoot: FS.resolvePath('index', checkout),
    machineRegistryRoot: FS.resolvePath('machine', checkout),
    temporaryRoot: FS.resolvePath('temporary', checkout),
    androidRoot: FS.resolvePath('.android/avd', checkout),
    homeRoot: FS.resolvePath('home', checkout),
    inspectIdentities: () => new Map<number, TrackedProcess>(),
    inspectProcessTable: () => [],
    inspectProcessAlive: () => false,
    inspectGroup: () => [],
    inspectProjectFiles: () => [],
  }
}

async function processRecord(root: string, overrides: Record<string, unknown> = {}) {
  await FS.writeJson(FS.resolvePath(`${ID}.json`, root), {
    version: 1,
    id: ID,
    kind: 'process',
    checkout: FS.dirname(root),
    owner,
    process: child,
    ...overrides,
  })
}

Describe('resource inventory process ownership', () => {
  Test('a captured child surviving its dead owner is stranded', async () => {
    const options = await fixture()
    await processRecord(options.indexRoot)
    const report = await inspect({ ...options, inspectIdentities: () => new Map([[child.pid, child]]) })
    Expect(report.entries).toHaveLength(1)
    Expect(report.entries[0]).toMatchObject({ kind: 'process', classification: 'stranded', pid: 43 })
    Expect(report.warnings).toEqual([])
  })

  Test('PID reuse does not turn a captured child into a live resource', async () => {
    const options = await fixture()
    await processRecord(options.indexRoot)
    const report = await inspect({
      ...options,
      inspectIdentities: () => new Map([[child.pid, { ...child, startedAt: '999:999' }]]),
    })
    Expect(report.entries[0]?.classification).toBe('inactive')
  })

  Test('both captured identities gone leaves an inactive record without removing it', async () => {
    const options = await fixture()
    await processRecord(options.indexRoot)
    const path = FS.resolvePath(`${ID}.json`, options.indexRoot)
    const before = await FS.readText(path)
    const report = await inspect(options)
    Expect(report.entries[0]?.classification).toBe('inactive')
    Expect(await FS.readText(path)).toBe(before)
  })

  Test('inspection denial is unverified rather than proof that processes exited', async () => {
    const options = await fixture()
    await processRecord(options.indexRoot)
    const report = await inspect({
      ...options,
      inspectIdentities: () => {
        throw { code: 'EACCES' }
      },
    })
    Expect(report.entries[0]?.classification).toBe('unverified')
    Expect(report.warnings).toEqual(['Process identity inspection failed; process ownership is unverified.'])
  })

  Test('a missing kernel identity for a live or unreadable PID is never proof of inactivity', async () => {
    const options = await fixture()
    await processRecord(options.indexRoot)
    for (
      const inspectProcessAlive of [() => true, () => {
        throw { code: 'EPERM' }
      }]
    ) {
      const report = await inspect({ ...options, inspectProcessAlive })
      Expect(report.entries[0]?.classification).toBe('unverified')
      Expect(report.entries[0]?.reason).toContain('kernel start identity is unavailable')
    }
  })

  Test('a detached root exiting does not hide surviving group members', async () => {
    const options = await fixture()
    await processRecord(options.indexRoot, { processGroup: child.pid })
    const survivor = { pid: 44, startedAt: '102:202', command: 'descendant' }
    const report = await inspect({ ...options, inspectGroup: () => [survivor] })
    Expect(report.entries[0]?.classification).toBe('unverified')
    Expect(report.entries[0]?.reason).toContain('closure is unproved')
  })

  Test('group inspection denial cannot prove that a detached resource is inactive', async () => {
    const options = await fixture()
    await processRecord(options.indexRoot, { processGroup: child.pid })
    const report = await inspect({
      ...options,
      inspectGroup: () => {
        throw { code: 'EACCES' }
      },
    })
    Expect(report.entries[0]?.classification).toBe('unverified')
    Expect(report.warnings).toEqual(['Detached process group inspection failed; group closure is unverified.'])
  })

  Test('an empty detached group and absent captured identities prove inactivity', async () => {
    const options = await fixture()
    await processRecord(options.indexRoot, { processGroup: child.pid })
    Expect((await inspect({ ...options, inspectGroup: () => [] })).entries[0]?.classification).toBe('inactive')
    Expect(() =>
      registerProcess({
        owner,
        process: child,
        checkout: options.checkout,
        command: 'Expo',
        processGroup: 999,
        indexRoot: options.indexRoot,
      })
    ).toThrow('invalid resource process provenance')
  })

  Test('an active owner and child produce no startup warning', async () => {
    const options = await fixture()
    await processRecord(options.indexRoot)
    const active = { ...options, inspectIdentities: () => new Map([[owner.pid, owner], [child.pid, child]]) }
    const report = await inspect(active)
    Expect(report.entries[0]?.classification).toBe('active')
    const env = Platform.runtimeProcess.env
    const previous = env['TAO_RESOURCE_INVENTORY_NOTIFIED']
    delete env['TAO_RESOURCE_INVENTORY_NOTIFIED']
    try {
      const output = await withCapturedOutput(() => notifyStartup(active))
      Expect(output.stderr).toBe('')
      Expect(output.stdout).toBe('')
    } finally {
      if (previous === undefined) {
        delete env['TAO_RESOURCE_INVENTORY_NOTIFIED']
      } else {
        env['TAO_RESOURCE_INVENTORY_NOTIFIED'] = previous
      }
    }
  })

  Test('startup advisories name the public command and deduplicate nested invocations', async () => {
    const options = await fixture()
    await processRecord(options.indexRoot)
    const env = Platform.runtimeProcess.env
    const previous = env['TAO_RESOURCE_INVENTORY_NOTIFIED']
    delete env['TAO_RESOURCE_INVENTORY_NOTIFIED']
    try {
      const output = await withCapturedOutput(async () => {
        const stranded = { ...options, inspectIdentities: () => new Map([[child.pid, child]]) }
        await notifyStartup(stranded)
        await notifyStartup(stranded)
      })
      Expect(output.stderr).toBe(
        'Tao resources: 1 resource(s) need inspection. Run tao resources for ownership and cleanup guidance.\n',
      )
      Expect(output.stdout).toBe('')
    } finally {
      if (previous === undefined) {
        delete env['TAO_RESOURCE_INVENTORY_NOTIFIED']
      } else {
        env['TAO_RESOURCE_INVENTORY_NOTIFIED'] = previous
      }
    }
  })
})

Describe('resource inventory legacy process relevance', () => {
  Test('full inspection reports relevant parentless processes as unverified without exposing argv', async () => {
    const options = await fixture()
    const table = [{
      pid: 77,
      ppid: 1,
      startedAt: '123:456',
      command: `bun ${options.checkout}/packages/expo-runner.ts --token=private-token`,
    }]
    let inspections = 0
    const inspectProcessTable = () => {
      inspections++
      return table
    }
    const startup = await inspect({ ...options, inspectProcessTable })
    Expect(startup.entries).toEqual([])
    Expect(inspections).toBe(0)
    const report = await inspect({ ...options, mode: 'full', inspectProcessTable })
    Expect(inspections).toBe(1)
    Expect(report.entries).toEqual([{
      id: 'legacy-process:77',
      kind: 'legacy-process',
      classification: 'unverified',
      pid: 77,
      path: options.checkout,
      checkout: options.checkout,
      reason: 'Process metadata mentions a known directory; ownership and cleanup authority are unverified.',
    }])
    Expect(JSON.stringify(report)).not.toContain('private-token')
    Expect(JSON.stringify(report)).not.toContain('expo-runner')
    Expect(table[0]?.ppid).toBe(1)
  })

  Test('unrelated processes and similar directory prefixes are preserved and omitted', async () => {
    const options = await fixture()
    const table = [
      { pid: 77, ppid: 1, startedAt: '123:456', command: 'bun /unrelated/project/server.ts' },
      { pid: 78, ppid: 1, startedAt: '124:457', command: `bun ${options.checkout}-another/server.ts` },
      { pid: 79, ppid: 1, startedAt: '125:458', command: `bun /other${options.checkout}/server.ts` },
    ]
    const before = JSON.stringify(table)
    const report = await inspect({ ...options, mode: 'full', inspectProcessTable: () => table })
    Expect(report.entries).toEqual([])
    Expect(JSON.stringify(table)).toBe(before)
  })

  Test(
    'indexed checkout and recognized temporary boundaries include legacy facts without duplicating known PIDs',
    async () => {
      const options = await fixture()
      const otherCheckout = FS.resolvePath('other-checkout', options.checkout)
      await processRecord(options.indexRoot, { checkout: otherCheckout })
      const temporary = FS.resolvePath('tao-managed-loop-project-legacy', options.temporaryRoot)
      await FS.mkdir(temporary)
      const table = [
        { ...owner, ppid: 1, command: `bun ${options.checkout}/owner.ts` },
        { ...child, ppid: 1, command: `bun ${options.checkout}/child.ts` },
        { pid: 77, ppid: 1, startedAt: '123:456', command: `bun --cwd="${otherCheckout}" server.ts` },
        { pid: 78, ppid: 1, startedAt: '124:457', command: `bun ${temporary}/server.ts` },
        {
          pid: Platform.runtimeProcess.pid,
          ppid: 1,
          startedAt: '125:458',
          command: `bun ${options.checkout}/inspector.ts`,
        },
      ]
      const report = await inspect({ ...options, mode: 'full', inspectProcessTable: () => table })
      const facts = report.entries.filter(entry => entry.kind === 'legacy-process')
      Expect(facts.map(entry => entry.pid)).toEqual([77, 78])
      Expect(facts.every(entry => entry.classification === 'unverified')).toBe(true)
    },
  )

  Test('process-table denial leaves full inspection visibly partial while startup remains receipts-only', async () => {
    const options = await fixture()
    const inspectProcessTable = () => {
      throw { code: 'EACCES' }
    }
    Expect((await inspect({ ...options, inspectProcessTable })).warnings).toEqual([])
    const report = await inspect({ ...options, mode: 'full', inspectProcessTable })
    Expect(report.warnings).toEqual(['Legacy process inspection failed; the full resource inventory is partial.'])
    Expect(report.entries).toEqual([])
  })
})

Describe('resource inventory authoritative metadata', () => {
  Test('uncertain receipt cleanup and mobile opening remain unverified after all captured processes exit', async () => {
    const options = await fixture()
    const path = FS.resolvePath(`.artifacts/dev-loops/${ID}/receipt.json`, options.checkout)
    for (
      const fields of [{ provenance: 'uncertain' }, { cleanupOutcome: 'unknown' }, { mobileDriverCleanup: 'opening' }]
    ) {
      await FS.writeJson(path, {
        version: 1,
        session: ID,
        checkout: options.checkout,
        state: 'stopped',
        controller: owner,
        children: [],
        provenance: 'complete',
        cleanupOutcome: 'proved',
        ...fields,
      })
      Expect((await inspect(options)).entries[0]?.classification).toBe('unverified')
    }
    await FS.writeJson(path, {
      version: 1,
      session: ID,
      checkout: options.checkout,
      state: 'stopped',
      controller: owner,
      children: [],
      provenance: 'complete',
      cleanupOutcome: 'proved',
      mobileDriverCleanup: 'retained',
    })
    Expect((await inspect(options)).entries[0]?.classification).toBe('retained')
  })

  Test('managed mobile driver identities and orphaned process groups remain visible', async () => {
    const options = await fixture()
    const path = FS.resolvePath(`.artifacts/dev-loops/${ID}/receipt.json`, options.checkout)
    await FS.writeJson(path, {
      version: 1,
      session: ID,
      checkout: options.checkout,
      state: 'stopped',
      controller: owner,
      children: [],
      mobileDriverProcesses: [child],
      provenance: 'complete',
      cleanupOutcome: 'proved',
    })
    const mobile = await inspect({ ...options, inspectIdentities: () => new Map([[child.pid, child]]) })
    Expect(mobile.entries[0]?.classification).toBe('stranded')
    await FS.writeJson(path, {
      version: 1,
      session: ID,
      checkout: options.checkout,
      state: 'stopped',
      controller: owner,
      children: [],
      processGroups: [child],
      provenance: 'complete',
      cleanupOutcome: 'proved',
    })
    const survivor = { pid: 44, startedAt: '102:202', command: 'descendant' }
    const group = await inspect({ ...options, inspectGroup: () => [survivor] })
    Expect(group.entries[0]?.classification).toBe('unverified')
    Expect(group.entries[0]?.reason).toContain('closure is unproved')
  })
  Test('retained fences remain retained after the recorded owner exits', async () => {
    const options = await fixture()
    await FS.writeJson(FS.resolvePath('resource-avd.lease', options.machineRegistryRoot), {
      id: 'generation',
      name: 'avd',
      pid: 42,
      repositoryRoot: options.checkout,
      startedAt: '2026-10-04T00:00:00.000Z',
      processStartedAt: owner.startedAt,
      retention: { processes: [child], resourceNames: ['avd'], reason: 'shutdown unproved', quarantined: true },
    })
    const report = await inspect(options)
    Expect(report.entries[0]?.classification).toBe('retained')
  })

  Test('a retained handoff remains visible after the original lease file disappears', async () => {
    const options = await fixture()
    const original = {
      id: 'original',
      name: 'avd',
      pid: 42,
      repositoryRoot: options.checkout,
      startedAt: '2026-10-04T00:00:00.000Z',
      processStartedAt: owner.startedAt,
    }
    await FS.writeJson(FS.resolvePath('.retentions/generation.json', options.machineRegistryRoot), {
      originalOwners: [original],
      retainedOwner: {
        ...original,
        id: 'retained',
        retention: { processes: [], resourceNames: ['avd'], reason: 'shutdown unproved', quarantined: true },
      },
    })
    Expect((await inspect(options)).entries[0]).toMatchObject({ classification: 'retained', kind: 'machine-lease' })
  })

  Test('legacy rounded start times are unverified while a PID remains alive', async () => {
    const options = await fixture()
    await FS.writeJson(FS.resolvePath('resource-avd.lease', options.machineRegistryRoot), {
      id: 'generation',
      name: 'avd',
      pid: 42,
      repositoryRoot: options.checkout,
      startedAt: '2026-10-04T00:00:00.000Z',
      processStartedAt: 'Sun Oct 4 00:00:00 2026',
    })
    const report = await inspect({ ...options, inspectIdentities: () => new Map([[owner.pid, owner]]) })
    Expect(report.entries[0]?.classification).toBe('unverified')
  })

  Test('managed receipt child identities remain visible after controller exit', async () => {
    const options = await fixture()
    await FS.writeJson(FS.resolvePath(`.artifacts/dev-loops/${ID}/receipt.json`, options.checkout), {
      version: 1,
      session: ID,
      checkout: options.checkout,
      state: 'ready',
      controller: owner,
      children: [child],
      control: { token: 'private-token', origin: 'http://127.0.0.1:4000' },
    })
    const report = await inspect({ ...options, inspectIdentities: () => new Map([[child.pid, child]]) })
    Expect(report.entries[0]).toMatchObject({ kind: 'managed-session', classification: 'stranded' })
    Expect(JSON.stringify(report)).not.toContain('private-token')
    Expect(JSON.stringify(report)).not.toContain('127.0.0.1')
  })
})

Describe('resource inventory record safety', () => {
  Test(
    'nested authored projects expose every fixed legacy path including the bridge-check file without reading contents',
    async () => {
      const options = await fixture()
      const project = FS.resolvePath('Apps/Nested Project', options.checkout)
      for (const name of ['dev', 'typescript', 'sessions']) {
        await FS.writeText(FS.resolvePath(`.tao/${name}/.env`, project), 'SECRET=private-legacy')
      }
      const bridge = FS.resolvePath('.tao/bridge-check.tsconfig.json', project)
      await FS.writeText(bridge, 'password=private-legacy')
      const report = await inspect({
        ...options,
        mode: 'full',
        inspectProjectFiles: () => ['Apps/Nested Project/.tao/.gitignore'],
      })
      Expect(report.entries.filter(entry => entry.kind.startsWith('legacy-project')).map(entry => entry.path)).toEqual([
        FS.resolvePath('.tao/dev', project),
        FS.resolvePath('.tao/typescript', project),
        FS.resolvePath('.tao/sessions', project),
        bridge,
      ])
      Expect(report.entries.every(entry => entry.classification === 'unverified')).toBe(true)
      Expect(JSON.stringify(report)).not.toContain('private-legacy')
      Expect(await FS.readText(bridge)).toBe('password=private-legacy')
    },
  )

  Test('checkout-root legacy metadata remains visible after project discovery fails or times out', async () => {
    const options = await fixture()
    for (const name of ['dev', 'typescript', 'sessions']) {
      await FS.mkdir(FS.resolvePath(`.tao/${name}`, options.checkout))
    }
    await FS.writeText(FS.resolvePath('.tao/bridge-check.tsconfig.json', options.checkout), '{}')
    const report = await inspect({
      ...options,
      inspectProjectFiles: () => {
        throw { code: 'ETIMEDOUT' }
      },
    })
    Expect(report.entries.map(entry => entry.kind)).toEqual([
      'legacy-project-dev',
      'legacy-project-typescript',
      'legacy-project-sessions',
      'legacy-project-bridge-check',
    ])
    Expect(report.warnings[0]).toContain('failed or exceeded its budget')
  })

  Test('startup bounds authored-path enumeration and keeps linked discovery for full inspection', async () => {
    const options = await fixture()
    const seen: Array<{ checkout: string; maxFiles: number; maxBytes: number; timeoutMs: number }> = []
    const files = Array.from({ length: 257 }, (_, index) => `Apps/Project${index}/.tao/.gitignore`)
    const late = FS.resolvePath('Apps/Project256/.tao/bridge-check.tsconfig.json', options.checkout)
    await FS.writeText(late, '{}')
    const inspectProjectFiles = (
      checkout: string,
      limits: { maxFiles: number; maxBytes: number; timeoutMs: number },
    ) => {
      seen.push({ checkout, ...limits })
      return files
    }
    const startup = await inspect({ ...options, inspectProjectFiles })
    // budget-ok: These assert production metadata inspection configuration and never wait.
    Expect(seen).toEqual([{ checkout: options.checkout, maxFiles: 256, maxBytes: 65_536, timeoutMs: 500 }])
    Expect(startup.entries).toEqual([])
    Expect(startup.warnings.some(warning => warning.includes('legacy inventory is partial'))).toBe(true)
    const full = await inspect({ ...options, mode: 'full', inspectProjectFiles })
    Expect(full.entries.some(entry => entry.path === late && entry.classification === 'unverified')).toBe(true)
    // budget-ok: These assert production metadata inspection configuration and never wait.
    Expect(seen[1]).toMatchObject({ maxFiles: 4_096, maxBytes: 1_048_576, timeoutMs: 2_000 })
  })

  Test('full legacy discovery covers primary and linked authored roots while startup stays local', async () => {
    const options = await fixture()
    const linked = FS.resolvePath('linked-checkout', options.checkout)
    await FS.writeText(FS.resolvePath('.git/worktrees/linked/gitdir', options.checkout), `${linked}/.git\n`)
    for (const checkout of [options.checkout, linked]) {
      await FS.writeText(FS.resolvePath('Apps/Project/.tao/bridge-check.tsconfig.json', checkout), '{}')
    }
    const seen: string[] = []
    const inspectProjectFiles = (checkout: string) => {
      seen.push(checkout)
      return ['Apps/Project/App.tao']
    }
    const startup = await inspect({ ...options, inspectProjectFiles })
    Expect(seen).toEqual([options.checkout])
    Expect(startup.entries.filter(entry => entry.kind === 'legacy-project-bridge-check')).toHaveLength(1)
    seen.length = 0
    const full = await inspect({ ...options, mode: 'full', inspectProjectFiles })
    Expect(seen).toEqual([options.checkout, linked])
    Expect(full.entries.filter(entry => entry.kind === 'legacy-project-bridge-check')).toHaveLength(2)
  })

  Test(
    'legacy discovery refuses path escapes and symlinked project state without following ignored generated trees',
    async () => {
      const options = await fixture()
      const outside = FS.resolvePath('outside', options.checkout)
      await FS.writeText(FS.resolvePath('bridge-check.tsconfig.json', outside), 'private-external')
      await FS.symlink(outside, FS.resolvePath('Apps/Linked/.tao', options.checkout))
      await FS.writeText(
        FS.resolvePath('node_modules/Generated/.tao/bridge-check.tsconfig.json', options.checkout),
        '{}',
      )
      const report = await inspect({
        ...options,
        mode: 'full',
        inspectProjectFiles: () => [
          '../outside/App.tao',
          'Apps/Linked/.tao/.gitignore',
          'node_modules/Generated/.tao/.gitignore',
          '.artifacts/build/_gen_app/.tao/.gitignore',
        ],
      })
      Expect(report.entries.filter(entry => entry.kind.startsWith('legacy-project'))).toHaveLength(4)
      Expect(
        report.entries.filter(entry => entry.kind.startsWith('legacy-project')).every(entry =>
          entry.classification === 'unverified'
        ),
      ).toBe(true)
      Expect(report.warnings.some(warning => warning.includes('Invalid authored project path'))).toBe(true)
      Expect(JSON.stringify(report)).not.toContain('private-external')
      Expect(report.entries.some(entry => entry.path?.includes('node_modules'))).toBe(false)
      Expect(await FS.readText(FS.resolvePath('bridge-check.tsconfig.json', outside))).toBe('private-external')
    },
  )
  Test('full inspection uses Android home and known machine storage metadata without reading secrets', async () => {
    const options = await fixture()
    const android = FS.resolvePath('.android/avd', options.homeRoot)
    await FS.writeText(FS.resolvePath('legacy.avd/.env', android), 'SECRET=private')
    await FS.writeText(FS.resolvePath('legacy.ini', android), 'path=/private/path')
    await FS.writeText(FS.resolvePath('.tao/cache/.env', options.homeRoot), 'SECRET=private')
    await FS.writeText(FS.resolvePath('.cache/tao/machine-lanes/.env', options.homeRoot), 'SECRET=private')
    await FS.writeText(FS.resolvePath('.tao/secrets/.env', options.homeRoot), 'SECRET=private')
    const report = await inspect({ ...options, androidRoot: android, mode: 'full' })
    Expect(report.entries.filter(entry => entry.kind === 'android-avd').map(entry => entry.path)).toEqual([
      FS.resolvePath('legacy.avd', android),
      FS.resolvePath('legacy.ini', android),
    ])
    Expect(report.entries.every(entry => entry.classification === 'unverified')).toBe(true)
    Expect(report.entries.some(entry => entry.kind === 'machine-cache-directory')).toBe(true)
    Expect(report.entries.some(entry => entry.kind === 'tao-home-directory')).toBe(true)
    Expect(JSON.stringify(report)).not.toContain('SECRET')
    Expect(JSON.stringify(report)).not.toContain('/private/path')
    Expect(JSON.stringify(report)).not.toContain('secrets')
  })
  Test('startup warns about omitted registration records while full inspection includes all records', async () => {
    const options = await fixture()
    await FS.mkdir(options.indexRoot)
    for (let index = 0; index < 257; index++) {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
      FS.writeTextSync(
        FS.resolvePath(`${id}.json`, options.indexRoot),
        JSON.stringify({
          version: 1,
          id,
          kind: 'process',
          checkout: options.checkout,
          owner,
          process: child,
        }),
        { mode: 0o600, exclusive: true },
      )
    }
    const startup = await inspect(options)
    Expect(startup.entries).toHaveLength(256)
    Expect(startup.warnings[0]).toContain('additional entries were omitted')
    const full = await inspect({ ...options, mode: 'full' })
    Expect(full.entries).toHaveLength(257)
    Expect(full.warnings).toEqual([])
  })

  Test(
    'full inspection reads fixed receipts from Git-known worktrees and retains equal session IDs separately',
    async () => {
      const options = await fixture()
      const linked = FS.resolvePath('linked-checkout', options.checkout)
      await FS.mkdir(linked)
      await FS.writeText(FS.resolvePath('.git/worktrees/linked/gitdir', options.checkout), `${linked}/.git\n`)
      for (const checkout of [options.checkout, linked]) {
        await FS.writeJson(FS.resolvePath(`.artifacts/dev-loops/${ID}/receipt.json`, checkout), {
          version: 1,
          session: ID,
          checkout,
          state: 'stopped',
          controller: owner,
          children: [],
          provenance: 'complete',
          cleanupOutcome: 'proved',
          control: { token: 'private-control' },
        })
      }
      Expect((await inspect(options)).entries.filter(entry => entry.kind === 'managed-session')).toHaveLength(1)
      const full = await inspect({ ...options, mode: 'full' })
      const sessions = full.entries.filter(entry => entry.kind === 'managed-session')
      Expect(sessions).toHaveLength(2)
      Expect(new Set(sessions.map(entry => entry.id)).size).toBe(2)
      Expect(JSON.stringify(full)).not.toContain('private-control')
    },
  )
  Test('full inspection from a linked checkout discovers a surviving owned child in the primary receipt', async () => {
    const options = await fixture()
    const primary = options.checkout
    const linked = FS.resolvePath('linked-checkout', primary)
    const gitDirectory = FS.resolvePath('.git/worktrees/linked', primary)
    await FS.writeText(FS.resolvePath('gitdir', gitDirectory), `${linked}/.git\n`)
    await FS.writeText(FS.resolvePath('.git', linked), `gitdir: ${gitDirectory}\n`)
    await FS.writeJson(FS.resolvePath(`.artifacts/dev-loops/${ID}/receipt.json`, primary), {
      version: 1,
      session: ID,
      checkout: primary,
      state: 'interrupted',
      controller: owner,
      children: [child],
      provenance: 'complete',
      cleanupOutcome: 'unknown',
      control: { token: 'private-primary-control' },
    })
    const linkedOptions = { ...options, checkout: linked, inspectIdentities: () => new Map([[child.pid, child]]) }
    Expect((await inspect(linkedOptions)).entries.filter(entry => entry.kind === 'managed-session')).toEqual([])
    const report = await inspect({ ...linkedOptions, mode: 'full' })
    const sessions = report.entries.filter(entry => entry.kind === 'managed-session')
    Expect(sessions).toHaveLength(1)
    Expect(sessions[0]).toMatchObject({
      checkout: primary,
      classification: 'stranded',
      path: FS.resolvePath(`.artifacts/dev-loops/${ID}/receipt.json`, primary),
    })
    Expect(JSON.stringify(report)).not.toContain('private-primary-control')
  })
  Test('malformed JSON and schema records are visible as unverified', async () => {
    const options = await fixture()
    await FS.writeText(FS.resolvePath('malformed.json', options.indexRoot), '{')
    await processRecord(options.indexRoot, { process: { ...child, startedAt: '' } })
    const report = await inspect(options)
    Expect(report.entries).toHaveLength(2)
    Expect(report.entries.every(entry => entry.classification === 'unverified')).toBe(true)
  })

  Test('symbolic record links and linked index ancestors are not followed', async () => {
    const options = await fixture()
    const actual = FS.resolvePath('actual', options.checkout)
    await processRecord(actual)
    await FS.symlink(FS.resolvePath(`${ID}.json`, actual), FS.resolvePath(`${ID}.json`, options.indexRoot))
    Expect((await inspect(options)).entries[0]?.classification).toBe('unverified')
    const linked = FS.resolvePath('linked', options.checkout)
    await FS.symlink(actual, linked)
    const report = await inspect({ ...options, indexRoot: linked })
    Expect(report.entries).toEqual([])
    Expect(report.warnings).toHaveLength(1)
  })

  Test('reading an empty checkout creates neither an index nor a registry', async () => {
    const options = await fixture()
    const before = await FS.listDir(options.checkout)
    const report = await inspect(options)
    Expect(report).toEqual({ version: 1, entries: [], warnings: [] })
    Expect(await FS.listDir(options.checkout)).toEqual(before)
    Expect(await FS.exists(options.indexRoot)).toBe(false)
    Expect(await FS.exists(options.machineRegistryRoot)).toBe(false)
  })

  Test('full inspection covers current and legacy roots without reading their secrets', async () => {
    const options = await fixture()
    const paths = [
      '.artifacts/host-acceptance',
      '.artifacts/tests/studio-smoke',
      '.tao/local/dev',
      '.tao/dev',
    ]
    for (const path of paths) {
      await FS.writeText(FS.resolvePath(`${path}/.env`, options.checkout), 'SECRET=private')
    }
    await FS.writeText(FS.resolvePath('fixture.avd/.env', options.androidRoot), 'SECRET=private')
    await FS.mkdir(FS.resolvePath('tao-managed-loop-project-example', options.temporaryRoot))
    await FS.mkdir(FS.resolvePath('other-project', options.temporaryRoot))
    const startup = await inspect(options)
    Expect(startup.entries.map(entry => entry.kind)).toEqual(['legacy-project-dev'])
    const report = await inspect({ ...options, mode: 'full' })
    Expect(report.entries.map(entry => entry.kind)).toEqual([
      'host-acceptance',
      'studio-smoke',
      'project-dev',
      'legacy-project-dev',
      'android-avd',
      'temporary-directory',
    ])
    Expect(report.entries.find(entry => entry.kind === 'android-avd')?.classification).toBe('unverified')
    Expect(JSON.stringify(report)).not.toContain('SECRET')
    Expect(JSON.stringify(report)).not.toContain('other-project')
  })

  Test(
    'full inspection reports Git worktree provenance and cache/build locations without inferring task completion',
    async () => {
      const options = await fixture()
      const linked = FS.resolvePath('linked-checkout', options.checkout)
      await FS.mkdir(linked)
      await FS.writeText(FS.resolvePath('.git/worktrees/linked/gitdir', options.checkout), `${linked}/.git\n`)
      for (const path of ['.artifacts/build', '.artifacts/cache', '.tao/cache']) {
        await FS.mkdir(FS.resolvePath(path, options.checkout))
      }
      const report = await inspect({ ...options, mode: 'full' })
      Expect(report.entries.map(entry => entry.kind)).toEqual([
        'build-output',
        'checkout-cache',
        'project-cache',
        'worktree',
      ])
      Expect(report.entries[3]).toMatchObject({ path: linked, classification: 'unverified' })
      Expect(formatReport(report)).toContain('unverified: 4')
      Expect(formatReport(report)).toContain('Inventory is read-only.')
    },
  )

  Test('reports contain descriptive metadata with credentials redacted', async () => {
    const options = await fixture()
    const path = FS.resolvePath('nonstandard', options.checkout)
    await FS.mkdir(path)
    await processRecord(options.indexRoot, {
      kind: 'directory',
      path,
      purpose: 'review token=private-token https://user:password@example.com',
      cleanupCondition: 'password=private-password',
    })
    const report = await inspect(options)
    Expect(report.entries[0]?.purpose).toBe('review token=[redacted] https://[redacted]@example.com')
    Expect(JSON.parse(JSON.stringify(report))).toEqual(report)
    Expect(JSON.stringify(report)).not.toContain('private-token')
    Expect(JSON.stringify(report)).not.toContain('private-password')
  })
})

Describe('resource inventory durable registrations', () => {
  Test('launch admission failure surfaces before any discovery record is allocated', async () => {
    const options = await fixture()
    await FS.writeText(options.indexRoot, 'occupied-by-a-file')
    const before = await FS.listDir(options.checkout)
    Expect(() => beginLaunch({ owner, checkout: options.checkout, command: 'Expo', indexRoot: options.indexRoot }))
      .toThrow()
    Expect(await FS.listDir(options.checkout)).toEqual(before)
    Expect(await FS.readText(options.indexRoot)).toBe('occupied-by-a-file')
  })

  Test('unfulfilled launch intent stays unverified even when its captured owner exits', async () => {
    const options = await fixture()
    const id = beginLaunch({
      owner,
      checkout: options.checkout,
      command: 'Expo --token=private',
      taskId: 'task',
      indexRoot: options.indexRoot,
    })
    const report = await inspect(options)
    Expect(report.entries[0]).toMatchObject({
      id,
      kind: 'launch',
      classification: 'unverified',
      checkout: options.checkout,
      taskId: 'task',
    })
    Expect(report.entries[0]?.reason).toContain('Launch intent is unfulfilled')
    Expect(JSON.stringify(report)).not.toContain('private')
    Expect(() => retireProcess(id, { indexRoot: options.indexRoot })).toThrow('captured resource process')
    Expect(await FS.exists(FS.resolvePath(`${id}.json`, options.indexRoot))).toBe(true)
  })

  Test('launch publication preserves the intent UUID and owner while capturing the kernel root', async () => {
    const options = await fixture()
    const id = beginLaunch({ owner, checkout: options.checkout, command: 'Expo', indexRoot: options.indexRoot })
    publishLaunch(id, { process: child, processGroup: child.pid, indexRoot: options.indexRoot })
    const record = await FS.readJson<Record<string, unknown>>(FS.resolvePath(`${id}.json`, options.indexRoot))
    Expect(record).toMatchObject({
      id,
      kind: 'process',
      owner: { ...owner, command: '' },
      process: { ...child, command: '' },
      processGroup: 43,
      provenance: 'complete',
    })
    Expect(await FS.listDir(options.indexRoot)).toEqual([`${id}.json`])
    const report = await inspect({ ...options, inspectIdentities: () => new Map([[child.pid, child]]) })
    Expect(report.entries[0]).toMatchObject({ id, kind: 'process', classification: 'stranded' })
  })

  Test('invalid capture and refused publication preserve the durable launch intent', async () => {
    const options = await fixture()
    const id = beginLaunch({ owner, checkout: options.checkout, command: 'Expo', indexRoot: options.indexRoot })
    const path = FS.resolvePath(`${id}.json`, options.indexRoot)
    const before = await FS.readText(path)
    Expect(() => publishLaunch(id, { process: { ...child, startedAt: '' }, indexRoot: options.indexRoot })).toThrow(
      'invalid resource process provenance',
    )
    Expect(await FS.readText(path)).toBe(before)
    const actual = FS.resolvePath('actual-index', options.checkout)
    await FS.move(options.indexRoot, actual)
    await FS.symlink(actual, options.indexRoot)
    Expect(() => publishLaunch(id, { process: child, indexRoot: options.indexRoot })).toThrow('symbolic links')
    Expect(await FS.readText(FS.resolvePath(`${id}.json`, actual))).toBe(before)
  })

  Test('publication refuses invalid intents and cannot overwrite an already captured registration', async () => {
    const options = await fixture()
    const id = beginLaunch({ owner, checkout: options.checkout, command: 'Expo', indexRoot: options.indexRoot })
    publishLaunch(id, { process: child, indexRoot: options.indexRoot })
    const path = FS.resolvePath(`${id}.json`, options.indexRoot)
    const before = await FS.readText(path)
    Expect(() => publishLaunch(id, { process: { ...child, pid: 99 }, indexRoot: options.indexRoot })).toThrow(
      'no longer unfulfilled',
    )
    Expect(await FS.readText(path)).toBe(before)
    await FS.writeText(
      path,
      JSON.stringify({
        version: 1,
        id,
        kind: 'launch',
        checkout: options.checkout,
        owner: { ...owner, startedAt: '' },
        purpose: 'Expo',
        provenance: 'uncertain',
      }),
    )
    const invalid = await FS.readText(path)
    Expect(() => publishLaunch(id, { process: child, indexRoot: options.indexRoot })).toThrow('invalid resource record')
    Expect(await FS.readText(path)).toBe(invalid)
  })
  Test('process updates preserve root ownership and captured descendant identities before teardown', async () => {
    const options = await fixture()
    const id = registerProcess({
      owner,
      process: child,
      checkout: options.checkout,
      command: 'Expo',
      processGroup: child.pid,
      indexRoot: options.indexRoot,
    })
    const descendant = { pid: 44, startedAt: '102:202', command: 'worker --token=private' }
    updateProcess(id, { children: [descendant], provenance: 'complete', indexRoot: options.indexRoot })
    const record = await FS.readJson<Record<string, unknown>>(FS.resolvePath(`${id}.json`, options.indexRoot))
    Expect(record['owner']).toEqual({ ...owner, command: '' })
    Expect(record['process']).toEqual({ ...child, command: '' })
    Expect(record['processGroup']).toBe(43)
    Expect(record['children']).toEqual([{ ...descendant, command: '' }])
    const report = await inspect({ ...options, inspectIdentities: () => new Map([[descendant.pid, descendant]]) })
    Expect(report.entries[0]?.classification).toBe('stranded')
    Expect(await FS.listDir(options.indexRoot)).toEqual([`${id}.json`])
  })

  Test('uncertain descendant provenance survives later absence and a complete update', async () => {
    const options = await fixture()
    const id = registerProcess({
      owner,
      process: child,
      checkout: options.checkout,
      command: 'Expo',
      indexRoot: options.indexRoot,
    })
    updateProcess(id, { children: [], provenance: 'uncertain', indexRoot: options.indexRoot })
    updateProcess(id, { children: [], provenance: 'complete', indexRoot: options.indexRoot })
    Expect((await inspect(options)).entries[0]?.classification).toBe('unverified')
    Expect(() => retireProcess(id, { indexRoot: options.indexRoot })).toThrow('closure remains uncertain')
    Expect(await FS.exists(FS.resolvePath(`${id}.json`, options.indexRoot))).toBe(true)
  })

  Test('a refused process update preserves the prior durable record', async () => {
    const options = await fixture()
    const id = registerProcess({
      owner,
      process: child,
      checkout: options.checkout,
      command: 'Expo',
      indexRoot: options.indexRoot,
    })
    const path = FS.resolvePath(`${id}.json`, options.indexRoot)
    const before = await FS.readText(path)
    const actual = FS.resolvePath('actual-index', options.checkout)
    await FS.move(options.indexRoot, actual)
    await FS.symlink(actual, options.indexRoot)
    Expect(() => updateProcess(id, { children: [], provenance: 'complete', indexRoot: options.indexRoot })).toThrow(
      'symbolic links',
    )
    Expect(await FS.readText(FS.resolvePath(`${id}.json`, actual))).toBe(before)
  })
  Test('synchronous process registration persists until explicit retirement', async () => {
    const options = await fixture()
    const id = registerProcess({
      owner,
      process: child,
      checkout: options.checkout,
      command: 'Expo token=private',
      indexRoot: options.indexRoot,
    })
    Expect(await FS.exists(FS.resolvePath(`${id}.json`, options.indexRoot))).toBe(true)
    Expect(FS.entryMetadataSync(FS.resolvePath(`${id}.json`, options.indexRoot)).mode & 0o777).toBe(0o600)
    Expect(FS.entryMetadataSync(options.indexRoot).mode & 0o777).toBe(0o700)
    Expect((await inspect(options)).entries[0]).toMatchObject({ id, kind: 'process', classification: 'inactive' })
    retireProcess(id, { indexRoot: options.indexRoot })
    Expect((await inspect(options)).entries).toEqual([])
    Expect(await FS.listDir(options.indexRoot)).toEqual([])
  })

  Test('a refused retirement surfaces the failure and leaves the process discoverable', async () => {
    const options = await fixture()
    const id = registerProcess({
      owner,
      process: child,
      checkout: options.checkout,
      command: 'Expo',
      indexRoot: options.indexRoot,
    })
    await FS.writeText(FS.resolvePath(`${id}.json`, options.indexRoot), '{"version":999}')
    Expect(() => retireProcess(id, { indexRoot: options.indexRoot })).toThrow()
    Expect(await FS.exists(FS.resolvePath(`${id}.json`, options.indexRoot))).toBe(true)
    Expect((await inspect(options)).entries[0]?.classification).toBe('unverified')
  })

  Test('directory registration survives removal of its checkout without granting deletion authority', async () => {
    const options = await fixture()
    const directory = FS.resolvePath('nonstandard', options.checkout)
    await FS.mkdir(directory)
    const checkout = FS.resolvePath('disposable-checkout', options.checkout)
    await FS.mkdir(checkout)
    const id = await registerDirectory({
      path: directory,
      checkout,
      purpose: 'temporary acceptance fixture',
      cleanupCondition: 'After the task owner proves acceptance is complete.',
      indexRoot: options.indexRoot,
    })
    await FS.remove(checkout)
    const report = await inspect(options)
    Expect(report.entries[0]).toMatchObject({ id, kind: 'directory', path: directory, checkout })
    Expect(await FS.isDirectory(directory)).toBe(true)
  })

  Test('directory registration rejects symbolic links and malformed absolute paths', async () => {
    const options = await fixture()
    const target = FS.resolvePath('target', options.checkout)
    await FS.mkdir(target)
    const link = FS.resolvePath('link', options.checkout)
    await FS.symlink(target, link)
    await Expect(
      registerDirectory({
        path: link,
        checkout: options.checkout,
        purpose: 'fixture',
        cleanupCondition: 'done',
        indexRoot: options.indexRoot,
      }),
    )
      .rejects.toThrow('symbolic links')
    await Expect(
      registerDirectory({
        path: `${options.checkout}/../invalid`,
        checkout: options.checkout,
        purpose: 'fixture',
        cleanupCondition: 'done',
        indexRoot: options.indexRoot,
      }),
    )
      .rejects.toThrow('normalized absolute path')
  })

  Test('a removed registered directory becomes inactive without losing its cleanup provenance', async () => {
    const options = await fixture()
    const path = FS.resolvePath('completed-fixture', options.checkout)
    await FS.mkdir(path)
    const id = await registerDirectory({
      path,
      checkout: options.checkout,
      purpose: 'acceptance',
      cleanupCondition: 'After acceptance.',
      indexRoot: options.indexRoot,
    })
    await FS.remove(path)
    Expect((await inspect(options)).entries[0]).toMatchObject({
      id,
      path,
      classification: 'inactive',
      cleanup: 'After acceptance.',
    })
  })

  Test('a replacement directory cannot inherit its predecessor registration', async () => {
    const options = await fixture()
    const path = FS.resolvePath('replaced-fixture', options.checkout)
    await FS.mkdir(path)
    await registerDirectory({
      path,
      checkout: options.checkout,
      purpose: 'acceptance',
      cleanupCondition: 'After acceptance.',
      indexRoot: options.indexRoot,
    })
    await FS.move(path, FS.resolvePath('old-fixture', options.checkout))
    await FS.mkdir(path)
    const report = await inspect(options)
    Expect(report.entries[0]?.classification).toBe('unverified')
    Expect(report.entries[0]?.reason).toContain('identity changed')
    Expect(await FS.isDirectory(path)).toBe(true)
  })
})
