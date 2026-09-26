import { FS } from '@shared'
import { generate } from 'rulesync'
import { generateClaudeHostSettings } from './AgentHostCommands'
import { ClaudeProfilesGenerator } from './ClaudeProfilesGenerator'
import { CodexConfigGenerator } from './CodexConfigGenerator'

/**
 * The committed harness files rulesync renders. It merges into what is already there, so freshness
 * is judged by regenerating over a copy of the committed file, never into an empty directory.
 */
const RULESYNC_OUTPUTS = [
  { features: ['permissions', 'hooks'], path: '.claude/settings.json', target: 'claudecode' },
  { features: ['hooks'], path: '.codex/hooks.json', target: 'codexcli' },
] as const

const STALE_DETAIL =
  'is stale against its `.rulesync/` source; run `./agent setup`, and commit the result if the file is tracked.'

/** renderedOutputs collects what a generator would write, keyed by repository-relative path. */
async function renderedOutputs(
  root: string,
  generator: (options: { root: string; writeText: (path: string, content: string) => Promise<void> }) => Promise<void>,
): Promise<Map<string, string>> {
  const outputs = new Map<string, string>()
  await generator({
    root,
    writeText: (path, content) => {
      outputs.set(FS.slashPath(FS.relativePath(root, path)), content)
      return Promise.resolve()
    },
  })
  return outputs
}

async function rulesyncOutputs(root: string): Promise<Map<string, string>> {
  const outputs = new Map<string, string>()
  const scratch = await FS.mkTmpDir('tao-agent-config-freshness-')
  try {
    for (const output of RULESYNC_OUTPUTS) {
      const committed = FS.resolvePath(output.path, root)
      if (!(await FS.isFile(committed))) {
        continue
      }
      const regenerated = FS.resolvePath(output.path, scratch)
      await FS.mkdir(FS.dirname(regenerated))
      await FS.copyFile(committed, regenerated)
      await generate({
        configPath: '.rulesync/rulesync.jsonc',
        features: [...output.features],
        inputRoot: root,
        outputRoots: [scratch],
        silent: true,
        targets: [output.target],
      })
      if (output.target === 'claudecode') {
        await FS.mkdir(FS.resolvePath('.rulesync', scratch))
        await FS.copyFile(
          FS.resolvePath('.rulesync/permissions.jsonc', root),
          FS.resolvePath('.rulesync/permissions.jsonc', scratch),
        )
        await FS.copyFile(
          FS.resolvePath('.rulesync/rulesync.jsonc', root),
          FS.resolvePath('.rulesync/rulesync.jsonc', scratch),
        )
        await generateClaudeHostSettings(scratch)
      }
      outputs.set(output.path, await FS.readText(regenerated))
    }
  } finally {
    await FS.remove(scratch)
  }
  return outputs
}

/** staleAgentConfigIssues reports each committed harness file that regenerating would change. */
async function staleAgentConfigIssues(root: string): Promise<string[]> {
  const expected = new Map([
    ...await renderedOutputs(root, CodexConfigGenerator.generate),
    ...await renderedOutputs(root, ClaudeProfilesGenerator.generate),
    ...await rulesyncOutputs(root),
  ])
  const issues: string[] = []
  for (const [path, content] of expected) {
    const committed = FS.resolvePath(path, root)
    if (await FS.isFile(committed) && await FS.readText(committed) !== content) {
      issues.push(`${path} ${STALE_DETAIL}`)
    }
  }
  return issues.sort()
}

/** AgentConfigFreshness is the gate behind "never edit a generated harness file". */
export const AgentConfigFreshness = { staleIssues: staleAgentConfigIssues }
