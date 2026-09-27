import { Errors, FS, HCI, Text } from '@shared'
import { type Feature, generate, type GenerateOptions, type ToolTarget } from 'rulesync'
import { generateClaudeHostSettings } from './AgentHostCommands'
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
      if (target === 'claudecode') {
        await recoverConflictedSettings(options.root, generateTarget)
      }
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
  try {
    await generateClaudeHostSettings(options.root)
  } catch (error) {
    if (!isBlockedAdapterOutput(error, 'claudecode', options.root)) {
      throw error
    }
    const path = (error as NodeJS.ErrnoException).path
    ;(options.onSkip ?? HCI.writeErrorLine)(`Skipped claudecode host rules: ${path} is not writable.`)
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

/** A generated merge conflict cannot be parsed as the existing settings rulesync normally merges. */
async function recoverConflictedSettings(
  root: string,
  generateTarget: (options: GenerateOptions) => Promise<unknown>,
): Promise<void> {
  const relative = '.claude/settings.json'
  const path = FS.resolvePath(relative, root)
  if (!(await FS.isFile(path)) || !/^<<<<<<< /m.test(await FS.readText(path))) {
    return
  }
  // Rulesync may skip an unreadable source and still emit the other feature. Check both first
  // so partially resolved canonical input cannot replace the conflict with incomplete settings.
  for (const source of ['permissions.jsonc', 'hooks.jsonc']) {
    JSON.parse(Text.stripJsonc(await FS.readText(FS.resolvePath(`.rulesync/${source}`, root))))
  }
  const scratch = await FS.mkTmpDir('tao-agent-conflict-')
  try {
    // Render from resolved canonical sources before replacing anything. Invalid source leaves
    // the conflicted file intact; no conflict side is treated as an authority for permissions.
    const result = await generateTarget({
      configPath: '.rulesync/rulesync.jsonc',
      features: ['permissions', 'hooks'],
      inputRoot: root,
      outputRoots: [scratch],
      targets: ['claudecode'],
    })
    if (result && typeof result === 'object' && 'sourceLoadFailed' in result && result.sourceLoadFailed === true) {
      Errors.throwUserInput(
        'Canonical harness permissions or hooks are invalid; resolve their source before regenerating settings.',
      )
    }
    await FS.writeText(path, await FS.readText(FS.resolvePath(relative, scratch)))
  } finally {
    await FS.remove(scratch)
  }
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
