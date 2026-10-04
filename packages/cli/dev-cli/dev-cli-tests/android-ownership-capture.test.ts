import { Errors, type TrackedProcess } from '@shared'
import { Expect, Test } from '@shared/test'
import { AndroidOwnershipCapture } from '../dev-cli-src/simulators/AndroidOwnershipCapture'

function fixture() {
  const root = { pid: 71_501, startedAt: 'original launch', command: 'emulator' }
  const late = { pid: 71_502, startedAt: 'late child', command: 'qemu' }
  const identities = new Map<number, TrackedProcess>([[root.pid, root], [late.pid, late]])
  const state = { processes: [root], rootPid: root.pid, uncertain: false }
  const tree = {
    identities: (pids: readonly number[]) =>
      new Map(pids.flatMap(pid => identities.has(pid) ? [[pid, identities.get(pid)!] as const] : [])),
    descendants: (_pid: number): TrackedProcess[] => [late],
    processGroupOf: (_pid: number) => root.pid,
    groupMembers: (_pid: number): TrackedProcess[] => [root, late],
    processIsAlive: (pid: number) => identities.has(pid),
  }
  return { root, late, identities, state, tree }
}

Test('Android refresh captures a late child through the identical original launch root', () => {
  const f = fixture()
  const current = AndroidOwnershipCapture.refresh(f.state, f.tree)
  Expect(current.processes.map(process => process.pid)).toEqual([71_501, 71_502])
  Expect(current.uncertain).toBe(false)
  Expect(f.state.processes).toEqual([f.root])
})

for (
  const fault of [
    'lost anchor',
    'reused anchor',
    'unexplained member',
    'escaped child',
    'unreadable ancestry',
    'unreadable identity',
    'old uncertainty',
  ] as const
) {
  Test(`Android refresh refuses ${fault} without adopting group membership`, () => {
    const f = fixture()
    if (fault === 'lost anchor') {
      f.identities.delete(f.root.pid)
    }
    if (fault === 'reused anchor') {
      f.identities.set(f.root.pid, { ...f.root, startedAt: 'successor' })
    }
    if (fault === 'unexplained member') {
      f.tree.descendants = () => []
    }
    if (fault === 'escaped child') {
      f.tree.processGroupOf = pid => pid
    }
    if (fault === 'unreadable ancestry') {
      f.tree.descendants = () => Errors.throwHostEnvironment('read failed')
    }
    if (fault === 'unreadable identity') {
      f.tree.identities = pids => new Map(pids.includes(f.root.pid) ? [[f.root.pid, f.root]] : [])
    }
    if (fault === 'old uncertainty') {
      f.state.uncertain = true
    }
    Expect(() => AndroidOwnershipCapture.refresh(f.state, f.tree)).toThrow()
    Expect(f.state.processes).toEqual([f.root])
  })
}

Test('Android refresh has a finite refusal when captured ancestry never stabilizes', () => {
  const f = fixture()
  const children: TrackedProcess[] = []
  let reads = 0
  f.tree.descendants = () => {
    const child = { pid: 71_510 + reads++, startedAt: 'new child', command: 'qemu' }
    children.push(child)
    f.identities.set(child.pid, child)
    return [...children]
  }
  f.tree.groupMembers = () => [f.root, ...children]
  Expect(() => AndroidOwnershipCapture.refresh(f.state, f.tree)).toThrow('finite capture budget')
  Expect(reads).toBe(4)
})

Test('Android observer refuses a late child instead of extending its checkpoint', () => {
  const f = fixture()
  Expect(() => AndroidOwnershipCapture.verify(f.state, f.tree)).toThrow('changed after its durable checkpoint')
  Expect(f.state.processes).toEqual([f.root])
})
