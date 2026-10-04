import { Errors } from '@shared/core'
import { Deferred, Expect, settle, Test, testOverrideSlot, until } from '@shared/test'
import { StudioMatrixGrid } from '../studio-src/client/matrix/StudioMatrixGrid'
import { StudioMatrixSketches } from '../studio-src/client/matrix/StudioMatrixSketches'
import { StudioDrawCanvas } from '../studio-src/client/matrix/StudioMatrixSketches'
import { StudioPreviewActivationGate } from '../studio-src/client/matrix/StudioPreviewActivationGate'
import { reconcilePreviewActivation } from '../studio-src/client/matrix/StudioPreviewActivationWiring'
import { disconnectPreviews, StudioPreviewPublication } from '../studio-src/client/matrix/StudioPreviewConnection'
import type { StudioPreviewConnection } from '../studio-src/client/matrix/StudioPreviewConnection'
import {
  refreshCellPreviews,
  startRestoredPreviews,
  wireActivation,
} from '../studio-src/client/matrix/StudioPreviewMatrix'
import { StudioApiClient, type StudioHandshake } from '../studio-src/client/StudioApiClient'
import type { StudioPreviewCell, StudioPreviewManifestV2 } from '../studio-src/StudioPreviewManifest'

const windowSlot = testOverrideSlot<PropertyDescriptor | undefined>({
  equals: (left, right) => left?.value === right?.value,
  read: () => Object.getOwnPropertyDescriptor(globalThis, 'window'),
  write: value => {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, 'window')
    } else {
      Object.defineProperty(globalThis, 'window', value)
    }
  },
})
const cellInstanceSlot = testOverrideSlot({
  read: () => StudioApiClient.cellInstance,
  write: value => {
    Reflect.set(StudioApiClient, 'cellInstance', value)
  },
})
const saveSessionSlot = testOverrideSlot({
  read: () => StudioApiClient.saveStudioSessionField,
  write: value => {
    Reflect.set(StudioApiClient, 'saveStudioSessionField', value)
  },
})
const releaseInstanceSlot = testOverrideSlot({
  read: () => StudioApiClient.releaseCellInstance,
  write: value => {
    Reflect.set(StudioApiClient, 'releaseCellInstance', value)
  },
})
const previewInstanceSlot = testOverrideSlot({
  read: () => StudioApiClient.previewInstance,
  write: value => {
    Reflect.set(StudioApiClient, 'previewInstance', value)
  },
})
const documentSlot = testOverrideSlot<PropertyDescriptor | undefined>({
  equals: (left, right) => left?.value === right?.value,
  read: () => Object.getOwnPropertyDescriptor(globalThis, 'document'),
  write: value => {
    if (value === undefined) {
      Reflect.deleteProperty(globalThis, 'document')
    } else {
      Object.defineProperty(globalThis, 'document', value)
    }
  },
})

const handshake = { identity: { appName: 'Demo', project: '/project' } } as StudioHandshake
const previewUrl = 'http://localhost:19006/'
const cell = (id: string, revision = 1): StudioPreviewCell => ({
  args: { Count: revision },
  cellId: id,
  cellRevision: revision,
  environment: {
    network: { latencyMs: 0, outcome: 'normal' },
    scheme: { capability: 'reactive-browser', requested: 'light', resolved: 'light', source: 'scenario' },
    viewport: { height: 844, width: 360 + revision },
  },
  scenarioId: 'scenario',
  stateLayers: [],
})
const manifest = (...cells: StudioPreviewCell[]): StudioPreviewManifestV2 => ({
  capabilities: { captureDomains: [], scheme: 'reactive-browser' },
  cells,
  compileRevision: 1,
  fixtures: [],
  generationDeclarations: [],
  manifestRevision: 'manifest-1',
  parametersBySubject: {},
  project: { appName: 'Demo', entryPath: '/project/Main.tao', root: '/project' },
  scenarios: [{
    args: {},
    label: 'Scenario',
    prepare: [],
    scenarioId: 'scenario',
    group: 'states',
    source: { kind: 'tao', path: 'Main.tao', range: { start: 0, end: 1 } },
    stateLayers: [],
    subjectId: 'app',
  }],
  sourceVersions: {},
  states: [],
  subjects: [],
  version: 2,
})
const connection = (previewCell: StudioPreviewCell): StudioPreviewConnection => ({
  activated: false,
  cell: previewCell,
  iframe: { src: '', remove() {} } as HTMLIFrameElement,
  interactionMode: 'run',
  origin: previewUrl,
  previewInstanceId: `preview-${previewCell.cellId}`,
})

