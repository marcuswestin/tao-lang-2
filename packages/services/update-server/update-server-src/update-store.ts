import { Errors, FS, Platform } from '@shared'
import type { StoredAsset, StoredUpdate } from './update-types'

/** UpdateStore is the persistence seam a later Tao Lang host can replace without changing HTTP semantics. */
export type UpdateStore = {
  asset(hash: string): Promise<StoredAsset | undefined>
  history(applicationId: string, channel: string): Promise<readonly StoredUpdate[]>
  putAsset(asset: StoredAsset): Promise<'created' | 'existing'>
  putUpdate(update: StoredUpdate): Promise<void>
  update(applicationId: string, channel: string, updateId: string): Promise<StoredUpdate | undefined>
}

/** UpdateStoreConflictError reports an attempted mutation of immutable update state. */
export class UpdateStoreConflictError extends Errors.UserInputError {
  constructor(message: string) {
    super(message)
  }
}

/** InMemoryUpdateStore is a deterministic injected store for tests and embedded hosts. */
export class InMemoryUpdateStore implements UpdateStore {
  readonly #assets = new Map<string, StoredAsset>()
  readonly #updates = new Map<string, StoredUpdate[]>()

  async asset(hash: string): Promise<StoredAsset | undefined> {
    const asset = this.#assets.get(hash)
    return asset === undefined ? undefined : copyAsset(asset)
  }

  async history(applicationId: string, channel: string): Promise<readonly StoredUpdate[]> {
    return (this.#updates.get(channelKey(applicationId, channel)) ?? []).map(copyUpdate)
  }

  async putAsset(asset: StoredAsset): Promise<'created' | 'existing'> {
    const existing = this.#assets.get(asset.hash)
    if (existing !== undefined) {
      assertSameAsset(existing, asset)
      return 'existing'
    }
    this.#assets.set(asset.hash, copyAsset(asset))
    return 'created'
  }

  async putUpdate(update: StoredUpdate): Promise<void> {
    const publication = update.publication
    const key = channelKey(publication.applicationId, publication.channel)
    const history = this.#updates.get(key) ?? []
    if (history.some(candidate => candidate.publication.manifest.id === publication.manifest.id)) {
      throw new UpdateStoreConflictError(`Update '${publication.manifest.id}' already exists.`)
    }
    history.push(copyUpdate(update))
    this.#updates.set(key, history)
  }

  async update(applicationId: string, channel: string, updateId: string): Promise<StoredUpdate | undefined> {
    return (this.#updates.get(channelKey(applicationId, channel)) ?? [])
      .map(copyUpdate)
      .find(candidate => candidate.publication.manifest.id === updateId)
  }
}

type FileStoreState = {
  updates: StoredUpdate[]
  version: 1
}

/** FilesystemUpdateStore is the minimal durable store for a single Bun update-server process. */
export class FilesystemUpdateStore implements UpdateStore {
  readonly #root: string
  #writes: Promise<void> = Promise.resolve()

  constructor(root: string) {
    this.#root = FS.resolvePath(root)
  }

  async asset(hash: string): Promise<StoredAsset | undefined> {
    const metadataPath = this.#assetMetadataPath(hash)
    if (!await FS.isFile(metadataPath)) {
      return undefined
    }
    const metadata = await FS.readJson<Omit<StoredAsset, 'bytes'>>(metadataPath)
    return { ...metadata, bytes: await FS.readFile(this.#assetBodyPath(hash)) }
  }

  async history(applicationId: string, channel: string): Promise<readonly StoredUpdate[]> {
    const state = await this.#state()
    return state.updates
      .filter(update => update.publication.applicationId === applicationId && update.publication.channel === channel)
      .map(copyUpdate)
  }

  async putAsset(asset: StoredAsset): Promise<'created' | 'existing'> {
    return await this.#serialize(async () => {
      const existing = await this.asset(asset.hash)
      if (existing !== undefined) {
        assertSameAsset(existing, asset)
        return 'existing'
      }
      await FS.writeFile(this.#assetBodyPath(asset.hash), asset.bytes)
      const { bytes: _bytes, ...metadata } = asset
      await FS.writeJson(this.#assetMetadataPath(asset.hash), metadata)
      return 'created'
    })
  }

  async putUpdate(update: StoredUpdate): Promise<void> {
    await this.#serialize(async () => {
      const state = await this.#state()
      if (
        state.updates.some(candidate =>
          candidate.publication.applicationId === update.publication.applicationId
          && candidate.publication.channel === update.publication.channel
          && candidate.publication.manifest.id === update.publication.manifest.id
        )
      ) {
        throw new UpdateStoreConflictError(`Update '${update.publication.manifest.id}' already exists.`)
      }
      state.updates.push(copyUpdate(update))
      await this.#writeState(state)
    })
  }

  async update(applicationId: string, channel: string, updateId: string): Promise<StoredUpdate | undefined> {
    return (await this.history(applicationId, channel))
      .find(candidate => candidate.publication.manifest.id === updateId)
  }

  async #serialize<ValueT>(operation: () => Promise<ValueT>): Promise<ValueT> {
    const result = this.#writes.then(operation, operation)
    this.#writes = result.then(() => undefined, () => undefined)
    return await result
  }

  async #state(): Promise<FileStoreState> {
    const path = this.#statePath()
    return await FS.isFile(path) ? await FS.readJson<FileStoreState>(path) : { updates: [], version: 1 }
  }

  async #writeState(state: FileStoreState): Promise<void> {
    const path = this.#statePath()
    const temporary = `${path}.${Platform.randomUUID()}.tmp`
    await FS.writeJson(temporary, state)
    await FS.move(temporary, path)
  }

  #assetBodyPath(hash: string): string {
    return FS.resolvePath(`assets/${hash}.bin`, this.#root)
  }

  #assetMetadataPath(hash: string): string {
    return FS.resolvePath(`assets/${hash}.json`, this.#root)
  }

  #statePath(): string {
    return FS.resolvePath('state.json', this.#root)
  }
}

function assertSameAsset(existing: StoredAsset, proposed: StoredAsset): void {
  if (
    existing.contentType !== proposed.contentType
    || existing.fileExtension !== proposed.fileExtension
    || existing.url !== proposed.url
    || !bytesEqual(existing.bytes, proposed.bytes)
  ) {
    throw new UpdateStoreConflictError(`Asset '${proposed.hash}' is immutable and already has different metadata.`)
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function channelKey(applicationId: string, channel: string): string {
  return `${applicationId}\u0000${channel}`
}

function copyAsset(asset: StoredAsset): StoredAsset {
  return { ...asset, bytes: asset.bytes.slice() }
}

function copyUpdate(update: StoredUpdate): StoredUpdate {
  return structuredClone(update)
}
