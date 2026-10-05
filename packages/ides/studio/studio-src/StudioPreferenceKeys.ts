/** Browser-safe names used by both the home preference store and its one-time legacy import. */
export const studioPreferenceKeys = [
  'tao-studio:pane-sizes:v4',
  'tao-studio:layout-preset:v1',
  'tao-studio:rail-panel:v1',
  'tao-studio:drawer-tab:v1',
  'tao-studio.lens',
  'tao-studio:agent-position:v1',
] as const

export type StudioPreferenceKey = typeof studioPreferenceKeys[number]
export type StudioPreferenceValues = Partial<Record<StudioPreferenceKey, string>>
