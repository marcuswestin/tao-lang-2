import { ReleaseToolchain } from '@shared'

/** The editor and Studio enforce the same project toolchain identity. */
export async function requireMatchingEditorRelease(workspaceRoot: string): Promise<void> {
  await ReleaseToolchain.requireMatchingProjectRelease(workspaceRoot, 'editor')
}