Test('Studio replan keeps focus and chrome updates attached to the latest activation callback', async () => {
  const restoreWindow = windowSlot.install({
    configurable: true,
    value: {
      location: { origin: 'http://localhost:1234', pathname: '/studio' },
    },
  })
  const registered: string[] = []
  const restoreRegistration = cellInstanceSlot.install(async body => {
    registered.push((body as { previewInstanceId: string }).previewInstanceId)
    return {}
  })
  const released: string[] = []
  const restoreRelease = releaseInstanceSlot.install(async id => {
    released.push(id)
  })
  const saved: string[][] = []
  const restoreSession = saveSessionSlot.install(async (_field, value) => {
    saved.push(value as string[])
  })
  try {
    const parent = {} as HTMLElement
    const preview = connection(cell('a'))
    const previews = [preview]
    const wired = new WeakMap<StudioPreviewConnection, () => Promise<void>>()
    const focused: boolean[] = []
    const refresh = (): void =>
      reconcilePreviewActivation(previews, wired, current => {
        focused.push(current.activated === true)
      })
    wireActivation(parent, previews, manifest(preview.cell!), previewUrl, handshake)
    refresh()
    await preview.toggleActivation?.()
    wireActivation(parent, previews, manifest(preview.cell!), previewUrl, handshake)
    refresh()
    await preview.toggleActivation?.()
    Expect(saved).toEqual([['a'], []])
    Expect(released).toEqual(registered)
    Expect(focused).toEqual([true, false])
    Expect(preview.activated).toBe(false)
  } finally {
    restoreSession()
    restoreRelease()
    restoreRegistration()
    restoreWindow()
  }
})

Test(
  'Studio serializes rapid activation with the latest revision and keeps failed saves out of the matrix state',
  async () => {
    const restoreWindow = windowSlot.install({
      configurable: true,
      value: {
        location: { origin: 'http://localhost:1234', pathname: '/studio' },
      },
    })
    const firstRegistration = Deferred<void>()
    const registrations: { cellId: string; cellRevision: number; compileRevision: number }[] = []
    const restoreRegistration = cellInstanceSlot.install(async body => {
      const identity = body as { cellId: string; cellRevision: number; compileRevision: number }
      registrations.push(identity)
      if (identity.cellId === 'a') {
        await firstRegistration.promise
      }
      return {}
    })
    const saved: string[][] = []
    let rejectNextSave = false
    const restoreSession = saveSessionSlot.install(async (_field, value) => {
      if (rejectNextSave) {
        rejectNextSave = false
        Errors.throwHostEnvironment('session save failed')
      }
      saved.push(value as string[])
    })
    let first: Promise<void> | undefined
    let second: Promise<void> | undefined
    try {
      const parent = {} as HTMLElement
      const previews = [connection(cell('a')), connection(cell('b'))]
      wireActivation(parent, previews, manifest(...previews.map(preview => preview.cell!)), previewUrl, handshake)
      first = previews[0]!.toggleActivation!()
      second = previews[1]!.toggleActivation!()
      await settle()
      Expect(saved).toEqual([])
      previews[1]!.cell = cell('b', 2)
      const updatedManifest = {
        ...manifest(...previews.map(preview => preview.cell!)),
        compileRevision: 2,
        manifestRevision: 'manifest-2',
      }
      wireActivation(parent, previews, updatedManifest, previewUrl, handshake)
      firstRegistration.resolve()
      await first
      const firstPreview = previews[0]!
      StudioPreviewPublication.acknowledged(
        firstPreview,
        firstPreview.cellIdentity!,
        firstPreview.previewInstanceId,
      )
      StudioPreviewActivationGate.changed(firstPreview)
      await second
      Expect(saved).toEqual([['a'], ['a', 'b']])
      Expect(previews.map(preview => preview.activated)).toEqual([true, true])
      Expect(
        registrations.map(({ cellId, cellRevision, compileRevision }) => ({ cellId, cellRevision, compileRevision })),
      ).toEqual([
        { cellId: 'a', cellRevision: 1, compileRevision: 1 },
        { cellId: 'a', cellRevision: 1, compileRevision: 2 },
        { cellId: 'b', cellRevision: 2, compileRevision: 2 },
      ])
      rejectNextSave = true
      let failed = false
      try {
        await previews[0]!.toggleActivation!()
      } catch {
        failed = true
      }
      Expect(failed).toBe(true)
      Expect(previews.map(preview => preview.activated)).toEqual([true, true])
      Expect(saved.at(-1)).toEqual(['a', 'b'])
      await previews[0]!.toggleActivation!()
      Expect(saved.at(-1)).toEqual(['b'])
    } finally {
      firstRegistration.resolve()
      await Promise.allSettled([first, second].filter((pending): pending is Promise<void> => pending !== undefined))
      restoreSession()
      restoreRegistration()
      restoreWindow()
    }
  },
)

