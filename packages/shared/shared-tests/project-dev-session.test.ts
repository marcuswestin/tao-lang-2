import { CLI, FS, Platform, ProjectDevSession } from '@shared'
import { Describe, Expect, mkTestDir, Test, until } from '@shared/test'

Describe('project development session ownership', () => {
  Test('refuses a second process and retains a secret-free completed record', async () => {
    const root = await mkTestDir('tao-dev-owner-')
    const modulePath = FS.resolvePath('../shared-src/ProjectDevSession.ts', import.meta.dir)
    const source = `import { ProjectDevSession } from ${JSON.stringify(modulePath)};`
      + `await ProjectDevSession.acquire(${JSON.stringify(root)}, 'cli', { foregroundInteractive: true });`
      + `console.log('READY'); setInterval(() => {}, 1000);`
    let output = ''
    const child = CLI.start('bun', {
      args: ['-e', source],
      onOutput: (_stream, chunk) => {
        output += chunk.toString()
      },
      stdio: 'pipe',
    })
    try {
      await until(() => output.includes('READY') ? true : undefined, {
        description: 'the child to claim the project',
      })
      let prompted = false
      await Expect(ProjectDevSession.acquire(root, 'studio', {
        foregroundInteractive: true,
        confirmOrphan: async () => {
          prompted = true
          return true
        },
      }))
        .rejects.toThrow('already owned by cli session')
      Expect(prompted).toBe(false)
      const owner = await FS.readJson<{ id: string }>(FS.resolvePath('.tao/local/sessions/owner.json', root))
      child.kill('SIGKILL')
      await child.waitForClose()
      const recovered = await ProjectDevSession.acquire(root, 'studio')
      await recovered.release()
      const interrupted = await FS.readJson<{ status: string }>(
        FS.resolvePath(`.tao/local/sessions/${owner.id}.json`, root),
      )
      const completed = await FS.readJson<{ status: string }>(
        FS.resolvePath(`.tao/local/sessions/${recovered.record.id}.json`, root),
      )
      Expect(interrupted.status).toBe('interrupted')
      Expect(completed.status).toBe('completed')
      Expect(await FS.isFile(FS.resolvePath('.tao/local/sessions/owner.json', root))).toBe(false)
      const recordText = await FS.readText(FS.resolvePath(`.tao/local/sessions/${recovered.record.id}.json`, root))
      Expect(recordText).not.toContain('capability')
      Expect(recordText).not.toContain('token')
      Expect(await FS.listDir(FS.resolvePath('.tao/cache/locks', root))).toEqual([])
    } finally {
      child.kill('SIGKILL')
      await child.waitForClose()
      await child.closeOutput()
      await FS.remove(root)
    }
  })

  Test('accepts confirmed orphan cleanup only after the original parent identity is gone', async () => {
    const root = await mkTestDir('tao-dev-orphan-')
    const child = await startSessionChild(root)
    try {
      const owner = await markParentReused(root)
      const phases: string[] = []
      const acquired = await ProjectDevSession.acquire(root, 'studio', {
        foregroundInteractive: true,
        confirmOrphan: async candidate => {
          Expect(candidate.id).toBe(owner.id)
          return true
        },
        onOrphanCleanup: phase => phases.push(phase),
      })
      await acquired.release()
      Expect(phases).toEqual(['stopping', 'stopped'])
      const interrupted = await FS.readJson<{ status: string }>(
        FS.resolvePath(`.tao/local/sessions/${owner.id}.json`, root),
      )
      Expect(interrupted.status).toBe('interrupted')
      Expect(await FS.isFile(ownerPath(root))).toBe(false)
    } finally {
      child.kill('SIGKILL')
      await child.waitForClose()
      await child.closeOutput()
      await FS.remove(root)
    }
  })

  Test('declines orphan cleanup without changing or signalling the owner', async () => {
    const root = await mkTestDir('tao-dev-orphan-decline-')
    const child = await startSessionChild(root)
    try {
      const owner = await markParentReused(root)
      await Expect(ProjectDevSession.acquire(root, 'studio', {
        foregroundInteractive: true,
        confirmOrphan: async () => false,
      })).rejects.toThrow('already owned by cli session')
      const current = await FS.readJson<SessionOwnerFixture>(ownerPath(root))
      Expect(current.id).toBe(owner.id)
      Expect(Platform.processIsAlive(child.pid!)).toBe(true)
    } finally {
      child.kill('SIGKILL')
      await child.waitForClose()
      await child.closeOutput()
      await FS.remove(root)
    }
  })

  Test('refuses an orphan without an explicit interactive confirmation callback', async () => {
    const root = await mkTestDir('tao-dev-orphan-noninteractive-')
    const child = await startSessionChild(root)
    try {
      const owner = await markParentReused(root)
      let prompted = false
      await Expect(ProjectDevSession.acquire(root, 'studio', {
        foregroundInteractive: false,
        confirmOrphan: async () => {
          prompted = true
          return true
        },
      })).rejects.toThrow('already owned by cli session')
      Expect(prompted).toBe(false)
      Expect((await FS.readJson<SessionOwnerFixture>(ownerPath(root))).id).toBe(owner.id)
      Expect(Platform.processIsAlive(child.pid!)).toBe(true)
    } finally {
      child.kill('SIGKILL')
      await child.waitForClose()
      await child.closeOutput()
      await FS.remove(root)
    }
  })

  Test('does not prompt for a live legacy owner with no exact process identities', async () => {
    const root = await mkTestDir('tao-dev-legacy-owner-')
    try {
      await FS.mkdir(FS.resolvePath('.tao/local/sessions', root))
      const owner: SessionOwnerFixture = {
        version: 1,
        id: '11111111-1111-4111-8111-111111111111',
        owner: 'cli',
        pid: process.pid,
      }
      await FS.writeJson(ownerPath(root), owner)
      let prompted = false
      await Expect(ProjectDevSession.acquire(root, 'studio', {
        foregroundInteractive: true,
        confirmOrphan: async () => {
          prompted = true
          return true
        },
      })).rejects.toThrow('already owned by cli session')
      Expect(prompted).toBe(false)
      Expect((await FS.readJson<SessionOwnerFixture>(ownerPath(root))).id).toBe(owner.id)
    } finally {
      await FS.remove(root)
    }
  })

  Test('does not signal or overwrite a replacement owner after the prompt', async () => {
    const root = await mkTestDir('tao-dev-owner-race-')
    const child = await startSessionChild(root)
    try {
      const owner = await markParentReused(root)
      const replacement = { ...owner, id: '22222222-2222-4222-8222-222222222222' }
      await Expect(ProjectDevSession.acquire(root, 'studio', {
        foregroundInteractive: true,
        confirmOrphan: async () => {
          await FS.writeJson(ownerPath(root), replacement)
          return true
        },
      })).rejects.toThrow('already owned by cli session')
      Expect((await FS.readJson<SessionOwnerFixture>(ownerPath(root))).id).toBe(replacement.id)
      Expect(Platform.processIsAlive(child.pid!)).toBe(true)
    } finally {
      child.kill('SIGKILL')
      await child.waitForClose()
      await child.closeOutput()
      await FS.remove(root)
    }
  })

  Test('treats a reused owner PID as stale and recovers it without prompting', async () => {
    const root = await mkTestDir('tao-dev-owner-reuse-')
    try {
      await FS.mkdir(FS.resolvePath('.tao/local/sessions', root))
      const owner: SessionOwnerFixture = {
        version: 2,
        id: '33333333-3333-4333-8333-333333333333',
        owner: 'cli',
        pid: process.pid,
        ownerIdentity: { pid: process.pid, startedAt: 'reused-pid-start', command: 'bun' },
        parentIdentity: { pid: process.ppid, startedAt: 'unrelated-parent-start', command: 'bun' },
        foregroundInteractive: true,
      }
      await FS.writeJson(ownerPath(root), owner)
      let prompted = false
      const recovered = await ProjectDevSession.acquire(root, 'studio', {
        foregroundInteractive: true,
        confirmOrphan: async () => {
          prompted = true
          return true
        },
      })
      const current = await FS.readJson<SessionOwnerFixture>(ownerPath(root))
      Expect(current.id).toBe(recovered.record.id)
      await recovered.release()
      Expect(prompted).toBe(false)
      Expect(current.id).not.toBe(owner.id)
    } finally {
      await FS.remove(root)
    }
  })

  Test('refuses a confirmed orphan whose exact process does not stop on SIGTERM', async () => {
    const root = await mkTestDir('tao-dev-orphan-signal-failure-')
    const child = await startSessionChild(root, true)
    try {
      const owner = await markParentReused(root)
      await Expect(ProjectDevSession.acquire(root, 'studio', {
        foregroundInteractive: true,
        confirmOrphan: async () => true,
      })).rejects.toThrow('already owned by cli session')
      Expect((await FS.readJson<SessionOwnerFixture>(ownerPath(root))).id).toBe(owner.id)
    } finally {
      child.kill('SIGKILL')
      await child.waitForClose()
      await child.closeOutput()
      await FS.remove(root)
    }
  })
})

