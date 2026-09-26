import { RuntimeToolchainPaths } from '@expo-host'
import { CLI, Errors, FS, Platform, TaoResources } from '@shared'

/** Client packaging used by app builds and the standalone Tao resource packager. */
export const AgentClientBuild = { source: agentClientSource, build: buildAgentClient } as const

/** Bundle once for the checkout or for inclusion in an installed Tao resource payload. */
async function agentClientSource(): Promise<string> {
  if (TaoResources.declaredRoot() !== undefined) {
    return await FS.readText(FS.resolvePath('expo-host-src/agent-client.js', RuntimeToolchainPaths.packageRoot))
  }
  const bundle = await Bun.build({ entrypoints: [FS.resolvePath('agent-client.ts', import.meta.dir)], target: 'bun' })
  const output = bundle.outputs[0]
  if (!bundle.success || output === undefined) {
    Errors.throwUnexpected(`Could not bundle the app command client: ${bundle.logs.map(log => log.message).join('\n')}`)
  }
  return await output.text()
}

/** Publish a native executable beside retained builds; it resolves its app relative to itself. */
async function buildAgentClient(app: string, buildsRoot: string, workRoot: string): Promise<string> {
  const artifactRoot = FS.dirname(FS.dirname(app))
  const source = FS.resolvePath('agent-client.js', workRoot)
  await FS.writeText(source, await agentClientSource())
  const entry = FS.resolvePath('agent-entry.js', workRoot)
  await FS.writeText(
    entry,
    [
      'import { dirname, resolve } from "node:path";',
      'import { realpathSync } from "node:fs";',
      'import { runAgentClient } from "./agent-client.js";',
      `await runAgentClient(resolve(dirname(realpathSync(process.execPath)), ${
        JSON.stringify(FS.relativePath(artifactRoot, app))
      }));`,
      '',
    ].join('\n'),
  )
  const executable = FS.resolvePath('agents', artifactRoot)
  await CLI.mustRun(Platform.runtimeProcess.execPath, {
    args: ['build', '--compile', '--outfile', executable, entry],
    env: { BUN_BE_BUN: '1' },
    stdio: 'pipe',
  })
  const destination = FS.resolvePath('agents', buildsRoot)
  await FS.replaceSymlink(FS.relativePath(buildsRoot, executable), destination)
  return executable
}
