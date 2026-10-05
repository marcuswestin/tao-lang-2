import type { StudioPreviewConnection } from './StudioPreviewConnection'

/** Keeps Studio's post-toggle focus and chrome updates attached when a manifest refresh rewires a cell. */
export function reconcilePreviewActivation(
  previews: readonly StudioPreviewConnection[],
  wired: WeakMap<StudioPreviewConnection, () => Promise<void>>,
  afterToggle: (preview: StudioPreviewConnection) => void,
): void {
  for (const preview of previews) {
    if (preview.toggleActivation === undefined || wired.get(preview) === preview.toggleActivation) {
      continue
    }
    const toggle = preview.toggleActivation
    const wrapped = async (): Promise<void> => {
      await toggle()
      afterToggle(preview)
    }
    preview.toggleActivation = wrapped
    wired.set(preview, wrapped)
  }
}
