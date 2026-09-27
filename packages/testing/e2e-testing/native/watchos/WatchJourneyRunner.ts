import { FS, Repo } from '@shared'
import type { HostJourney } from '../../journey/HostJourney'
import { planWatchJourney } from './WatchJourneyPlan'

/** Supplies the native exporter with a reusable XCTest source and one fully preflighted Tao plan. */
export async function prepareWatchJourney(
  options: Readonly<{
    journey: HostJourney
    bundleIdentifier: string
    outputDirectory: string
  }>,
): Promise<Readonly<{ source: string; plan: string }>> {
  const plan = await planWatchJourney(options.journey, options.bundleIdentifier)
  const planPath = FS.resolvePath('WatchJourneyPlan.json', options.outputDirectory)
  const source = FS.resolvePath('WatchJourneyTests.swift', options.outputDirectory)
  await FS.writeJson(planPath, plan)
  await FS.copyFile(Repo.resolvePath('packages/testing/e2e-testing/native/watchos/WatchJourneyTests.swift'), source)
  return { source, plan: planPath }
}
