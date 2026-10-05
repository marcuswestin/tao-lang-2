/** Opt-in, credential-local Firestore rules probe for the authored Firebase Notes app. */
import { main } from '../../../packages/cli/tao-cli/cli-src/firebase-hostile-probe'

if (import.meta.main) {
  process.exitCode = await main(import.meta.url)
}
