import { Expect, Test } from '@shared/test'
import { captureInheritedOutputOwners } from '../shared-src/ProcessOutputOwners'
import type { TrackedProcess } from '../shared-src/ProcessTree'

type FixtureDescriptor = {
  access?: string
  device?: string
  fd: number
  pid: number
  type?: string
}

const root: TrackedProcess = { command: 'chrome', pid: 4100, startedAt: '10:0' }
const crashpad: TrackedProcess = { command: 'crashpad', pid: 4101, startedAt: '11:0' }
const unrelated: TrackedProcess = { command: 'unrelated', pid: 4102, startedAt: '12:0' }

function dump(descriptors: readonly FixtureDescriptor[]): string {
  return descriptors.map(({ access = 'u', device, fd, pid, type = 'unix' }) =>
    `p${pid}\0\nf${fd}\0t${type}\0a${access}\0${device === undefined ? '' : `d${device}\0`}\n`
  ).join('')
}

function seams(
  descriptors: readonly FixtureDescriptor[],
  processes: readonly TrackedProcess[],
  options: {
    confirmDescriptors?: readonly FixtureDescriptor[]
    identityReads?: (pids: readonly number[]) => Map<number, TrackedProcess>
  } = {},
) {
  let descriptorReads = 0
  const identities = new Map(processes.map(process => [process.pid, process]))
  return {
    readDescriptors: (pids?: readonly number[]) => {
      descriptorReads++
      const source = descriptorReads > 1 && options.confirmDescriptors !== undefined
        ? options.confirmDescriptors
        : descriptors
      return dump(source.filter(descriptor => pids === undefined || pids.includes(descriptor.pid)))
    },
    identities: options.identityReads ?? (pids =>
      new Map(pids.flatMap(pid => {
        const process = identities.get(pid)
        return process === undefined ? [] : [[pid, process] as const]
      }))),
    sameProcess: (current: TrackedProcess | undefined, expected: TrackedProcess) =>
      current !== undefined && current.startedAt === expected.startedAt,
  }
}

const rootOutput: FixtureDescriptor[] = [
  { pid: root.pid, fd: 1, device: '0x000000a1' },
  { pid: root.pid, fd: 2, device: '0x000000a2' },
]

Test('captures an escaped process holding the root output endpoint by exact identity', () => {
  const child = { pid: crashpad.pid, fd: 7, device: '0x000000a1' }
  const result = captureInheritedOutputOwners(
    root.pid,
    seams(
      [...rootOutput, child, { pid: unrelated.pid, fd: 8, device: '0x000000b1' }],
      [root, crashpad, unrelated],
    ),
  )
  Expect(result).toEqual([crashpad])
})

Test('does not mistake a different local Unix endpoint for the root endpoint', () => {
  const result = captureInheritedOutputOwners(
    root.pid,
    seams(
      [...rootOutput, { pid: crashpad.pid, fd: 7, device: '0x000000a3' }],
      [root, crashpad],
    ),
  )
  Expect(result).toEqual([])
})

Test('does not grant custody to read-only socket owners or seed read-only root output', () => {
  const result = captureInheritedOutputOwners(
    root.pid,
    seams(
      [...rootOutput, { pid: crashpad.pid, fd: 7, device: '0x000000a1', access: 'r' }],
      [root, crashpad],
    ),
  )
  Expect(result).toEqual([])
  Expect(() =>
    captureInheritedOutputOwners(
      root.pid,
      seams(
        [{ pid: root.pid, fd: 1, device: '0x000000a1', access: 'r' }],
        [root],
      ),
    )
  ).toThrow('Could not safely capture inherited output socket owners')
})

Test('rejects PID reuse during confirmation without returning earlier candidates', () => {
  const replacement = { ...crashpad, startedAt: '99:0' }
  let identityRead = 0
  const resultSeams = seams(
    [...rootOutput, { pid: crashpad.pid, fd: 7, device: '0x000000a1' }, {
      pid: unrelated.pid,
      fd: 8,
      device: '0x000000a2',
    }],
    [root, crashpad, unrelated],
    {
      identityReads: pids => {
        identityRead++
        return new Map(pids.map(pid => [
          pid,
          pid === root.pid
            ? root
            : identityRead <= 2
            ? (pid === crashpad.pid ? crashpad : unrelated)
            : (pid === crashpad.pid ? replacement : unrelated),
        ]))
      },
    },
  )
  Expect(() => captureInheritedOutputOwners(root.pid, resultSeams)).toThrow(
    'Could not safely capture inherited output socket owners',
  )
})

Test('rejects a changed root seed endpoint during fresh descriptor confirmation', () => {
  Expect(() =>
    captureInheritedOutputOwners(
      root.pid,
      seams(
        [...rootOutput, { pid: crashpad.pid, fd: 7, device: '0x000000a1' }],
        [root, crashpad],
        {
          confirmDescriptors: [
            { pid: root.pid, fd: 1, device: '0x000000c1' },
            rootOutput[1]!,
            { pid: crashpad.pid, fd: 7, device: '0x000000a1' },
          ],
        },
      ),
    )
  ).toThrow('Could not safely capture inherited output socket owners')
})

Test('rejects a truncated full descriptor snapshot without returning partial owners', () => {
  const base = seams(
    [...rootOutput, { pid: crashpad.pid, fd: 7, device: '0x000000a1' }],
    [root, crashpad],
  )
  Expect(() =>
    captureInheritedOutputOwners(root.pid, {
      ...base,
      readDescriptors: () => `${dump([...rootOutput, { pid: crashpad.pid, fd: 7, device: '0x000000a1' }])}z\0\n`,
    })
  ).toThrow('Could not safely capture inherited output socket owners')
})

Test('rejects a live candidate that no longer confirms the captured endpoint', () => {
  Expect(() =>
    captureInheritedOutputOwners(
      root.pid,
      seams(
        [...rootOutput, { pid: crashpad.pid, fd: 7, device: '0x000000a1' }],
        [root, crashpad],
        { confirmDescriptors: [...rootOutput, { pid: crashpad.pid, fd: 7, device: '0x000000c1' }] },
      ),
    )
  ).toThrow('Could not safely capture inherited output socket owners')
})

Test('omits a candidate only when its native identity read proves it exited', () => {
  const result = captureInheritedOutputOwners(
    root.pid,
    seams(
      [...rootOutput, { pid: crashpad.pid, fd: 7, device: '0x000000a1' }],
      [root],
    ),
  )
  Expect(result).toEqual([])
})

Test('rejects an otherwise valid snapshot with an unterminated final field or record', () => {
  const base = seams(rootOutput, [root])
  for (const output of [dump(rootOutput).slice(0, -1), dump(rootOutput).replace(/\0\n$/u, '\n')]) {
    Expect(() =>
      captureInheritedOutputOwners(root.pid, {
        ...base,
        readDescriptors: () => output,
      })
    ).toThrow('Could not safely capture inherited output socket owners')
  }
})

Test('rejects root PID reuse even when the output endpoint still matches', () => {
  let reads = 0
  const base = seams(rootOutput, [root])
  Expect(() =>
    captureInheritedOutputOwners(root.pid, {
      ...base,
      identities: pids => {
        reads++
        return new Map(pids.map(pid => [pid, reads < 3 ? root : { ...root, startedAt: '99:0' }]))
      },
    })
  ).toThrow('Could not safely capture inherited output socket owners')
})
