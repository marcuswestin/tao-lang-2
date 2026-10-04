import { Errors } from '@shared/core'
import type { StudioPreviewManifestV2 } from '../../StudioPreviewManifest'
import type { StudioCompileState } from '../StudioApiClient'
import { type StudioPreviewConnection, StudioPreviewPublication } from './StudioPreviewConnection'

type MatrixState = {
  compile: StudioCompileState
  connections: readonly StudioPreviewConnection[]
  generation: number
  manifest: StudioPreviewManifestV2 | undefined
  wake: Set<() => void>
}

const matrices = new WeakMap<HTMLElement, MatrixState>()
const owners = new WeakMap<StudioPreviewConnection, MatrixState>()

function sameExpected(preview: StudioPreviewConnection, manifest: StudioPreviewManifestV2): boolean {
  const applied = preview.acknowledgedPublication
  if (applied?.previewInstanceId !== preview.previewInstanceId) {
    return false
  }
  if (preview.cell === undefined) {
    return applied.identity.compileRevision === manifest.compileRevision
  }
  const expected = preview.cellIdentity
  return expected !== undefined
    && expected.compileRevision === manifest.compileRevision
    && applied.identity.cellId === expected.cellId
    && applied.identity.cellRevision === expected.cellRevision
    && applied.identity.compileRevision === expected.compileRevision
    && applied.identity.manifestRevision === expected.manifestRevision
}

function expectedIdentity(preview: StudioPreviewConnection, manifest: StudioPreviewManifestV2) {
  if (preview.cell !== undefined) {
    return preview.cellIdentity?.compileRevision === manifest.compileRevision ? preview.cellIdentity : undefined
  }
  return { compileRevision: manifest.compileRevision }
}

function currentPeers(state: MatrixState): StudioPreviewConnection[] {
  return state.connections.filter(preview => preview.activated === true && preview.startupPending !== true)
}

function notify(state: MatrixState): void {
  for (const wake of state.wake) {
    wake()
  }
  state.wake.clear()
  const manifest = state.manifest
  if (
    manifest === undefined || state.compile.status === 'compiling'
    || state.compile.status !== 'error' && manifest.compileRevision !== state.compile.compileRevision
  ) {
    for (const peer of currentPeers(state)) {
      StudioPreviewPublication.cancel(peer)
    }
    return
  }
  const peers = currentPeers(state)
  const hasCurrentAcknowledgement = peers.some(peer => sameExpected(peer, manifest))
  for (const peer of peers) {
    const identity = expectedIdentity(peer, manifest)
    if (identity !== undefined) {
      StudioPreviewPublication.expect(peer, identity, hasCurrentAcknowledgement ? 3_000 : 6_000)
    } else {
      StudioPreviewPublication.cancel(peer)
    }
  }
}

function ready(state: MatrixState): boolean {
  if (state.compile.status === 'compiling') {
    return false
  }
  const manifest = state.manifest
  if (manifest === undefined) {
    return false
  }
  if (state.compile.status !== 'error' && manifest.compileRevision !== state.compile.compileRevision) {
    return false
  }
  return currentPeers(state).every(peer => sameExpected(peer, manifest))
}

export const StudioPreviewActivationGate = {
  attach(
    parent: HTMLElement,
    compile: StudioCompileState | undefined,
    manifest: StudioPreviewManifestV2 | undefined,
    connections: readonly StudioPreviewConnection[],
  ): void {
    const initialCompile = compile ?? {
      appliedRevision: manifest?.compileRevision ?? 0,
      compileRevision: manifest?.compileRevision ?? 0,
      diagnostics: [],
      message: '',
      status: 'compiled',
    }
    let state = matrices.get(parent)
    if (state === undefined) {
      state = { compile: initialCompile, connections, generation: 0, manifest, wake: new Set() }
      matrices.set(parent, state)
    } else {
      if (compile === undefined) {
        state.compile = initialCompile
      }
      if (state.manifest !== manifest || state.connections !== connections) {
        state.generation++
      }
      state.manifest = manifest
      state.connections = connections
    }
    for (const connection of connections) {
      owners.set(connection, state)
      connection.previewStateChanged = () => notify(state)
    }
    notify(state)
  },
  compile(parent: HTMLElement, compile: StudioCompileState): void {
    const state = matrices.get(parent)
    if (state === undefined) {
      return
    }
    state.compile = compile
    state.generation++
    notify(state)
  },
  manifest(parent: HTMLElement, manifest: StudioPreviewManifestV2): void {
    const state = matrices.get(parent)
    if (state === undefined) {
      return
    }
    state.manifest = manifest
    state.generation++
    notify(state)
  },
  changed(connection: StudioPreviewConnection): void {
    const state = owners.get(connection)
    if (state !== undefined) {
      notify(state)
    }
  },
  generation(parent: HTMLElement): number {
    return matrices.get(parent)?.generation ?? 0
  },
  async wait(
    parent: HTMLElement,
    deadline: number,
    contextManifest: () => StudioPreviewManifestV2 | undefined,
    signal?: AbortSignal,
  ): Promise<number> {
    const state = matrices.get(parent)
    if (state === undefined) {
      Errors.throwUnexpected('Expected: an attached Studio preview matrix before activation.')
    }
    while (!ready(state) || state.manifest !== contextManifest()) {
      if (signal?.aborted) {
        throw Errors.abortError('Tao Studio preview activation was cancelled.')
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        Errors.throwHostEnvironment('The preview did not finish updating before activation timed out. Try again.')
      }
      await new Promise<void>((resolve, reject) => {
        const abort = (): void => {
          clearTimeout(timeout)
          state.wake.delete(wake)
          reject(Errors.abortError('Tao Studio preview activation was cancelled.'))
        }
        const timeout = setTimeout(() => {
          state.wake.delete(wake)
          signal?.removeEventListener('abort', abort)
          reject(
            new Errors.HostEnvironmentError(
              'The preview did not finish updating before activation timed out. Try again.',
            ),
          )
        }, remaining)
        const wake = (): void => {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', abort)
          resolve()
        }
        state.wake.add(wake)
        signal?.addEventListener('abort', abort, { once: true })
      })
    }
    if (signal?.aborted) {
      throw Errors.abortError('Tao Studio preview activation was cancelled.')
    }
    return state.generation
  },
} as const
