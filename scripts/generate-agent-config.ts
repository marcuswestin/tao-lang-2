import { resolve } from 'node:path'
import { AgentConfigGenerator } from '../packages/dev/dev-src/agent-config/AgentConfigGenerator'

const repoRoot = resolve(import.meta.dir, '..')

if (import.meta.main) {
  await AgentConfigGenerator.generate({ root: repoRoot })
}
