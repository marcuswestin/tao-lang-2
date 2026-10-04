import { Errors, Platform } from '@shared'
import { runDevLoopController } from './DevLoopController'
import { readDevLoopReceipt } from './DevLoopStore'

// Only the fixed trusted launcher invokes this file; it is not a public command verb.
const session = Platform.runtimeProcess.env['TAO_DEV_LOOP_CONTROLLER_SESSION']
delete Platform.runtimeProcess.env['TAO_DEV_LOOP_CONTROLLER_SESSION']
if (session === undefined) {
  Errors.throwHostEnvironment('The private dev-loop controller requires a session.')
}
const controller = await runDevLoopController(await readDevLoopReceipt(session))
await controller.waitForDisposal()
