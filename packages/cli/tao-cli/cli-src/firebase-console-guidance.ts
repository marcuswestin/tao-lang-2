import { HCI } from '@shared'
import type { Writable } from 'node:stream'

/** Opens the exact product pages without depending on collapsed Console navigation. */
export function printFirebaseConsoleSetup(projectId: string, out: { output?: Writable } = {}): void {
  const projectUrl = `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}`
  HCI.writeLine(
    'Open these links directly in your browser; searching the project overview will not find these settings.',
    out,
  )
  HCI.writeLine(`1. Authentication: ${projectUrl}/authentication/providers`, out)
  HCI.writeLine(
    '   If Get started appears, click it. In Sign-in method, click Email/Password, enable Email/Password, then Save.',
    out,
  )
  HCI.writeLine(`2. Firestore: ${projectUrl}/firestore`, out)
  HCI.writeLine(
    '   Select the (default) database. If missing, click Create database, choose Standard edition if asked,',
    out,
  )
  HCI.writeLine('   keep Database ID as (default), choose a location, and select Production mode when prompted.', out)
  HCI.writeLine('   The database location is permanent. Finish the wizard with Create or Enable, as shown.', out)
  HCI.writeLine('3. On that Firestore page, click Rules to review or publish the database rules.', out)
}
