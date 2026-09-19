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

  if (udid !== undefined) {
    const selection = await run('open', {
      args: [`devices://device/open?id=${encodeURIComponent(udid)}`],
      stdio: 'pipe',
    })
    if (selection.exitCode === 0 && selection.error === undefined) {
      return { host: 'Device Hub', result: selection }
    }
  }

  // Some Xcode 27 installations register Device Hub without registering the devices:// URL
  // handler. Opening the application still gives the person a usable simulator host.
  return {
    host: 'Device Hub',
    result: await run('open', { args: ['-a', 'DeviceHub'], stdio: 'pipe' }),
  }
}
