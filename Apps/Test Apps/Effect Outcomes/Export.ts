/** ExportProblem is how the export service names a failure: a case, and sometimes its own sentence. */
class ExportProblem extends Error {
  readonly caseName: string

  constructor(caseName: string, message = '') {
    super(message)
    this.caseName = caseName
  }
}

/** Export stands in for an external export service; `Mode` says which way this call ends. */
export async function Export(mode: string): Promise<void> {
  if (mode === 'Offline' || mode === 'TooLarge') {
    // No sentence of its own, so the one the action declares for the case is what a person reads.
    throw new ExportProblem(mode)
  }
  if (mode === 'Broken') {
    // A case the action never declares, with the service's own sentence.
    throw new ExportProblem('ServiceDown', 'The export service is down.')
  }
}
