import { Assert } from '@shared'
import { type Compiled, gen } from '../codegen-util'

/** emitSlotDescriptor pairs a stable module component with the enclosing render's current environment. */
export function emitSlotDescriptor(
  input: Readonly<{
    createRenderer: Compiled
    body: Compiled
    environment: Compiled
  }>,
): Compiled {
  return gen`(${input.createRenderer})((${input.body}), (${input.environment}))`
}

/** emitSlotPlacement keeps one frame across normalized empty and selected slot bindings. */
export function emitSlotPlacement(
  input: Readonly<{
    createElement: Compiled
    frameComponent: Compiled
    selection: Compiled
    selectedLocal: string
    rendererForSelected: Compiled
    argumentsForSelected: Compiled
    emptyArguments: Compiled
    taoProps: Compiled
    taoPropsLocal: string
    key?: Compiled
  }>,
): Compiled {
  Assert(input.selectedLocal !== input.taoPropsLocal, 'slot placement locals have distinct names')
  return gen`
    (() => {
      const ${input.selectedLocal} = (${input.selection});
      const ${input.taoPropsLocal} = (${input.taoProps});
      return (${input.createElement})((${input.frameComponent}), {
        renderer: ${input.selectedLocal} === null ? null : (${input.rendererForSelected}),
        args: ${input.selectedLocal} === null ? (${input.emptyArguments}) : (${input.argumentsForSelected}),
        taoProps: ${input.taoPropsLocal},
        ${input.key === undefined ? gen.noop() : gen`key: (${input.key}),`}
      });
    })()
  `
}
