import type { CompiledFile } from '../../compiler'

/** One session's most recent generated Tao outputs for each source file. */
export class EmittedModuleCache {
  private readonly entries = new Map<string, { fingerprint: string; files: readonly CompiledFile[] }>()

  get(sourcePath: string, fingerprint: string): CompiledFile[] | undefined {
    const entry = this.entries.get(sourcePath)
    return entry?.fingerprint === fingerprint ? entry.files.map(file => ({ ...file })) : undefined
  }

  set(sourcePath: string, fingerprint: string, files: readonly CompiledFile[]): void {
    this.entries.set(sourcePath, { fingerprint, files: files.map(file => ({ ...file })) })
  }
}
