import { CLI } from '@shared'
import { recordedCommand } from './CommandReceipts'
import type { DriverHostTestingRequest, HostTestingContext } from './HostTestingRequest'

type DriverHostProofDependencies = Readonly<{
  recordedCommand: typeof recordedCommand
}>

const defaultDependencies: DriverHostProofDependencies = { recordedCommand }

/** Runs the browser-driver contract suite that is deliberately absent from host-free controls. */
export async function runPlaywrightHostDriverProof(
  _request: DriverHostTestingRequest,
  context: HostTestingContext,
  dependencies: DriverHostProofDependencies = defaultDependencies,
): Promise<void> {
  await dependencies.recordedCommand(
    'playwright-driver',
    'node',
    {
      args: [
        context.playwright,
        'test',
        '--config',
        'packages/testing/e2e-testing/playwright.config.ts',
        '--project',
        'driver',
      ],
      env: context.environment,
      processPolicy: 'test',
      stdio: 'stream',
      timeoutMs: 120_000,
    } as const satisfies CLI.CommandSpec,
    context.artifactRoot,
  )
}
