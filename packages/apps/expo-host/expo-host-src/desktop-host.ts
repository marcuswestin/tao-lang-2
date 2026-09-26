import { CLI, Errors, FS, Platform, TaoResources } from '@shared'
import { agentMainSource, agentRendererSource, agentRPCSchemaSource } from './desktop-agent-sources'
import { RuntimeToolchainPaths } from './runtime-toolchain-paths'

const electrobunVersion = '2.0.2-beta.12'
const hutchCliVersion = '0.24.3'

type DesktopHostProject = { root: string; hutch: string }

/** A generated local Electrobun shell for both Metro development and packaged static exports. */
export const DesktopHost = { prepare, build, runDev, agentHostSource } as const

async function prepare(
  options: { appName: string; root: string; siteRoot?: string; agents?: { buildId: string } },
): Promise<DesktopHostProject> {
  if (Platform.hostPlatform !== 'darwin') {
    Errors.throwHostEnvironment('Local Tao desktop .app builds require macOS.')
  }
  const hutch = await hutchExecutable()
  const root = options.root
  await FS.mkdir(root)
  await FS.writeText(
    FS.resolvePath('hutch.config.ts', root),
    [
      `// @hutch cli=${hutchCliVersion} cottontail=0.5.0`,
      `export default { electrobun: { version: ${JSON.stringify(electrobunVersion)} } }`,
      '',
    ].join('\n'),
  )
  await FS.writeJson(FS.resolvePath('package.json', root), {
    name: 'tao-desktop-host',
    private: true,
    type: 'module',
  })
  await FS.writeText(
    FS.resolvePath('electrobun.config.ts', root),
    configSource(options.appName, options.siteRoot !== undefined, options.agents !== undefined),
  )
  const manifest = options.agents === undefined ? undefined : {
    protocolVersion: 1,
    appId: appIdentifier(options.appName),
    appName: options.appName,
    buildId: options.agents.buildId,
  }
  await FS.writeText(FS.resolvePath('src/bun/index.ts', root), manifest ? agentMainSource(manifest) : mainSource())
  if (manifest) {
    await FS.writeText(FS.resolvePath('src/agent-rpc.ts', root), agentRPCSchemaSource)
    await FS.writeText(FS.resolvePath('src/agent/index.ts', root), agentRendererSource)
    await FS.writeJson(FS.resolvePath('tao-agent.json', root), manifest)
    await FS.writeText(FS.resolvePath('src/bun/agent-host.js', root), await agentHostSource())
  }
  if (options.siteRoot !== undefined) {
    await FS.copyDirectory(options.siteRoot, FS.resolvePath('site', root))
  }
  return { hutch, root }
}

/** Installed Tao carries this bundle because its resource tree has no repository TypeScript aliases. */
async function agentHostSource(): Promise<string> {
  if (TaoResources.declaredRoot() !== undefined) {
    return await FS.readText(FS.resolvePath('expo-host-src/desktop-agent-host.js', RuntimeToolchainPaths.packageRoot))
  }
  const bundle = await Bun.build({
    entrypoints: [FS.resolvePath('expo-host-src/desktop-agent-host.ts', RuntimeToolchainPaths.packageRoot)],
    target: 'bun',
  })
  const output = bundle.outputs[0]
  if (!bundle.success || output === undefined) {
    Errors.throwUnexpected(`Could not bundle the app command host: ${bundle.logs.map(log => log.message).join('\n')}`)
  }
  return await output.text()
}

async function build(project: DesktopHostProject): Promise<string> {
  await runHutch(project, ['electrobun', 'build', '--env=dev'])
  const apps: string[] = []
  for await (const path of FS.walk(project.root, { includeDirectories: true, includeHidden: true })) {
    if (path.endsWith('.app') && await FS.isDirectory(path)) {
      apps.push(path)
    }
  }
  if (apps.length !== 1) {
    Errors.throwHostEnvironment(`Electrobun created ${apps.length} desktop apps, expected one.`)
  }
  return apps[0]!
}

