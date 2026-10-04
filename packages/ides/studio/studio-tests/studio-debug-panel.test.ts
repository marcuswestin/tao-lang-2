import { Describe, Expect, Test } from '@shared/test'
import { StudioDebugEvents } from '../studio-src/client/matrix/StudioDebugEvents'
import { StudioPanelProjection } from '../studio-src/client/StudioPanelProjection'
import type { StudioJsonValue } from '../studio-src/StudioProtocol'

const pauseEvent: StudioJsonValue = {
  kind: 'paused',
  pause: {
    frames: ['SubmitStory', 'RecordVote'],
    pendingWrites: [
      { committed: 3, kind: 'state', pending: 4, target: 'state' },
      { kind: 'data', pending: { id: 'story-1' }, target: 'Story' },
    ],
    scope: { Count: 3, Story: { Title: 'Tao' } },
    step: { action: 'RecordVote', path: '1.0' },
  },
}

Describe('Studio debugger drawer', () => {
  Test('folds a root that runs to completion into one journal row', () => {
    const started = StudioDebugEvents.receive(StudioDebugEvents.empty(), {
      entry: { action: 'RecordVote', frames: ['RecordVote'], outcome: 'running', rootId: 1, startedAt: 10 },
      kind: 'journal',
    })
    const settled = StudioDebugEvents.receive(started, {
      entry: { action: 'RecordVote', frames: ['RecordVote'], outcome: 'committed', rootId: 1, startedAt: 10 },
      kind: 'journal',
    })

    Expect(settled.journal.length).toBe(1)
    Expect(settled.journal[0]).toMatchObject({ frames: ['RecordVote'], outcome: 'committed' })
  })

  Test('keeps repeated same-name roots that started at the same moment apart by root identity', () => {
    const first = StudioDebugEvents.receive(StudioDebugEvents.empty(), {
      entry: { action: 'RecordVote', frames: ['RecordVote'], outcome: 'running', rootId: 1, startedAt: 10 },
      kind: 'journal',
    })
    const second = StudioDebugEvents.receive(first, {
      entry: { action: 'RecordVote', frames: ['RecordVote'], outcome: 'running', rootId: 2, startedAt: 10 },
      kind: 'journal',
    })

    Expect(second.journal.map(entry => entry.rootId)).toEqual([1, 2])
  })

  Test('holds the pause until the preview reports the root resumed', () => {
    const paused = StudioDebugEvents.receive(StudioDebugEvents.empty(), pauseEvent)
    Expect(paused.pause).toMatchObject({ action: 'RecordVote', path: '1.0' })

    const resumed = StudioDebugEvents.receive(paused, { kind: 'resumed' })
    Expect(resumed.pause).toBeUndefined()
  })

  Test('clears a stale pause when its preview instance resets', () => {
    const paused = StudioDebugEvents.receive(StudioDebugEvents.empty(), pauseEvent)
    const reset = StudioDebugEvents.receive(paused, { kind: 'reset' })

    Expect(reset).toEqual({ journal: [] })
  })

  Test('leaves the state alone when an event does not say what it is', () => {
    const paused = StudioDebugEvents.receive(StudioDebugEvents.empty(), pauseEvent)

    Expect(StudioDebugEvents.receive(paused, { kind: 'paused', pause: { step: { action: 'X' } } })).toBe(paused)
    Expect(StudioDebugEvents.receive(paused, { entry: { action: 'X' }, kind: 'journal' })).toBe(paused)
    Expect(StudioDebugEvents.receive(paused, 'paused')).toBe(paused)
  })

  Test('projects a pause into the fields the Debug panel renders', () => {
    const panels = StudioPanelProjection.project({
      ...baseInput(),
      debug: StudioDebugEvents.receive(StudioDebugEvents.empty(), pauseEvent),
      logSource: { cellId: 'story-list#cell', cellRevision: 2 },
    })

    Expect(panels.Drawer.Debug.Paused).toBe(true)
    Expect(panels.Drawer.Debug.PausedAt).toBe('RecordVote · statement 1.0')
    Expect(panels.Drawer.Debug.Frames).toEqual(['SubmitStory', 'RecordVote'])
    Expect(panels.Drawer.Debug.Scope).toEqual([
      { Name: 'Count', Value: '3' },
      { Name: 'Story', Value: '{"Title":"Tao"}' },
    ])
    // A create has no committed side, so the panel shows the write arriving out of nothing.
    Expect(panels.Drawer.Debug.PendingWrites).toEqual([
      { Committed: '3', Kind: 'state', Pending: '4', Target: 'state' },
      { Committed: '—', Kind: 'data', Pending: '{"id":"story-1"}', Target: 'Story' },
    ])
    Expect(panels.Drawer.Debug.Source).toBe('story-list#cell · revision 2')
  })

  Test('offers every debugger control as a panel action, paused or not', () => {
    const panels = StudioPanelProjection.project(baseInput())

    Expect(panels.Drawer.Debug.Paused).toBe(false)
    Expect(panels.Drawer.Debug.PausedAt).toBe('')
    Expect(panels.Drawer.Debug.Journal).toEqual([])
    Expect([
      panels.Drawer.Debug.BreakAction.Name,
      panels.Drawer.Debug.ContinueAction.Name,
      panels.Drawer.Debug.StepOverAction.Name,
      panels.Drawer.Debug.StepIntoAction.Name,
      panels.Drawer.Debug.StepOutAction.Name,
      panels.Drawer.Debug.ClearAction.Name,
    ]).toEqual([
      'debug-break',
      'debug-continue',
      'debug-step-over',
      'debug-step-into',
      'debug-step-out',
      'debug-clear',
    ])
  })

  Test('reports a failed root with the case that failed it', () => {
    const panels = StudioPanelProjection.project({
      ...baseInput(),
      debug: StudioDebugEvents.receive(StudioDebugEvents.empty(), {
        entry: {
          action: 'RecordVote',
          failureCase: 'AlreadyVoted',
          frames: ['RecordVote'],
          outcome: 'failed',
          rootId: 1,
          startedAt: 10,
        },
        kind: 'journal',
      }),
    })

    Expect(panels.Drawer.Debug.Journal[0]).toEqual({
      Action: 'RecordVote',
      Detail: 'AlreadyVoted failed · RecordVote',
      Outcome: 'failed',
    })
  })
})

function baseInput(): Parameters<typeof StudioPanelProjection.project>[0] {
  return {
    compile: {
      appliedRevision: 1,
      compileRevision: 1,
      diagnostics: [],
      message: 'Compiled',
      status: 'compiled',
    },
    data: [],
    dataLoading: false,
    logs: [],
    search: [],
    tab: 'Debug',
    testWatch: false,
  }
}
