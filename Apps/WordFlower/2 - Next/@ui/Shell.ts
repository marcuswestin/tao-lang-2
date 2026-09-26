import type { BuildStamp as BuildStampContract } from './Shell.tao'

/** The TypeScript side of Shell.tao's build stamp. */
export const BuildStamp: BuildStampContract = () => process.env['TAO_BUILD'] ?? 'development'