Test('Studio activation gate wakes on disconnect and bounds abort and timeout', async () => {
  const parent = {} as HTMLElement
  const published = manifest(cell('peer'))
  const peer = connection(published.cells[0]!)
  peer.activated = true
  peer.cellIdentity = {
    appName: 'Demo',
    cellId: 'peer',
    cellRevision: 1,
    compileRevision: 1,
    manifestRevision: 'manifest-1',
    project: '/project',
  }
  const compile = { appliedRevision: 1, compileRevision: 1, diagnostics: [], message: '', status: 'compiled' } as const
  StudioPreviewActivationGate.attach(parent, compile, published, [peer])
  const controller = new AbortController()
  const aborted = StudioPreviewActivationGate.wait(parent, Date.now() + 30_000, () => published, controller.signal)
  controller.abort()
  let abortName = ''
  try {
    await aborted
  } catch (error) {
    abortName = Errors.asError(error).name
  }
  Expect(abortName).toBe('AbortError')

  let timedOut = false
  try {
    await StudioPreviewActivationGate.wait(parent, Date.now() - 1, () => published)
  } catch (error) {
    timedOut = error instanceof Errors.HostEnvironmentError
  }
  Expect(timedOut).toBe(true)

  const removed = StudioPreviewActivationGate.wait(parent, Date.now() + 30_000, () => published)
  StudioPreviewActivationGate.attach(parent, compile, published, [])
  await removed
  StudioPreviewActivationGate.attach(parent, compile, published, [peer])
  const dropped = StudioPreviewActivationGate.wait(parent, Date.now() + 30_000, () => published)
  disconnectPreviews([peer])
  await dropped
  Expect(peer.activated).toBe(false)
  StudioPreviewPublication.cancel(peer)
})

Test('Studio reloads one lagging peer once after another peer acknowledges the publication', async () => {
  const parent = {} as HTMLElement
  const published = manifest(cell('first'), cell('lagging'))
  const first = connection(published.cells[0]!)
  const lagging = connection(published.cells[1]!)
  let reloads = 0
  Object.defineProperty(lagging.iframe, 'src', {
    get: () => previewUrl,
    set: () => {
      reloads++
      StudioPreviewPublication.loaded(lagging)
    },
  })
  for (const preview of [first, lagging]) {
    preview.activated = true
    preview.cellIdentity = {
      appName: 'Demo',
      cellId: preview.cell!.cellId,
      cellRevision: 1,
      compileRevision: 1,
      manifestRevision: 'manifest-1',
      project: '/project',
    }
  }
  const compile = { appliedRevision: 1, compileRevision: 1, diagnostics: [], message: '', status: 'compiled' } as const
  try {
    StudioPreviewActivationGate.attach(parent, compile, published, [first, lagging])
    Expect(lagging.pendingPublication?.normalWaitMs).toBe(6_000)
    StudioPreviewPublication.acknowledged(first, first.cellIdentity!, first.previewInstanceId)
    StudioPreviewActivationGate.changed(first)
    Expect(lagging.pendingPublication?.normalWaitMs).toBe(3_000)
    await until(() => reloads === 1, { description: 'one lagging preview recovery reload' })
    Expect(reloads).toBe(1)
  } finally {
    StudioPreviewPublication.cancel(first)
    StudioPreviewPublication.cancel(lagging)
  }
})

