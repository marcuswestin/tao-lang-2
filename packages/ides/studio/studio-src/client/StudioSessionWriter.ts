type SessionField = 'focusedCellId' | 'editorTabs'
type WriteSessionField = (field: SessionField, value: unknown) => Promise<void>

/** Keeps each field's user actions in order even when an earlier HTTP save is slow or fails. */
export class StudioSessionWriter {
  readonly #pending = new Map<SessionField, Promise<void>>()
  readonly #write: WriteSessionField

  constructor(write: WriteSessionField) {
    this.#write = write
  }

  save(field: SessionField, value: unknown): Promise<void> {
    const pending = (this.#pending.get(field) ?? Promise.resolve()).then(() => this.#write(field, value))
    // The caller receives the failure; later actions must still be able to save.
    this.#pending.set(field, pending.catch(() => {}))
    return pending
  }
}
