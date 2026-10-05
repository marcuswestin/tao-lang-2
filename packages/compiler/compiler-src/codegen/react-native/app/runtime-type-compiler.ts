import { ASTUtils } from '@ast-utils'
import { Switch } from '@shared'
import { type Compiled, gen } from '../codegen-util'

/** compileRuntimeType returns the generated wrapper type for one statically resolved Tao value. */
export function compileRuntimeType(type: ASTUtils.TaoType): Compiled {
  return Switch.kind(type, {
    primitive: type =>
      Switch(type.primitive, {
        action: () => {
          const parameters = type.primitive === 'action' ? type.parameters : []
          return gen`TR.Action<[${
            gen.join(
              parameters,
              parameter => gen`${compileRuntimeType(parameter.type)}${parameter.optional ? '?' : ''}`,
            )
          }]>`
        },
        boolean: () => gen`TR.Value<boolean>`,
        none: () => gen`TR.Value<null>`,
        number: () => gen`TR.Value<number>`,
        numeric: () => gen`TR.Value<number>`,
        text: () => gen`TR.Value<string>`,
        time: () => gen`TR.Value<number>`,
        duration: () => gen`TR.Value<number>`,
        color: () => gen`TR.Value<string>`,
        shortcut: () => gen`TR.Value<string>`,
        command: () => gen`TR.CommandValue`,
        design: () => gen`TR.Evaluable`,
        view: () => gen`TR.Presentable`,
        scene: () => gen`TR.Presentable`,
        nav: () => gen`TR.NavigationValue`,
        datasource: () => gen`TR.Evaluable`,
        // `data` names a collection in a datasource's membership list and never reaches a value
        // position, so it carries no runtime wrapper of its own.
        data: () => gen`TR.Evaluable`,
        app: () => gen`TR.Evaluable`,
      }),
    list: () => gen`TR.Value<any[]>`,
    item: () => gen`TR.Value<Record<string, any>>`,
    entity: () => gen`TR.Value<Record<string, any>>`,
    enum: () => gen`TR.Value<TR.EnumCaseIdentity>`,
    unresolved: () => gen`TR.Value<Record<string, any>>`,
    union: () => gen`TR.Evaluable`,
  })
}