Test('Studio activates the latest same-cell revision after registration and session saves race replans', async () => {
  const restoreWindow = windowSlot.install({
    configurable: true,
    value: { location: { origin: 'http://localhost:1234', pathname: '/studio' } },
  })
  const registrationStarted = Deferred<void>()
  const firstRegistration = Deferred<void>()
  const saveStarted = Deferred<void>()
  const firstSave = Deferred<void>()
  const registrations: { cellRevision: number; compileRevision: number; previewInstanceId: string }[] = []
  const restoreRegistration = cellInstanceSlot.install(async body => {
    const identity = body as { cellRevision: number; compileRevision: number; previewInstanceId: string }
    registrations.push(identity)
    if (registrations.length === 1) {
      registrationStarted.resolve()
      await firstRegistration.promise
    }
    return {}
  })
  const saved: string[][] = []
  const restoreSession = saveSessionSlot.install(async (_field, value) => {
    saved.push(value as string[])
    if (saved.length === 1) {
      saveStarted.resolve()
      await firstSave.promise
    }
  })
  let pending: Promise<void> | undefined
  try {
    const parent = {} as HTMLElement
    const preview = connection(cell('a'))
    const previews = [preview]
    wireActivation(parent, previews, manifest(preview.cell!), previewUrl, handshake)
    pending = preview.toggleActivation!()
    await registrationStarted.promise
    preview.cell = cell('a', 2)
    wireActivation(
      parent,
      previews,
      {
        ...manifest(preview.cell),
        compileRevision: 2,
        manifestRevision: 'manifest-2',
      },
      previewUrl,
      handshake,
    )
    firstRegistration.resolve()
    await saveStarted.promise
    preview.cell = cell('a', 3)
    wireActivation(
      parent,
      previews,
      {
        ...manifest(preview.cell),
        compileRevision: 3,
        manifestRevision: 'manifest-3',
      },
      previewUrl,
      handshake,
    )
    firstSave.resolve()
    await pending
    Expect(registrations.map(({ cellRevision, compileRevision }) => ({ cellRevision, compileRevision })))
      .toEqual([
        { cellRevision: 1, compileRevision: 1 },
        { cellRevision: 2, compileRevision: 2 },
        { cellRevision: 3, compileRevision: 3 },
      ])
    Expect(saved).toEqual([['a'], ['a']])
    Expect(preview.activated).toBe(true)
    Expect(preview.cellIdentity?.cellRevision).toBe(3)
    Expect(preview.expectedRevision).toBe(3)
    Expect(preview.previewInstanceId).toBe(registrations.at(-1)?.previewInstanceId)
    Expect(new URL(preview.iframe.src).searchParams.get('taoStudioPreviewInstanceId'))
      .toBe(registrations.at(-1)?.previewInstanceId)
  } finally {
    firstRegistration.resolve()
    firstSave.resolve()
    await Promise.allSettled([pending].filter((task): task is Promise<void> => task !== undefined))
    restoreSession()
    restoreRegistration()
    restoreWindow()
  }
})

Test('Studio stops activation after repeated manifest changes without mounting an outdated instance', async () => {
  const parent = {} as HTMLElement
  const preview = connection(cell('a'))
  const previews = [preview]
  let registrations = 0
  const restoreRegistration = cellInstanceSlot.install(async () => {
    registrations++
    preview.cell = cell('a', registrations + 1)
    wireActivation(
      parent,
      previews,
      {
        ...manifest(preview.cell),
        compileRevision: registrations + 1,
        manifestRevision: `manifest-${registrations + 1}`,
      },
      previewUrl,
      handshake,
    )
    return {}
  })
  const saved: string[][] = []
  const restoreSession = saveSessionSlot.install(async (_field, value) => {
    saved.push(value as string[])
  })
  try {
    wireActivation(parent, previews, manifest(preview.cell!), previewUrl, handshake)
    let failed = false
    try {
      await preview.toggleActivation!()
    } catch {
      failed = true
    }
    Expect(failed).toBe(true)
    Expect(registrations).toBe(3)
    Expect(saved).toEqual([])
    Expect(preview.activated).toBe(false)
    Expect(preview.iframe.src).toBe('')
  } finally {
    restoreSession()
    restoreRegistration()
  }
})