type SessionOwnerFixture = {
  version: 1 | 2
  id: string
  owner: 'cli' | 'studio'
  pid: number
  ownerIdentity?: { pid: number; startedAt: string; command: string }
  parentIdentity?: { pid: number; startedAt: string; command: string }
  foregroundInteractive?: boolean
}

function ownerPath(root: string): string {
  return FS.resolvePath('.tao/local/sessions/owner.json', root)
}

async function startSessionChild(root: string, ignoreTermination = false) {
  const modulePath = FS.resolvePath('../shared-src/ProjectDevSession.ts', import.meta.dir)
  const source = `import { ProjectDevSession } from ${JSON.stringify(modulePath)};`
    + `await ProjectDevSession.acquire(${JSON.stringify(root)}, 'cli', { foregroundInteractive: true });`
    + (ignoreTermination ? `process.on('SIGTERM', () => {});` : '')
    + `console.log('READY'); setInterval(() => {}, 1000);`
  let output = ''
  const child = CLI.start('bun', {
    args: ['-e', source],
    onOutput: (_stream, chunk) => {
      output += chunk.toString()
    },
    stdio: 'pipe',
  })
  await until(() => output.includes('READY') ? true : undefined, {
    description: 'the child to claim the project',
  })
  return child
}

async function markParentReused(root: string): Promise<SessionOwnerFixture> {
  const owner = await FS.readJson<SessionOwnerFixture>(ownerPath(root))
  Expect(owner.version).toBe(2)
  Expect(owner.ownerIdentity).toBeDefined()
  Expect(owner.parentIdentity).toBeDefined()
  const orphaned = {
    ...owner,
    parentIdentity: { ...owner.parentIdentity!, startedAt: 'parent-pid-reused' },
  }
  await FS.writeJson(ownerPath(root), orphaned)
  return orphaned
}
