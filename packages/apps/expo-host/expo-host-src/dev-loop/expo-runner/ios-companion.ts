/** Shared devicectl contract for opening the installed iOS Companion from local dev or Studio. */
export function companionLaunchArgs(
  input: { bundleIdentifier: string; hostId: string; terminateExisting: boolean; url: string },
): string[] {
  return [
    'device',
    'process',
    'launch',
    '--device',
    input.hostId,
    ...(input.terminateExisting ? ['--terminate-existing'] : []),
    '--payload-url',
    input.url,
    input.bundleIdentifier,
  ]
}

/** Names the installed-app probe shared by both launch surfaces. */
export function companionAppProbeArgs(hostId: string, bundleIdentifier: string): string[] {
  return ['device', 'info', 'apps', '--device', hostId, '--bundle-id', bundleIdentifier]
}

/** Undefined means devicectl returned no app list, rather than proving the Companion is absent. */
export function installedFromDevicectlApps(payload: unknown, bundleIdentifier: string): boolean | undefined {
  const apps = (payload as { result?: { apps?: unknown } } | undefined)?.result?.apps
  if (!Array.isArray(apps)) {
    return undefined
  }
  return apps.some(app => typeof app === 'object' && app !== null && app.bundleIdentifier === bundleIdentifier)
}
