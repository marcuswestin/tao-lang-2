import { Errors, ProcessTree, type TrackedProcess } from '@shared'
import { Expect, Test } from '@shared/test'

const attached: TrackedProcess[] = Array.from({ length: 100 }, (_, index) => ({
  command: 'fixture',
  pid: 10_000 + index,
  startedAt: '1:0',
}))

Test('ownership refresh walks a stable tree once while retaining every exact identity', () => {
  const walks: number[] = []
  const identityQueries: number[][] = []
  const result = ProcessTree.refreshDescendants(700, attached, {
    descendants: pid => {
      walks.push(pid)
      return [...attached]
    },
    identities: pids => {
      identityQueries.push([...pids])
      return new Map()
    },
  })
  Expect(walks).toEqual([700])
  Expect(identityQueries).toEqual([[]])
  Expect(result).toHaveLength(100)
  Expect(result[0]).toEqual({ command: 'fixture', pid: 10_000, startedAt: '1:0' })
  Expect(result[99]).toEqual({ command: 'fixture', pid: 10_099, startedAt: '1:0' })
})

Test('ownership refresh captures an escaped owner later fork before its retained parent', () => {
  const owner = { command: 'escaped', pid: 701, startedAt: '2:0' }
  const later = { command: 'later', pid: 702, startedAt: '3:0' }
  const reused = { command: 'old', pid: 703, startedAt: '4:0' }
  const walks: number[] = []
  const result = ProcessTree.refreshDescendants(undefined, [owner, reused], {
    descendants: pid => {
      walks.push(pid)
      return [later]
    },
    identities: () =>
      new Map([
        [701, owner],
        [703, { ...reused, startedAt: '99:0' }],
      ]),
  })
  Expect(walks).toEqual([701])
  Expect(result.map(process => [process.pid, process.startedAt])).toEqual([
    [702, '3:0'],
    [701, '2:0'],
    [703, '4:0'],
  ])
})

Test('ownership refresh propagates an escaped owner inspection failure', () => {
  const owner = { command: 'escaped', pid: 701, startedAt: '2:0' }
  Expect(() =>
    ProcessTree.refreshDescendants(700, [owner], {
      descendants: pid => {
        if (pid === 701) {
          Errors.throwHostEnvironment('fixture ownership inspection denied')
        }
        return []
      },
      identities: () => new Map([[701, owner]]),
    })
  ).toThrow('fixture ownership inspection denied')
})

Test('a final owner refresh discovers a fork that occurred after its root walk', () => {
  const owner = { command: 'parent', pid: 701, startedAt: '2:0' }
  const later = { command: 'later', pid: 702, startedAt: '3:0' }
  const walks: number[] = []
  const seams = {
    descendants: (pid: number) => {
      walks.push(pid)
      return pid === 700 ? [owner] : [later]
    },
    identities: () => new Map([[701, owner]]),
  }
  const polled = ProcessTree.refreshDescendants(700, [owner], seams)
  Expect(polled.map(process => process.pid)).toEqual([701])
  const final = ProcessTree.refreshDescendants(undefined, polled, seams)
  Expect(walks).toEqual([700, 701])
  Expect(final.map(process => process.pid)).toEqual([702, 701])
})
