import { FS, Platform } from '@shared'

/** Publishes the URL only after its complete readiness record has been written. */
export async function publishAccountServerReadiness(
  path: string,
  readiness: { url: string; resource?: string },
  writeJson: typeof FS.writeJson = FS.writeJson,
): Promise<void> {
  const staged = `${path}.${Platform.randomUUID()}.tmp`
  try {
    await writeJson(staged, readiness)
    await FS.move(staged, path)
  } catch (error) {
    await FS.remove(staged).catch(() => undefined)
    throw error
  }
}
