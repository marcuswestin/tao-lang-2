import { Assert } from '@shared'
import type { nativeValueEmitter } from './emit-values'
import type { NativeApiCatalog } from './native-api'

/** Stable listener and pending capabilities are described entirely by catalog metadata. */
export function emitCapabilities(
  catalog: NativeApiCatalog,
  values: ReturnType<typeof nativeValueEmitter>,
  implementation: string,
) {
  const tao: string[] = []
  const sidecar: string[] = []
  if ((catalog.listeners?.length ?? 0) > 0) {
    tao.push(
      'public type NativeEventControls is {\n   PreventDefault boolean?,\n   StopPropagation boolean?,\n   StopImmediatePropagation boolean?\n}',
      '',
    )
  }
  for (const listener of catalog.listeners ?? []) {
    Assert.input(
      !listener.event || Number.isInteger(listener.event.argumentIndex) && listener.event.argumentIndex >= 0
          && listener.event.argumentIndex < listener.parameters.length,
      `Native listener '${listener.name}' must name a declared event argument.`,
    )
    Assert.input(
      listener.returnContract === 'void' || !!listener.returnProvenance,
      `Native listener '${listener.name}' needs a verified ignored return contract.`,
    )
    const callback = { kind: 'callback' as const, parameters: listener.parameters }
    const actionType = values.taoType(callback, `${listener.name}Action`)
    const args = listener.parameters.map(parameter => `TR.Value<${values.typescriptType(parameter.type)}>`).join(', ')
    tao.push(
      `public type ${listener.name} is item`,
      '',
      `public action Create${listener.name}(Action ${actionType}, Controls NativeEventControls? default none) returns ${listener.name} from ${implementation}`,
      '',
      `public action Release${listener.name}(Value ${listener.name}) from ${implementation}`,
      '',
    )
    sidecar.push(
      `const ${listener.name}Listener = TR.NativeEventListenerType<[${args}]>(${JSON.stringify(listener.name)},`,
      `  (...raw: unknown[]) => [${
        listener.parameters.map((parameter, index) =>
          `TR.Value(${
            values.fromNative(parameter.type, `(raw[${index}] as ${values.typescriptType(parameter.type, true)})`)
          })`
        ).join(', ')
      }],`,
      `  ${JSON.stringify(listener.event?.permittedControls ?? [])}, ${listener.event?.argumentIndex ?? 0})`,
      '',
      `export function Create${listener.name}(action: ${
        values.typescriptType(callback)
      }, controls: { PreventDefault?: boolean | null; StopPropagation?: boolean | null; StopImmediatePropagation?: boolean | null } | null = null): ReturnType<typeof ${listener.name}Listener.create> {`,
      `  return ${listener.name}Listener.create(action, { preventDefault: controls?.PreventDefault === true, stopPropagation: controls?.StopPropagation === true, stopImmediatePropagation: controls?.StopImmediatePropagation === true })`,
      '}',
      '',
      `export function Release${listener.name}(value: unknown): void { ${listener.name}Listener.release(value) }`,
      '',
    )
  }
  const pending = new Map<string, NonNullable<NativeApiCatalog['operations'][number]['pending']>>()
  for (const operation of catalog.operations) {
    if (!operation.pending) {
      continue
    }
    const known = pending.get(operation.pending.name)
    Assert.input(
      !known || JSON.stringify(known) === JSON.stringify(operation.pending),
      `Native pending declarations disagree at '${operation.pending.name}'.`,
    )
    pending.set(operation.pending.name, operation.pending)
  }
  if (pending.size > 0) {
    tao.push('public type NativePendingObserver is {\n   Remove action()\n}', '')
  }
  for (const descriptor of pending.values()) {
    const name = descriptor.name
    const nativeType = descriptor.result ? values.typescriptType(descriptor.result, true) : 'void'
    tao.push(`public type ${name} is item`, '')
    sidecar.push(`const ${name}Pending = TR.NativePendingType<${nativeType}>(${JSON.stringify(name)})`, '')
    for (
      const action of [
        { suffix: 'Status', result: 'text', type: 'string', expression: `${name}Pending.status(value)` },
        { suffix: 'Error', result: 'text?', type: 'string | null', expression: `${name}Pending.error(value)` },
        ...(descriptor.result
          ? [{
            suffix: 'Result',
            result: values.taoType(descriptor.result, `${name}ResultValue`),
            type: values.typescriptType(descriptor.result),
            expression: values.fromNative(descriptor.result, `${name}Pending.read(value)`),
          }]
          : []),
      ]
    ) {
      tao.push(
        `public action ${name}${action.suffix}(Value ${name}) returns ${action.result} from ${implementation}`,
        '',
      )
      sidecar.push(
        `export function ${name}${action.suffix}(value: unknown): ${action.type} { return ${action.expression} }`,
        '',
      )
    }
    tao.push(
      `public action Release${name}(Value ${name}) from ${implementation}`,
      '',
      `public action Observe${name}(Value ${name}, Action action()) returns NativePendingObserver from ${implementation}`,
      '',
    )
    sidecar.push(
      `export function Release${name}(value: unknown): void { ${name}Pending.release(value) }`,
      '',
      `export function Observe${name}(value: unknown, action: TR.ActionValue<[]>): { Remove: { invoke(): void | Promise<void> } } {`,
      `  const observer = ${name}Pending.observe(value, action)`,
      '  return { Remove: TR.Action(() => observer.remove()).evaluate().jsValue }',
      '}',
      '',
    )
  }
  return { tao, sidecar }
}