Test('Studio does not mount a cell removed while its activation save is pending', async () => {
  const saveStarted = Deferred<void>()
  const savePending = Deferred<void>()
  const restoreRegistration = cellInstanceSlot.install(async () => ({}))
  const saved: string[][] = []
  const restoreSession = saveSessionSlot.install(async (_field, value) => {
    saved.push(value as string[])
    if (saved.length === 1) {
      saveStarted.resolve()
      await savePending.promise
    }
  })
  let pending: Promise<void> | undefined
  try {
    const parent = {} as HTMLElement
    const preview = connection(cell('a'))
    wireActivation(parent, [preview], manifest(preview.cell!), previewUrl, handshake)
    pending = preview.toggleActivation!()
    await saveStarted.promise
    wireActivation(parent, [], manifest(), previewUrl, handshake)
    savePending.resolve()
    await pending
    Expect(preview.activated).toBe(false)
    Expect(preview.iframe.src).toBe('')
    Expect(preview.previewInstanceId).toBe('preview-a')
    Expect(saved).toEqual([['a'], []])
  } finally {
    savePending.resolve()
    await Promise.allSettled([pending].filter((task): task is Promise<void> => task !== undefined))
    restoreSession()
    restoreRegistration()
  }
})

Test('Studio invalidates the old matrix when the parent changes apps during registration', async () => {
  const registrationStarted = Deferred<void>()
  const registrationPending = Deferred<void>()
  const restoreRegistration = cellInstanceSlot.install(async () => {
    registrationStarted.resolve()
    await registrationPending.promise
    return {}
  })
  const saved: string[][] = []
  const restoreSession = saveSessionSlot.install(async (_field, value) => {
    saved.push(value as string[])
  })
  let pending: Promise<void> | undefined
  try {
    const parent = {} as HTMLElement
    const previous = connection(cell('a'))
    wireActivation(parent, [previous], manifest(previous.cell!), previewUrl, handshake)
    pending = previous.toggleActivation!()
    await registrationStarted.promise
    const otherApp = { identity: { appName: 'Other', project: '/project' } } as StudioHandshake
    const replacement = connection(cell('b'))
    wireActivation(parent, [replacement], manifest(replacement.cell!), previewUrl, otherApp)
    registrationPending.resolve()
    await pending
    Expect(saved).toEqual([])
    Expect(previous.activated).toBe(false)
    Expect(previous.iframe.src).toBe('')
  } finally {
    registrationPending.resolve()
    await Promise.allSettled([pending].filter((task): task is Promise<void> => task !== undefined))
    restoreSession()
    restoreRegistration()
  }
})

Test(
  'Studio waits for compile, publication, and the exact connected peer before registering another cell',
  async () => {
    const restoreWindow = windowSlot.install({
      configurable: true,
      value: { location: { origin: 'http://localhost:1234', pathname: '/studio' } },
    })
    const registrations: string[] = []
    const restoreRegistration = cellInstanceSlot.install(async body => {
      registrations.push((body as { cellId: string }).cellId)
      return {}
    })
    const restoreSession = saveSessionSlot.install(async () => {})
    let pending: Promise<void> | undefined
    let peer: StudioPreviewConnection | undefined
    try {
      const parent = {} as HTMLElement
      const previous = manifest(cell('peer'), cell('new'))
      const latest = {
        ...manifest(cell('peer', 2), cell('new', 2)),
        compileRevision: 2,
        manifestRevision: 'manifest-2',
      }
      peer = connection(previous.cells[0]!)
      peer.activated = true
      peer.cellIdentity = {
        appName: 'Demo',
        cellId: 'peer',
        cellRevision: 1,
        compileRevision: 1,
        manifestRevision: 'manifest-1',
        project: '/project',
      }
      const newcomer = connection(previous.cells[1]!)
      const previews = [peer, newcomer]
      const compiling = {
        appliedRevision: 1,
        compileRevision: 2,
        diagnostics: [],
        message: '',
        status: 'compiling',
      } as const
      wireActivation(parent, previews, previous, previewUrl, { ...handshake, compile: compiling })
      StudioPreviewActivationGate.compile(parent, compiling)
      pending = newcomer.toggleActivation!()
      await settle()
      Expect(registrations).toEqual([])

      StudioPreviewActivationGate.compile(parent, { ...compiling, status: 'compiled' })
      await settle()
      Expect(registrations).toEqual([])
      StudioPreviewActivationGate.manifest(parent, latest)
      newcomer.cell = latest.cells[1]!
      peer.cell = latest.cells[0]!
      peer.cellIdentity = {
        ...peer.cellIdentity!,
        cellRevision: 2,
        compileRevision: 2,
        manifestRevision: 'manifest-2',
      }
      wireActivation(parent, previews, latest, previewUrl, { ...handshake, compile: compiling })
      await settle()
      Expect(registrations).toEqual([])
      StudioPreviewPublication.acknowledged(peer, {
        ...peer.cellIdentity!,
        cellRevision: 1,
      }, peer.previewInstanceId)
      StudioPreviewActivationGate.changed(peer)
      await settle()
      Expect(registrations).toEqual([])
      StudioPreviewPublication.acknowledged(peer, peer.cellIdentity!, peer.previewInstanceId)
      StudioPreviewActivationGate.changed(peer)
      await pending
      Expect(registrations).toEqual(['new'])
      Expect(newcomer.cellIdentity?.compileRevision).toBe(2)
    } finally {
      if (peer !== undefined) {
        StudioPreviewPublication.cancel(peer)
      }
      await Promise.allSettled([pending].filter((task): task is Promise<void> => task !== undefined))
      restoreSession()
      restoreRegistration()
      restoreWindow()
    }
  },
)

