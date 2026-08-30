import { resolve } from 'node:path'
import { generate, type GenerateOptions, type ToolTarget } from 'rulesync'

const targets = ['codexcli', 'claudecode'] satisfies ToolTarget[]

type GenerateAgentConfigOptions = {
  generate?: (options: GenerateOptions) => Promise<unknown>
  onSkip?: (message: string) => void
  root: string
}

async function generateAgentConfigs(options: GenerateAgentConfigOptions): Promise<void> {
  const generateTarget = options.generate ?? generate
  for (const target of targets) {
    try {
      await generateTarget({
        configPath: '.rulesync/rulesync.jsonc',
        inputRoot: options.root,
        outputRoots: [options.root],
        targets: [target],
      })
    } catch (error) {
      if (!isBlockedAdapterOutput(error, target, options.root)) {
        throw error
      }
      const path = (error as NodeJS.ErrnoException).path
      ;(options.onSkip ?? console.warn)(`Skipped ${target} agent config: ${path} is not writable.`)
    }
  }
}

function isBlockedAdapterOutput(error: unknown, target: ToolTarget, root: string): boolean {
  const adapterDirectory = target === 'codexcli' ? '.codex/agents' : '.claude/agents'
  const expectedPath = resolve(root, adapterDirectory)
  const { code, path } = error as NodeJS.ErrnoException
  return (code === 'EACCES' || code === 'EPERM')
    && typeof path === 'string'
    && (path === expectedPath || path.startsWith(`${expectedPath}/`))
}

/** AgentConfigGenerator renders canonical subagent definitions into tool adapters. */
export const AgentConfigGenerator = {
  generate: generateAgentConfigs,
}
