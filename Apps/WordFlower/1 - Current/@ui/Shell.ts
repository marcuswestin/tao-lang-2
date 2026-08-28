/** The TypeScript side of Shell.tao's build stamp. */
export const BuildStamp = (): string => process.env['TAO_BUILD'] ?? 'development'
