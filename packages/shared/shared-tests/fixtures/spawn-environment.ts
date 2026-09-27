import { CLI, HCI, Platform } from '@shared'

Platform.runtimeProcess.env['TAO_DYNAMIC_OUTPUT_FIXTURE'] = 'set after startup'
const inherited = await CLI.run('/bin/sh', {
  args: ['-c', 'printf "%s" "$TAO_DYNAMIC_OUTPUT_FIXTURE"'],
})
const overridden = await CLI.run('/bin/sh', {
  args: ['-c', 'printf "%s:%s" "$TAO_DYNAMIC_OUTPUT_FIXTURE" "$TAO_EXPLICIT_OUTPUT_FIXTURE"'],
  env: { TAO_EXPLICIT_OUTPUT_FIXTURE: 'per command' },
})
HCI.writeLine(JSON.stringify([inherited.stdout, overridden.stdout]))
