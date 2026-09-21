import { CLI, Errors, FS, HCI, Repo, Switch } from '@shared'
import { recordedCommand } from './CommandReceipts'
import { lintHostTestSources } from './enforcement/EffectBoundaryLint'
import { expandHostTestSourcePatterns } from './enforcement/HostTestSourceRegistry'
import type { HostTestingContext, MaintenanceHostTestingRequest } from './HostTestingRequest'

/** Runs host-free maintenance and control modes for the e2e package. */
export async function runHostTestingMaintenance(
  request: MaintenanceHostTestingRequest,
  context: HostTestingContext,
): Promise<void> {
  return await Switch(request.mode, {
    check: () => runControls(context),
    format: () => runFormat(context),
    lint: () => runEffectBoundary(context),
    setup: () => runSetup(context),
    typecheck: () => runTypecheck(context),
  })
}

async function runControls(context: HostTestingContext): Promise<void> {
  await recordedCommand('controls', 'node', {
    args: [
      context.playwright,
      'test',
      '--config',
      'packages/testing/e2e-testing/playwright.config.ts',
      '--project',
      'controls',
    ],
    env: context.environment,
    processPolicy: 'test',
    stdio: 'stream',
    timeoutMs: 120_000,
  }, context.artifactRoot)
}

async function runEffectBoundary(context: HostTestingContext): Promise<void> {
  const expansion = await expandHostTestSourcePatterns(Repo.getRoot())
  const issues = await lintHostTestSources(Repo.getRoot(), { files: expansion.paths })
  await FS.writeJson(FS.resolvePath('effect-boundary.json', context.artifactRoot), { ...expansion, issues })
  if (issues.length > 0) {
    Errors.throwUserInput(`Effect boundary failed; see ${context.artifactRoot}/effect-boundary.json`)
  }
  HCI.writeLine(`PASS effect boundary for ${expansion.paths.length} files from ${expansion.patterns.length} patterns.`)
}

async function runFormat(context: HostTestingContext): Promise<void> {
  await recordedCommand('format', 'dprint', {
    args: [
      'fmt',
      '--incremental=false',
      'packages/testing/e2e-testing/**',
      'packages/apps/runtime/TaoRuntime-src/host-testing/**',
      'packages/apps/runtime/TaoRuntime-src/core/**',
      'packages/providers/icloud/plugins/with-tao-icloud.cjs',
    ],
  }, context.artifactRoot)
}

async function runSetup(context: HostTestingContext): Promise<void> {
  await CLI.mustRun('node', { args: [context.playwright, 'install', 'chromium'], stdio: 'stream' })
}

async function runTypecheck(context: HostTestingContext): Promise<void> {
  await recordedCommand('parser-generate', 'just', { args: ['_parser-gen'] }, context.artifactRoot)
  await recordedCommand('typecheck', 'bun', {
    args: ['node_modules/typescript-native/bin/tsc', '--project', 'packages/testing/e2e-testing/tsconfig.json'],
  }, context.artifactRoot)
}
