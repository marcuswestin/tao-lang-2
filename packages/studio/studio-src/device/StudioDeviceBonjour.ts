import { CLI } from '@shared'

export const studioDeviceBonjourService = '_tao-studio._tcp'

export type StartedStudioDeviceBonjour = {
  readonly args: readonly string[]
  stop(): void
}

export type StudioDeviceBonjourOptions = {
  log?: (line: string) => void
  platform?: NodeJS.Platform
  port: number
  start?: typeof CLI.start
  studioPublicKey: string
}

/**
 * Advertises one running gateway through macOS Bonjour. The TXT key is not a trust grant: a device
 * accepts the endpoint only when it equals the Studio public key already pinned by QR/deep link.
 */
export function startStudioDeviceBonjour(options: StudioDeviceBonjourOptions): StartedStudioDeviceBonjour | undefined {
  if ((options.platform ?? process.platform) !== 'darwin') {
    return undefined
  }
  const args = [
    '-R',
    `Tao Studio ${options.studioPublicKey.slice(0, 8)}`,
    studioDeviceBonjourService,
    'local.',
    String(options.port),
    'protocol=tao-studio-device-v1',
    `studioPublicKey=${options.studioPublicKey}`,
    'capabilities=authenticated-gateway',
  ]
  const command = (options.start ?? CLI.start)('/usr/bin/dns-sd', { args, stdio: 'pipe' })
  command.onceError(error => options.log?.(`Bonjour advertisement failed: ${error.message}`))
  return {
    args,
    stop() {
      if (command.exitCode === null && command.signalCode === null) {
        command.kill('SIGTERM')
      }
      command.dispose()
    },
  }
}
