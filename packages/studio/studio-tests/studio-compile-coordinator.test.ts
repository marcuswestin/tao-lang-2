import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import {
  StudioCompileCoordinator,
  type StudioCompileRequest,
} from '../studio-src/StudioCompileCoordinator'
import {
  type StudioPreviewAppliedMessage,
  studioProtocolChannel,
  studioProtocolVersion,
} from '../studio-src/StudioProtocol'

Describe('Studio compile coordinator', () => {
  Test('serializes compiles and coalesces signals received while compiling', async () => {
    const gates: Array<ReturnType<typeof deferred<void>>> = []
    const requests: StudioCompileRequest[] = []
    let active = 0
    let maximumActive = 0
    const coordinator = new StudioCompileCoordinator({
      appName: 'Garden',
      async compile(request) {
        requests.push(request)
        active += 1
        maximumActive = Math.max(maximumActive, active)
        const gate = deferred<void>()
        gates.push(gate)
        await gate.promise
        active -= 1
      },
      project: '/workspace/garden',
    })

    const initial = coordinator.requestInitialCompile()
    await until(() => gates.length === 1)
    const firstWatch = coordinator.noteWatchChanges([{ path: 'A.tao', sourceVersion: 'a1' }])
    const secondWatch = coordinator.noteWatchChanges([
      { path: 'A.tao', sourceVersion: 'a2' },
      { path: 'B.tao', sourceVersion: 'b1' },
    ])
    gates[0]!.resolve()
    await initial
    await until(() => gates.length === 2)

    Expect(maximumActive).toBe(1)
    Expect(requests).toHaveLength(2)
    Expect(requests[1]?.compileRevision).toBe(2)
    Expect(requests[1]?.causes).toEqual(['watch'])
    Expect(requests[1]?.changes).toEqual([
      { path: 'A.tao', sourceVersion: 'a2' },
      { path: 'B.tao', sourceVersion: 'b1' },
    ])

    gates[1]!.resolve()
    await Promise.all([firstWatch, secondWatch])
    Expect(maximumActive).toBe(1)
  })

  Test('acknowledges the exact filesystem echo of a Studio write without compiling twice', async () => {
    const gate = deferred<void>()
    const requests: StudioCompileRequest[] = []
    const coordinator = new StudioCompileCoordinator({
      appName: 'Garden',
      async compile(request) {
        requests.push(request)
        await gate.promise
      },
      project: '/workspace/garden',
    })

    const write = coordinator.noteStudioWrite({
      path: 'Garden.tao',
      sourceVersion: 'source-2',
      writeId: 'write-2',
    })
    const watch = coordinator.noteWatchChanges([
      { path: 'Garden.tao', sourceVersion: 'source-2' },
      { path: 'Garden.tao', sourceVersion: 'source-2' },
    ])
    await until(() => requests.length === 1)
    gate.resolve()
    const [completion, watchResult] = await Promise.all([write, watch])

    Expect(completion.compileRevision).toBe(1)
    Expect(requests).toHaveLength(1)
    Expect(watchResult.compile).toBe(undefined)
    Expect(watchResult.acknowledgements).toEqual([{
      compileRevision: 1,
      path: 'Garden.tao',
      sourceVersion: 'source-2',
      writeId: 'write-2',
    }])
  })

  Test('treats a same-path watcher event with a different source version as external', async () => {
    const requests: StudioCompileRequest[] = []
    const coordinator = new StudioCompileCoordinator({
      appName: 'Garden',
      async compile(request) {
        requests.push(request)
      },
      project: '/workspace/garden',
    })

    await coordinator.noteStudioWrite({
      path: 'Garden.tao',
      sourceVersion: 'studio-version',
      writeId: 'write-1',
    })
    const result = await coordinator.noteWatchChanges([{ path: 'Garden.tao', sourceVersion: 'external-version' }])

    Expect(requests).toHaveLength(2)
    Expect(result.acknowledgements).toEqual([])
    Expect(result.compile?.changes).toEqual([{ path: 'Garden.tao', sourceVersion: 'external-version' }])
  })

  Test('does not let an obsolete Studio acknowledgement swallow a later external revert', async () => {
    const requests: StudioCompileRequest[] = []
    const coordinator = new StudioCompileCoordinator({
      appName: 'Garden',
      async compile(request) {
        requests.push(request)
      },
      project: '/workspace/garden',
    })

    await coordinator.noteStudioWrite({ path: 'Garden.tao', sourceVersion: 'version-a', writeId: 'write-a' })
    await coordinator.noteStudioWrite({ path: 'Garden.tao', sourceVersion: 'version-b', writeId: 'write-b' })
    const latestEcho = await coordinator.noteWatchChanges([{ path: 'Garden.tao', sourceVersion: 'version-b' }])
    const externalRevert = await coordinator.noteWatchChanges([{ path: 'Garden.tao', sourceVersion: 'version-a' }])

    Expect(latestEcho.acknowledgements.map(item => item.writeId)).toEqual(['write-b'])
    Expect(externalRevert.acknowledgements).toEqual([])
    Expect(externalRevert.compile?.changes).toEqual([{ path: 'Garden.tao', sourceVersion: 'version-a' }])
    Expect(requests).toHaveLength(3)
  })

  Test('tracks applied revisions only from the active matching preview instance', async () => {
    const states: number[] = []
    const coordinator = new StudioCompileCoordinator({
      appName: 'Garden',
      async compile() {},
      onState(state) {
        states.push(state.appliedRevision)
      },
      project: '/workspace/garden',
    })
    coordinator.setPreviewInstance('preview-1')
    const compiled = await coordinator.requestInitialCompile()

    Expect(coordinator.acknowledgePreview(appliedMessage('other-preview', compiled.compileRevision))).toBe(false)
    Expect(coordinator.acknowledgePreview(appliedMessage('preview-1', compiled.compileRevision + 1))).toBe(false)
    Expect(coordinator.acknowledgePreview(appliedMessage('preview-1', compiled.compileRevision))).toBe(true)
    Expect(coordinator.snapshot().appliedRevision).toBe(compiled.compileRevision)
    Expect(coordinator.acknowledgePreview(appliedMessage('preview-1', compiled.compileRevision))).toBe(false)

    coordinator.setPreviewInstance('preview-2')
    Expect(coordinator.snapshot().appliedRevision).toBe(0)
    Expect(states).toContain(compiled.compileRevision)
  })

  Test('continues with a queued revision after a compile error', async () => {
    const gate = deferred<void>()
    const requests: StudioCompileRequest[] = []
    const coordinator = new StudioCompileCoordinator({
      appName: 'Garden',
      async compile(request) {
        requests.push(request)
        if (request.compileRevision === 1) {
          await gate.promise
          throw new Error('Tao source is not valid yet.')
        }
      },
      project: '/workspace/garden',
    })

    const first = coordinator.requestInitialCompile()
    await until(() => requests.length === 1)
    const second = coordinator.noteWatchChanges([{ path: 'Garden.tao', sourceVersion: 'fixed' }])
    gate.resolve()

    Expect((await first).status).toBe('error')
    Expect((await second).compile?.status).toBe('compiled')
    Expect(requests.map(request => request.compileRevision)).toEqual([1, 2])
  })

  Test('preserves structured source locations from compile failures', async () => {
    const coordinator = new StudioCompileCoordinator({
      appName: 'Garden',
      async compile() {
        throw new Errors.UnexpectedBehaviorError('Tao source is not valid yet.', {
          details: {
            diagnostics: [{
              filePath: '/workspace/garden/Card.tao',
              message: 'A #tag must be followed by a render.',
              range: {
                end: { character: 12, line: 8 },
                start: { character: 3, line: 8 },
              },
            }],
          },
        })
      },
      project: '/workspace/garden',
    })

    const completion = await coordinator.requestInitialCompile()

    Expect(completion.diagnostics).toEqual([{
      filePath: '/workspace/garden/Card.tao',
      message: 'A #tag must be followed by a render.',
      range: {
        end: { character: 12, line: 8 },
        start: { character: 3, line: 8 },
      },
    }])
    Expect(coordinator.snapshot().diagnostics).toEqual(completion.diagnostics)
  })
})

function appliedMessage(previewInstanceId: string, revision: number): StudioPreviewAppliedMessage {
  return {
    appliedRevision: revision,
    channel: studioProtocolChannel,
    compileRevision: revision,
    identity: {
      appName: 'Garden',
      previewInstanceId,
      project: '/workspace/garden',
    },
    protocolVersion: studioProtocolVersion,
    type: 'preview-applied',
  }
}

function deferred<T>(): {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
} {
  let reject!: (reason?: unknown) => void
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject
    resolve = promiseResolve
  })
  return { promise, reject, resolve }
}

async function until(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return
    }
    await Promise.resolve()
  }
  throw new Error('Timed out waiting for Studio coordinator state.')
}
