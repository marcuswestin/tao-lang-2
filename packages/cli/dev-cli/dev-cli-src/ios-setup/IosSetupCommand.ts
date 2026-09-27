import { type AppleSetupOptions, AppleSetupPlatforms, AppleToolchainSetup } from '../apple-setup/AppleToolchainSetup'

export const IosSetupCommand = {
  run: (options: AppleSetupOptions & { runtimeVersion: string }) =>
    AppleToolchainSetup.run(options, AppleSetupPlatforms.ios),
}