Test(
  'Studio starts restored cells together after wiring without waiting for another frame',
  async () => {
    const restoreWindow = windowSlot.install({
      configurable: true,
      value: { location: { origin: 'http://localhost:1234', pathname: '/studio' } },
    })
    const registrations: string[] = []
    const restoreRegistration = cellInstanceSlot.install(async body => {
      registrations.push((body as { cellId: string }).cellId)
      return {}
    })
    let pending: Promise<void> | undefined
    const first = connection(cell('a'))
    const second = connection(cell('b'))
    try {
      const parent = {} as HTMLElement
      const published = manifest(first.cell!, second.cell!)
      for (const preview of [first, second]) {
        preview.activated = true
        preview.startupPending = true
        preview.cellIdentity = {
          appName: 'Demo',
          cellId: preview.cell!.cellId,
          cellRevision: 1,
          compileRevision: 1,
          manifestRevision: 'manifest-1',
          project: '/project',
        }
      }
      const previews = [first, second]
      wireActivation(parent, previews, published, previewUrl, handshake)
      Expect(registrations).toEqual([])
      pending = startRestoredPreviews(parent, previews)
      await pending
      Expect(registrations).toEqual(['a', 'b'])
      Expect(first.startupPending).toBe(false)
      Expect(second.startupPending).toBe(false)
    } finally {
      StudioPreviewPublication.cancel(first)
      StudioPreviewPublication.cancel(second)
      await Promise.allSettled([pending].filter((task): task is Promise<void> => task !== undefined))
      restoreRegistration()
      restoreWindow()
    }
  },
)

Test('Studio passes edited inactive cell configuration to the grid before its card is rendered', async () => {
  const gridSlot = testOverrideSlot({
    read: () => StudioMatrixGrid.reconcile,
    write: value => {
      Reflect.set(StudioMatrixGrid, 'reconcile', value)
    },
  })
  const rerenderSlot = testOverrideSlot({
    read: () => StudioMatrixSketches.rerender,
    write: value => {
      Reflect.set(StudioMatrixSketches, 'rerender', value)
    },
  })
  const renderableSlot = testOverrideSlot({
    read: () => StudioMatrixSketches.renderable,
    write: value => {
      Reflect.set(StudioMatrixSketches, 'renderable', value)
    },
  })
  const seen: StudioPreviewCell[] = []
  const restoreGrid = gridSlot.install((_, groups) => {
    for (const group of groups) {
      for (const item of group.cells) {
        seen.push((item.item as StudioPreviewConnection).cell!)
      }
    }
  })
  const restoreRerender = rerenderSlot.install(() => {})
  const restoreRenderable = renderableSlot.install(() => {})
  try {
    const parent = { querySelector: () => null } as unknown as HTMLElement
    const original = cell('a')
    const updated = cell('a', 2)
    const previews = [connection(original)]
    await refreshCellPreviews(parent, previews, previewUrl, manifest(updated), handshake)
    Expect(seen).toEqual([updated])
    Expect(previews[0]!.cellIdentity?.cellRevision).toBe(2)
    Expect(previews[0]!.cell?.environment.viewport.width).toBe(362)
  } finally {
    restoreRenderable()
    restoreRerender()
    restoreGrid()
  }
})

