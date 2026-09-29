import { Assert, Errors, Switch } from '@shared'
import type { NativeApiCatalog, NativeApiEnum, NativeApiType } from './native-api'

export function taoName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Emit value conversions from the catalog, without provider or operation-specific branches. */
export function nativeValueEmitter(catalog: NativeApiCatalog) {
  const records = catalog.records ?? []
  const conversions = { to: new Set<string>(), from: new Set<string>() }
  function requireConversion(type: NativeApiType, direction: 'to' | 'from'): void {
    Switch.kind(type, {
      primitive: () => {},
      enum: type => {
        conversions[direction].add(type.name)
      },
      record: type => {
        if (conversions[direction].has(type.name)) {
          return
        }
        conversions[direction].add(type.name)
        const record = records.find(record => record.name === type.name)
        Assert.defined(record, 'referenced native record exists')
        // Resources use their ownership token rather than converting their disposal callback.
        if (!record.disposal) {
          for (const field of record.fields) {
            requireConversion(field.type, direction)
          }
        }
      },
      nullable: type => requireConversion(type.value, direction),
      list: type => requireConversion(type.element, direction),
      union: () => {},
      callback: type => {
        for (const parameter of type.parameters) {
          requireConversion(parameter.type, direction === 'to' ? 'from' : 'to')
        }
      },
    })
  }
  for (const operation of catalog.operations) {
    for (const parameter of operation.parameters) {
      requireConversion(parameter.type, 'to')
    }
    if (operation.result) {
      requireConversion(operation.result, 'from')
    }
  }
  const declarationNames = new Set([
    ...catalog.enums.map(type => type.name),
    ...records.map(type => type.name),
    ...catalog.operations.map(operation => taoName(operation.name)),
  ])
  function enumCaseName(enumeration: NativeApiEnum, member: NativeApiEnum['members'][number]): string {
    const duplicates =
      catalog.enums.flatMap(type => type.members).filter(candidate => candidate.name === member.name).length > 1
    return duplicates || declarationNames.has(member.name) ? `${enumeration.name}_${member.name}` : member.name
  }
  function taoType(type: NativeApiType): string {
    return Switch.kind(type, {
      primitive: type => type.name,
      enum: type => type.name,
      record: type => type.name,
      nullable: type => `${taoType(type.value)}?`,
      callback: type => `action(${type.parameters.map(parameter => taoType(parameter.type)).join(', ')})`,
      list: type => `list of ${taoType(type.element)}`,
      union: type => type.members.map(taoType).join(' | '),
    })
  }
  function typescriptType(type: NativeApiType, native = false): string {
    return Switch.kind(type, {
      primitive: type => type.name === 'text' ? 'string' : type.name,
      enum: type => {
        const enumeration = catalog.enums.find(item => item.name === type.name)
        Assert.defined(enumeration, 'referenced native enum exists')
        return !native ? 'unknown' : enumeration.literal
          ? enumeration.members.map(member => JSON.stringify(member.value)).join(' | ')
          : `import(${JSON.stringify(catalog.packageName)}).${type.name}`
      },
      record: type => `${native ? 'Native' : ''}${type.name}${native ? '' : 'Value'}`,
      nullable: type => `${typescriptType(type.value, native)} | null`,
      callback: type =>
        native
          ? `(${
            type.parameters.map((parameter, index) => `value${index}: ${typescriptType(parameter.type, true)}`).join(
              ', ',
            )
          }) => void`
          : `TR.ActionValue<[${
            type.parameters.map(parameter => `TR.Value<${typescriptType(parameter.type)}>`).join(', ')
          }]>`,
      list: type => `Array<${typescriptType(type.element, native)}>`,
      union: type => type.members.map(member => typescriptType(member, native)).join(' | '),
    })
  }
  function toNative(type: NativeApiType, value: string, lifetime?: string): string {
    return Switch.kind(type, {
      primitive: () => value,
      enum: type => `to${type.name}(${value})`,
      record: type => `to${type.name}(${value})`,
      nullable: type => `${value} === null ? null : ${toNative(type.value, value, lifetime)}`,
      list: type =>
        type.element.kind === 'primitive'
          ? value
          : `${value}.map(value => ${toNative(type.element, 'value', lifetime)})`,
      union: () => value,
      callback: type => {
        Assert.defined(lifetime, 'native callbacks require a subscription lifetime')
        const arguments_ = type.parameters.map((parameter, index) =>
          `TR.Value(${fromNative(parameter.type, `value${index}`)})`
        )
        return `(${
          type.parameters.map((parameter, index) => `value${index}: ${typescriptType(parameter.type, true)}`).join(', ')
        }) => { if (${lifetime}.active) ${lifetime}.invoke(${value}${
          arguments_.length ? `, ${arguments_.join(', ')}` : ''
        }) }`
      },
    })
  }
  function fromNative(type: NativeApiType, value: string, lifetime?: string): string {
    return Switch.kind(type, {
      primitive: () => value,
      enum: type => `from${type.name}(${value})`,
      record: type => {
        const owned = records.find(record => record.name === type.name)?.disposal
        if (owned) {
          Assert.defined(lifetime, 'native resources acquire ownership before invocation')
        }
        return `from${type.name}(${value}${owned ? `, ${lifetime}` : ''})`
      },
      nullable: type => `${value} === null ? null : ${fromNative(type.value, value, lifetime)}`,
      list: type =>
        type.element.kind === 'primitive'
          ? value
          : `${value}.map(value => ${fromNative(type.element, 'value', lifetime)})`,
      union: () => value,
      callback: () => Errors.throwUserInput('Callbacks cannot be converted as native data values.'),
    })
  }
  function declarations(): string[] {
    const lines: string[] = []
    for (const enumeration of catalog.enums) {
      const type: NativeApiType = { kind: 'enum', name: enumeration.name }
      const nativeValue = (member: typeof enumeration.members[number]) =>
        enumeration.literal
          ? JSON.stringify(member.value)
          : `native().${enumeration.name}.${member.name}`
      if (conversions.to.has(enumeration.name)) {
        lines.push(`function to${enumeration.name}(value: unknown): ${typescriptType(type, true)} {`)
        for (const member of enumeration.members) {
          lines.push(
            `  if (Object.is(value, ${enumeration.name}.${
              enumCaseName(enumeration, member)
            }.evaluate().jsValue)) return ${nativeValue(member)}`,
          )
        }
        lines.push(`  throw new TypeError(${JSON.stringify(`Expected a declared ${enumeration.name} case.`)})`, '}', '')
      }
      if (conversions.from.has(enumeration.name)) {
        lines.push(`function from${enumeration.name}(value: ${typescriptType(type, true)}): unknown {`)
        for (const member of enumeration.members) {
          lines.push(
            `  if (Object.is(value, ${nativeValue(member)})) return ${enumeration.name}.${
              enumCaseName(enumeration, member)
            }.evaluate().jsValue`,
          )
        }
        lines.push(`  throw new TypeError(${JSON.stringify(`Unknown native ${enumeration.name} case.`)})`, '}', '')
      }
    }
    for (const record of records) {
      const type: NativeApiType = { kind: 'record', name: record.name }
      for (const native of [false, true]) {
        lines.push(`type ${typescriptType(type, native)} = {`)
        for (const field of record.fields) {
          const fieldType = !native && record.disposal && field.type.kind === 'callback'
            ? '{ invoke(): void | Promise<void> }'
            : typescriptType(field.type, native)
          lines.push(
            `  ${JSON.stringify(native ? field.name : taoName(field.name))}${field.optional ? '?' : ''}: ${fieldType}${
              field.optional && !native ? ' | null' : ''
            }`,
          )
        }
        lines.push('}', '')
      }
      if (record.disposal) {
        const method = taoName(record.disposal)
        lines.push(
          `const ${record.name}Handles = new WeakMap<${record.name}Value[${
            JSON.stringify(method)
          }], Native${record.name}>()`,
        )
        if (conversions.to.has(record.name)) {
          lines.push(
            `function to${record.name}(value: ${record.name}Value): Native${record.name} {`,
            `  const handle = ${record.name}Handles.get(value.${method})`,
            `  if (!handle) throw new TypeError(${JSON.stringify(`Expected a generated ${record.name} handle.`)})`,
            '  return handle',
            '}',
            '',
          )
        }
        if (conversions.from.has(record.name)) {
          lines.push(
            `function from${record.name}(value: Native${record.name}, lifetime: ReturnType<typeof TR.NativeSubscription>): ${record.name}Value {`,
            `  lifetime.attach(() => value.${record.disposal}())`,
            `  const result = { ${method}: TR.Action(() => lifetime.remove()).evaluate().jsValue }`,
            // The structural native handle routes every disposal path through the same idempotent token.
            `  ${record.name}Handles.set(result.${method}, { ${record.disposal}: () => lifetime.remove() })`,
            '  return result',
            '}',
            '',
          )
        }
        continue
      }
      for (const native of [false, true]) {
        if (!conversions[native ? 'to' : 'from'].has(record.name)) {
          continue
        }
        const convert = native ? toNative : fromNative
        lines.push(
          `function ${native ? 'to' : 'from'}${record.name}(value: ${typescriptType(type, !native)}): ${
            typescriptType(type, native)
          } {`,
          '  return {',
        )
        for (const field of record.fields) {
          const key = JSON.stringify(native ? field.name : taoName(field.name))
          const fieldValue = `value[${JSON.stringify(native ? taoName(field.name) : field.name)}]`
          const entry = `${key}: ${convert(field.type, fieldValue)}`
          lines.push(field.optional ? `    ...(${fieldValue} == null ? {} : { ${entry} }),` : `    ${entry},`)
        }
        lines.push('  }', '}', '')
      }
    }
    return lines
  }
  return { declarations, taoType, typescriptType, toNative, fromNative, enumCaseName }
}
