import type { StudioCellEnvironment, StudioSchemeEnvironment } from '../studio-src/StudioPreviewManifest'

/** systemLightScheme is the scheme a fresh browser cell reports: system-requested, resolved light. */
export function systemLightScheme(): StudioSchemeEnvironment {
  return { capability: 'reactive-browser', requested: 'system', resolved: 'light', source: 'system' }
}

/** cellEnvironment is a phone-sized, online, light cell; pass only the sections a test changes. */
export function cellEnvironment(overrides: Partial<StudioCellEnvironment> = {}): StudioCellEnvironment {
  return {
    network: { latencyMs: 0, outcome: 'normal' },
    scheme: systemLightScheme(),
    viewport: { height: 844, width: 390 },
    ...overrides,
  }
}
