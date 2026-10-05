import { Expect, Test } from '@shared/test'
import { projectStudioLensLines } from '../studio-src/client/app/StudioLensProjection'
import type { StudioLensRenderSample } from '../studio-src/StudioProtocol'

const selected = {
  path: '/project/Main.tao',
  renderId: '/project/Main.tao:10:30',
  sourceVersion: 'current',
}

function sample(
  duration: number,
  sourceVersion = 'current',
  sourcePath = selected.path,
): StudioLensRenderSample {
  return {
    actualDurationMs: duration,
    causes: [{ entity: 'Note', kind: 'data', providerWaitMs: 12, schema: 'Journal' }],
    identity: { end: 30, kind: 'render', sourcePath, start: 10 },
    instanceId: 'row-1',
    phase: 'update',
    resolvedStyle: { color: 'rgb(3, 4, 5)', 'font-size': '18px' },
    sourceVersion,
    timestamp: 1_788_100_000_000,
  }
}

Test('Lens joins timing and provider wait only to the selected source revision', () => {
  const lines = projectStudioLensLines(selected, [
    sample(99, 'old'),
    sample(40, 'current', '/project/Other.tao'),
    sample(18),
  ], undefined)
  Expect(lines).toContainEqual(
    'Render: 1 commits; latest 18.0 ms; slowest 18.0 ms; rank 1 of 1 observed nodes in this source revision.',
  )
  Expect(lines).toContainEqual('Invalidating read: data subscription Journal.Note invalidated.')
  Expect(lines).toContainEqual('Provider wait: 12.0 ms observed for Journal.Note.')
  Expect(lines).toContainEqual('Resolved style: color rgb(3, 4, 5); font-size 18px.')
  Expect(lines.join('\n')).not.toContain('99.0 ms')
})

Test('Lens labels missing measurements instead of attributing another node or revision', () => {
  const lines = projectStudioLensLines(selected, [sample(99, 'old')], undefined)
  Expect(lines).toContainEqual('Render timing: no observation for this source revision in the focused preview.')
  Expect(lines).toContainEqual('Covering journey: no execution observation.')
  Expect(lines.join('\n')).not.toContain('99.0 ms')
})

Test('Lens names only a passed journey that rendered this exact source revision', () => {
  const journeys = {
    checks: [
      {
        appSourcePath: '/project/Main.tao',
        checkName: 'opens the note',
        checkSource: { filePath: '/project/Journeys/Notes.test.tao' },
        renders: [{ end: 30, renderId: selected.renderId, sourcePath: selected.path, sourceVersion: 'old', start: 10 }],
        status: 'passed' as const,
        suiteName: 'Notes',
      },
      {
        appSourcePath: '/project/Main.tao',
        checkName: 'shows the note',
        checkSource: { filePath: '/project/Journeys/Notes.test.tao' },
        renders: [{
          end: 30,
          renderId: selected.renderId,
          sourcePath: selected.path,
          sourceVersion: selected.sourceVersion,
          start: 10,
        }],
        status: 'passed' as const,
        suiteName: 'Notes',
      },
    ],
    format: 'tao-journey-observations' as const,
    version: 1 as const,
  }
  const lines = projectStudioLensLines(selected, [sample(18)], undefined, journeys)
  Expect(lines).toContainEqual('Covering journey: Notes / shows the note (/project/Journeys/Notes.test.tao).')
  Expect(lines.join('\n')).not.toContain('opens the note')
})

Test('Lens shows public native timing and causes without claiming native computed style', () => {
  const deviceSamples = [{
    actualDurationMs: 27,
    causes: [{ entity: 'Note', kind: 'data' as const, providerWaitMs: 13, schema: 'Journal' }],
    deviceName: 'iPhone',
    instanceId: 'native-1',
    occurrence: { end: 30, sourcePath: selected.path, sourceVersion: selected.sourceVersion, start: 10 },
    phase: 'update' as const,
    timestamp: 1_788_100_000_000,
  }]
  const lines = projectStudioLensLines(selected, [], undefined, undefined, deviceSamples)
  Expect(lines).toContainEqual('Device render (iPhone): 1 commits; latest 27.0 ms; slowest 27.0 ms.')
  Expect(lines).toContainEqual('Device invalidating read: data subscription Journal.Note invalidated.')
  Expect(lines).toContainEqual('Device provider wait: 13.0 ms observed for Journal.Note.')
  Expect(lines).toContainEqual('Resolved style: not measured.')
})
