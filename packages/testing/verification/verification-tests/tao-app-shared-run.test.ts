import { Describe, Expect, Test } from '@shared/test'
import { TaoAppSharedRun } from '../verification-src/TaoAppSharedRun'
import type { TestNodeState } from '../verification-src/TestNodes'
import { WorkGraph } from '../verification-src/WorkGraph'

function shard(name: string, roots: readonly string[]): TestNodeState {
  const state = WorkGraph.createState({
    name,
    needs: ['_parser-generate'],
    run: { args: ['test', ...roots, '--name', 'opens', '--pass-with-no-tests'], command: './tao', cwd: '/repo' },
  }) as TestNodeState
  state.suite = 'tao-apps'
  state.selectedTestFiles = roots
  return state
}

Describe('shared Tao app compilation', () => {
  Test('prepares the union once, runs each owned shard, and publishes only after both pass', async () => {
    const first = shard('tao-apps#1', ['Apps/A', 'Apps/B'])
    const second = shard('tao-apps#2', ['Apps/B', 'Apps/C'])
    const states = TaoAppSharedRun.attach([first, second], '/lane', '/repo')
    const commands = new Map<string, readonly string[]>()
    const result = await WorkGraph.run(states, {
      jobs: 2,
      runNode: async (state, context) => {
        const command = typeof state.node.run === 'function'
          ? state.node.run({ slots: context.slots })
          : state.node.run
        commands.set(state.name, command.args)
        return { exitCode: 0, output: '' }
      },
    })

    Expect(result.states.every(state => state.status === 'passed')).toBe(true)
    Expect(commands.get('tao-apps:prepare')).toEqual([
      'test',
      '--shared-prepare',
      '/lane/tao-apps-shared-run.json',
      'Apps/A',
      'Apps/B',
      'Apps/C',
    ])
    Expect(commands.get('tao-apps#1')).toEqual([
      'test',
      '--shared-run',
      '/lane/tao-apps-shared-run.json',
      'Apps/A',
      'Apps/B',
      '--name',
      'opens',
      '--pass-with-no-tests',
    ])
    Expect(commands.get('tao-apps#2')).toContain('Apps/C')
    Expect(commands.get('tao-apps:finalize')).toEqual([
      'test',
      '--shared-finalize',
      '/lane/tao-apps-shared-run.json',
    ])
  })

  Test('does not publish a handoff after a shard fails', async () => {
    const states = TaoAppSharedRun.attach(
      [
        shard('tao-apps#1', ['Apps/A']),
        shard('tao-apps#2', ['Apps/B']),
      ],
      '/lane',
      '/repo',
    )
    const started: string[] = []
    await WorkGraph.run(states, {
      jobs: 2,
      runNode: async state => {
        started.push(state.name)
        return { exitCode: state.name === 'tao-apps#1' ? 1 : 0, output: '' }
      },
    })
    Expect(started).not.toContain('tao-apps:finalize')
    Expect(states.find(state => state.name === 'tao-apps:finalize')?.status).toBe('skipped')
  })

  Test('leaves a single app process on the normal command', () => {
    const one = shard('tao-apps', ['Apps/A'])
    const states = TaoAppSharedRun.attach([one], '/lane', '/repo')
    Expect(states).toEqual([one])
    Expect(one.node.run).toEqual({
      args: ['test', 'Apps/A', '--name', 'opens', '--pass-with-no-tests'],
      command: './tao',
      cwd: '/repo',
    })
  })
})