function runDev(
  project: DesktopHostProject,
  metroUrl: string,
  onOutput?: (stream: 'stderr' | 'stdout', chunk: Buffer) => void,
): CLI.StartedCommand {
  return CLI.start(project.hutch, {
    args: ['electrobun', 'dev', '--watch'],
    cwd: project.root,
    env: { ...Platform.runtimeProcess.env, TAO_DESKTOP_URL: metroUrl },
    onOutput,
  })
}

async function runHutch(project: DesktopHostProject, args: string[]): Promise<void> {
  const result = await CLI.run(project.hutch, {
    args,
    cwd: project.root,
    env: { ...Platform.runtimeProcess.env, CI: '1' },
    processPolicy: 'test',
    timeoutMs: 240_000,
    idleOutputMs: 60_000,
  })
  if (result.error || result.exitCode !== 0) {
    Errors.throwHostEnvironment(
      `Electrobun ${args.join(' ')} failed: ${
        result.stderr.trim() || result.stdout.trim() || result.error?.message || 'unknown error'
      }`,
    )
  }
}

async function hutchExecutable(): Promise<string> {
  if (await CLI.commandExists('hutch')) {
    return 'hutch'
  }
  const installed = FS.resolvePath('.hutch/bin/hutch', FS.homeDir())
  if (await FS.isFile(installed)) {
    return installed
  }
  return Errors.throwHostEnvironment('Hutch is required for Tao desktop builds. Install Hutch, then retry.')
}

function appIdentifier(appName: string): string {
  const name = appName.trim()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app'
  return `dev.tao.local.${slug}.${Platform.sha256Hex(name).slice(0, 8)}`
}

function configSource(appName: string, includeSite: boolean, agents = false): string {
  const name = appName.trim()
  if (!name || /[/:\\]/.test(name)) {
    Errors.throwUserInput('Desktop app name must be a non-empty file name.')
  }
  const identifier = appIdentifier(name)
  return [
    "import type { ElectrobunConfig } from 'electrobun'",
    'export default {',
    `  app: { name: ${JSON.stringify(name)}, identifier: ${JSON.stringify(identifier)}, version: '0.0.1' },`,
    `  runtime: { exitOnLastWindowClosed: ${!agents} },`,
    '  build: {',
    "    mainProcess: 'bun',",
    "    bun: { entrypoint: 'src/bun/index.ts' },",
    agents ? "    views: { agent: { entrypoint: 'src/agent/index.ts', format: 'iife' } }," : '',
    `    copy: { ${includeSite ? "'site': 'site'," : ''} ${agents ? "'tao-agent.json': 'tao-agent.json'," : ''} },`,
    '    mac: { bundleCEF: false, codesign: false, notarize: false, createDmg: false },',
    '  },',
    '} satisfies ElectrobunConfig',
    '',
  ].filter(Boolean).join('\n')
}

function mainSource(): string {
  return [
    "import { BrowserWindow } from 'electrobun'",
    "import { resolve, sep } from 'node:path'",
    'const devUrl = Bun.env.TAO_DESKTOP_URL',
    'const siteRoot = resolve(import.meta.dir, "../site")',
    'const server = devUrl ? undefined : Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {',
    '  const url = new URL(request.url)',
    '  let path: string',
    '  try { path = decodeURIComponent(url.pathname) } catch { return new Response("Bad path", { status: 400 }) }',
    '  if (path.includes("\\0") || path.split("/").includes("..")) return new Response("Bad path", { status: 400 })',
    '  if (path.endsWith("/")) path += "index.html"',
    '  const filePath = resolve(siteRoot, "." + path)',
    '  if (!filePath.startsWith(siteRoot + sep)) return new Response("Bad path", { status: 400 })',
    '  const file = Bun.file(filePath)',
    '  if (await file.exists()) return new Response(file)',
    '  const fallback = Bun.file(resolve(siteRoot, "index.html"))',
    '  return await fallback.exists() ? new Response(fallback) : new Response("Not found", { status: 404 })',
    '} })',
    'const url = devUrl ?? `http://127.0.0.1:${server!.port}/`',
    'new BrowserWindow({ title: "Tao", url, frame: { x: 120, y: 100, width: 1200, height: 800 } })',
    '',
  ].join('\n')
}
