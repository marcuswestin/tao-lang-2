import { FS } from '@shared'
import type { TestNodeState } from './TestNodes'
import { WorkGraph, type WorkState } from './WorkGraph'

/** One Tao compilation is shared by the app shards in this lane's private artifact directory. */
function attach(states: readonly TestNodeState[], logRoot: string, repositoryRoot: string): WorkState[] {
  const shards = states.filter(state => state.suite === 'tao-apps')
  if (shards.length < 2) {
    return [...states]
  }

  const handoff = FS.resolvePath('tao-apps-shared-run.json', logRoot)
  const roots = [...new Set(shards.flatMap(shard => shard.selectedTestFiles ?? []))]
  const prepareName = 'tao-apps:prepare'
  const finalizeName = 'tao-apps:finalize'
  const prepare = WorkGraph.createState({
    budgetEnvKeys: [WorkGraph.BUDGET_ENV_KEYS.taoTest],
    cost: 8,
    name: prepareName,
    needs: [...new Set(shards.flatMap(shard => shard.node.needs ?? []))],
    priority: Math.max(0, ...shards.map(shard => shard.node.priority ?? 0)),
    run: { args: ['test', '--shared-prepare', handoff, ...roots], command: './tao', cwd: repositoryRoot },
    timeoutMs: 900_000,
  })

  for (const shard of shards) {
    const original = shard.node.run
    shard.node.run = admission => {
      const command = typeof original === 'function' ? original(admission) : original
      return { ...command, args: ['test', '--shared-run', handoff, ...command.args.slice(1)] }
    }
    shard.node.needs = [...new Set([...(shard.node.needs ?? []), prepareName])]
  }

  const finalize = WorkGraph.createState({
    cost: 1,
    name: finalizeName,
    needs: shards.map(shard => shard.name),
    run: { args: ['test', '--shared-finalize', handoff], command: './tao', cwd: repositoryRoot },
    timeoutMs: 300_000,
  })
  return [...states, prepare, finalize]
}

export const TaoAppSharedRun = { attach }