Test(
  'Studio restores a pending scenario activation on the first manifest',
  async () => {
    const element = (): HTMLElement =>
      ({
        addEventListener() {},
        append() {},
        contains: () => false,
        dataset: {},
        querySelector: () => null,
        remove() {},
        replaceChildren() {},
        setAttribute() {},
      }) as unknown as HTMLElement
    const fakeDocument = { createElement: () => element() }
    const restoreDocument = documentSlot.install({ configurable: true, value: fakeDocument })
    const restoreWindow = windowSlot.install({
      configurable: true,
      value: { location: { origin: 'http://localhost:1234', pathname: '/studio' } },
    })
    const overrides = [
      testOverrideSlot({
        read: () => StudioDrawCanvas.ensure,
        write: value => {
          Reflect.set(StudioDrawCanvas, 'ensure', value)
        },
      })
        .install(() => element()),
      testOverrideSlot({
        read: () => StudioDrawCanvas.retain,
        write: value => {
          Reflect.set(StudioDrawCanvas, 'retain', value)
        },
      })
        .install((_parent, replace) => replace()),
      testOverrideSlot({
        read: () => StudioMatrixGrid.reconcile,
        write: value => {
          Reflect.set(StudioMatrixGrid, 'reconcile', value)
        },
      })
        .install(() => {}),
      testOverrideSlot({
        read: () => StudioMatrixSketches.rerender,
        write: value => {
          Reflect.set(StudioMatrixSketches, 'rerender', value)
        },
      })
        .install(() => {}),
      testOverrideSlot({
        read: () => StudioMatrixSketches.renderable,
        write: value => {
          Reflect.set(StudioMatrixSketches, 'renderable', value)
        },
      })
        .install(() => {}),
    ]
    const restorePreview = previewInstanceSlot.install(async () => ({}))
    const registrations: string[] = []
    const restoreRegistration = cellInstanceSlot.install(async body => {
      registrations.push((body as { cellId: string }).cellId)
      return {}
    })
    const released: string[] = []
    const restoreRelease = releaseInstanceSlot.install(async id => {
      released.push(id)
    })
    const saved: string[][] = []
    const restoreSession = saveSessionSlot.install(async (_field, value) => {
      saved.push(value as string[])
    })
    try {
      const parent = {
        ownerDocument: fakeDocument,
        querySelector: () => null,
        replaceChildren() {},
      } as unknown as HTMLElement
      const wholeApp: StudioPreviewConnection = {
        activated: false,
        iframe: element() as HTMLIFrameElement,
        interactionMode: 'run',
        origin: previewUrl,
        previewInstanceId: 'whole-app-preview',
      }
      const previews = [wholeApp]
      const savedHandshake = { ...handshake, studioSession: { activatedCellIds: ['a'] } }
      wireActivation(parent, previews, undefined, previewUrl, savedHandshake)
      await refreshCellPreviews(parent, previews, previewUrl, manifest(cell('a')), savedHandshake)
      await startRestoredPreviews(parent, previews)
      Expect(registrations).toEqual(['a'])
      Expect(previews[0]?.activated).toBe(true)
      await refreshCellPreviews(parent, previews, previewUrl, manifest(), savedHandshake)
      await settle()
      Expect(saved.at(-1)).toEqual([])
      Expect(released).toHaveLength(1)
      await refreshCellPreviews(parent, previews, previewUrl, manifest(cell('a')), savedHandshake)
      Expect(previews[0]?.activated).toBe(false)
      Expect(registrations).toEqual(['a'])
    } finally {
      restoreSession()
      restoreRelease()
      restoreRegistration()
      restorePreview()
      for (const restore of overrides.reverse()) {
        restore()
      }
      restoreWindow()
      restoreDocument()
    }
  },
)
