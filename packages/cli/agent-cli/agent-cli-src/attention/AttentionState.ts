import { Errors, FS, Platform, ProcessTree } from '@shared'

type Owner = { token: string; pid: number; startedAt: string; stop: boolean; root: string }

/** One lifetime claim shared by all worktrees, retained until every native effect has drained. */
export class AttentionState {
  readonly directory: string
  readonly path: string

  constructor(directory = FS.resolvePath('.cache/tao/developer-attention', FS.homeDir())) {
    this.directory = directory
    this.path = FS.resolvePath('owner.json', directory)
  }

  async claim(root: string): Promise<string | undefined> {
    return await this.mutate(async () => {
      const owner = await this.read()
      if (owner !== undefined && this.isAlive(owner)) {
        return undefined
      }
      const own = ProcessTree.identities([Platform.runtimeProcess.pid]).get(Platform.runtimeProcess.pid)
      if (own === undefined) {
        Errors.throwHostEnvironment('Cannot establish the attention loop process identity.')
      }
      const token = Platform.randomUUID()
      await this.publish({ token, pid: own.pid, startedAt: own.startedAt, stop: false, root })
      return token
    })
  }

  async stop(): Promise<void> {
    await this.mutate(async () => {
      const owner = await this.read()
      if (owner === undefined) {
        return
      }
      if (!this.isAlive(owner)) {
        await FS.remove(this.path)
      } else {
        await this.publish({ ...owner, stop: true })
      }
    })
  }

  async active(token: string): Promise<boolean> {
    const owner = await this.read()
    return owner?.token === token && !owner.stop
  }

  async currentToken(): Promise<string | undefined> {
    const owner = await this.read()
    return owner?.stop === false ? owner.token : undefined
  }

  async release(token: string): Promise<void> {
    await this.mutate(async () => {
      if ((await this.read())?.token === token) {
        await FS.remove(this.path)
      }
    })
  }

  private isAlive(owner: Owner): boolean {
    // Inspection errors fail closed; a timestamp, never PID alone, proves ownership.
    const current = ProcessTree.identities([owner.pid]).get(owner.pid)
    return current === undefined ? Platform.processIsAlive(owner.pid) : current.startedAt === owner.startedAt
  }

  private async read(): Promise<Owner | undefined> {
    try {
      return await FS.readJson<Owner>(this.path)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined
      }
      throw cause
    }
  }

  private async publish(owner: Owner): Promise<void> {
    const temporary = `${this.path}.${Platform.randomUUID()}.tmp`
    try {
      await FS.writeJson(temporary, owner, { mode: 0o600 })
      await FS.moveFileWithinBoundary(temporary, this.path, this.directory)
    } finally {
      await FS.remove(temporary)
    }
  }

  private async mutate<T>(work: () => Promise<T>): Promise<T> {
    await FS.mkdir(this.directory)
    return await FS.withFileMutationLock(this.path, this.directory, work)
  }
}
