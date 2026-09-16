import { CLI } from '@shared'

export type IosSimulatorPresentation = {
  host: 'Device Hub' | 'Simulator'
  result: CLI.CommandResult
}

/**
 * Bring an iOS simulator forward on both Xcode generations.
 *
 * Xcode 27 replaces Simulator.app with DeviceHub.app. Device Hub uses a URL to select the simulated
 * device; older Xcodes still accept Simulator's `-CurrentDeviceUDID` launch argument.
 */
export async function presentIosSimulator(
  udid?: string,
  run: typeof CLI.run = CLI.run,
): Promise<IosSimulatorPresentation> {
  const simulatorArgs = ['-a', 'Simulator']
  if (udid !== undefined) {
    simulatorArgs.push('--args', '-CurrentDeviceUDID', udid)
  }
  const simulator = await run('open', { args: simulatorArgs, stdio: 'pipe' })
  if (simulator.exitCode === 0 && simulator.error === undefined) {
    return { host: 'Simulator', result: simulator }
  }

  const deviceHubArgs = udid === undefined
    ? ['-a', 'DeviceHub']
    : [`devices://device/open?id=${encodeURIComponent(udid)}`]
  return { host: 'Device Hub', result: await run('open', { args: deviceHubArgs, stdio: 'pipe' }) }
}
