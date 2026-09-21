import { FS, HCI } from '@shared'
import { type Feature, generate, type GenerateOptions, type ToolTarget } from 'rulesync'
import { ClaudeProfilesGenerator } from './ClaudeProfilesGenerator'
import { CodexConfigGenerator } from './CodexConfigGenerator'

/**
 * Codex CLI's permissions come from `CodexConfigGenerator` instead of rulesync: rulesync's Codex
 * permissions translator cannot express that profile's loopback binding, Unix sockets, or curated
 * domain list, so generating them through it would replace a narrow policy with an open one.
 */
const targetFeatures = {
  codexcli: ['subagents', 'hooks'],
  claudecode: ['subagents', 'permissions', 'hooks'],
  // Cursor takes the profiles alone. Its permissions and worktree setup stay hand-maintained in
  // `.cursor/`, because rulesync has no translator for the shape those files are written in.
  cursor: ['subagents'],
} satisfies Record<string, Feature[]>

const targets = Object.keys(targetFeatures) as ToolTarget[]

/** Outputs a sandboxed session is expected to be denied, keyed by the target that writes them. */
const guardedOutputs: Record<string, string[]> = {
  codexcli: ['.codex/agents'],
  claudecode: ['.claude/agents', '.claude/settings.json'],
  cursor: ['.cursor/agents'],
}

type GenerateAgentConfigOptions = {
  generate?: (options: GenerateOptions) => Promise<unknown>
  generateClaudeProfiles?: (options: { onSkip?: (message: string) => void; root: string }) => Promise<void>
  generateCodexConfig?: (options: { onSkip?: (message: string) => void; root: string }) => Promise<void>
  onSkip?: (message: string) => void
  root: string
}

async function generateAgentConfigs(options: GenerateAgentConfigOptions): Promise<void> {
  const generateTarget = options.generate ?? generate
  for (const target of targets) {
    try {
      await generateTarget({
        configPath: '.rulesync/rulesync.jsonc',
        features: targetFeatures[target as keyof typeof targetFeatures],
        inputRoot: options.root,
        outputRoots: [options.root],
        targets: [target],
      })
    } catch (error) {
      if (!isBlockedAdapterOutput(error, target, options.root)) {
        throw error
      }
      const path = (error as NodeJS.ErrnoException).path
      ;(options.onSkip ?? HCI.writeErrorLine)(`Skipped ${target} agent config: ${path} is not writable.`)
    }
  }
  await (options.generateCodexConfig ?? CodexConfigGenerator.generate)({
    onSkip: options.onSkip,
    root: options.root,
  })
  await (options.generateClaudeProfiles ?? ClaudeProfilesGenerator.generate)({
    onSkip: options.onSkip,
    root: options.root,
  })
}

function isBlockedAdapterOutput(error: unknown, target: ToolTarget, root: string): boolean {
  const { code, path } = error as NodeJS.ErrnoException
  if ((code !== 'EACCES' && code !== 'EPERM') || typeof path !== 'string') {
    return false
  }
  return (guardedOutputs[target] ?? []).some(output => {
    const expectedPath = FS.resolvePath(output, root)
    return path === expectedPath || path.startsWith(`${expectedPath}/`)
  })
}

/** AgentConfigGenerator renders canonical subagent definitions into tool adapters. */
export const AgentConfigGenerator = {
  generate: generateAgentConfigs,
}
