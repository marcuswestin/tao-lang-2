const studioViewportPresets: Readonly<Record<string, Readonly<{ height: number; width: number }>>> = {
  laptop: { height: 900, width: 1_440 },
  phone: { height: 844, width: 390 },
  tablet: { height: 1_180, width: 820 },
}

export function StudioViewportPresetWidth(preset: string, fallback: number): number {
  return studioViewportPresets[preset]?.width ?? fallback
}

export function StudioViewportPresetHeight(preset: string, fallback: number): number {
  return studioViewportPresets[preset]?.height ?? fallback
}

export function StudioEnvironmentValid(
  widthValid: boolean,
  heightValid: boolean,
  latencyValid: boolean,
  errorStatusValid: boolean,
  network: string,
  errorMessage: string,
): boolean {
  return widthValid
    && heightValid
    && latencyValid
    && (network !== 'error' || (errorStatusValid && errorMessage.trim() !== ''))
}

export function StudioNetworkShowsError(network: string): boolean {
  return network === 'error'
}
