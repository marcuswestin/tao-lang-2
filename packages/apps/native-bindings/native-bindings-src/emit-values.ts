import { Assert, Errors, Switch } from '@shared'
import { referencePredicate } from './emit-references'
import { nativeTaoTypeEmitter } from './emit-tao-types'
import type { NativeApiCatalog, NativeApiEnum, NativeApiType } from './native-api'

export function taoName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Emit value conversions from the catalog, without provider or operation-specific branches. */
export function nativeValueEmitter(catalog: NativeApiCatalog) {
  const taoTypes = nativeTaoTypeEmitter(catalog)
  const records = catalog.records ?? []
  const conversions = { to: new Set<string>(), from: new Set<string>() }
  const predicateEnums = new Set<string>()
  const maps = taoTypes.maps
  let dynamic = false
  let union = false
  let absence = false
  let callbacks = false
  function requireConversion(type: NativeApiType, direction: 'to' | 'from'): void {
    Switch.kind(type, {
      primitive: () => {},
      reference: () => {},
      listener: type => {
        const listener = catalog.listeners?.find(listener => listener.name === type.name)
        Assert.defined(listener, 'referenced native listener exists')
        listener.parameters.forEach(parameter => requireConversion(parameter.type, 'from'))
      },
      dynamic: () => {
        dynamic = true
      },
      bytes: () => {},
      absence: () => {
        dynamic = true
        absence = true
      },
      map: type => {
        maps.set(type.name, type)
        conversions[direction].add(type.name)
        requireConversion(type.value, direction)
      },
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
      union: type => {
        union = true
        type.members.forEach(member => requireConversion(member, direction))
      },
      callback: type => {
        callbacks = true
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
    if (operation.pending?.result) {
      requireConversion(operation.pending.result, 'from')
    }
  }
  for (const listener of catalog.listeners ?? []) {
    listener.parameters.forEach(parameter => requireConversion(parameter.type, 'from'))
  }
  for (const record of records) {
    for (const field of record.fields) {
      taoType(field.type, `${record.name}${taoName(field.name)}`)
    }
  }
  for (const operation of catalog.operations) {
    for (const parameter of operation.parameters) {
      taoType(parameter.type, `${taoName(operation.name)}${taoName(parameter.name)}`)
    }
    if (operation.result) {
      taoType(operation.result, `${taoName(operation.name)}Result`)
    }
  }
  for (const map of maps.values()) {
    taoType(map.value, `${map.name}EntryValue`)
  }
  const declarationNames = new Set([
    ...catalog.enums.map(type => type.name),
    ...records.map(type => type.name),
    ...(catalog.references ?? []).map(type => type.name),
    ...catalog.operations.map(operation => taoName(operation.name)),
    ...taoTypes.names(),
  ])
  function enumCaseName(enumeration: NativeApiEnum, member: NativeApiEnum['members'][number]): string {
    const duplicates =
      catalog.enums.flatMap(type => type.members).filter(candidate => candidate.name === member.name).length > 1
    return duplicates || declarationNames.has(member.name) ? `${enumeration.name}_${member.name}` : member.name
  }
  function taoType(type: NativeApiType, hint: string): string {
    return taoTypes.render(type, hint)
  }
  function typescriptType(type: NativeApiType, native = false, structuralCallbacks = false): string {
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
      reference: type => native ? `Native${type.name}` : `TR.NativeReference<Native${type.name}>`,
      listener: type =>
        native
          ? catalog.listeners!.find(listener => listener.name === type.name)!.typescript
          : `ReturnType<typeof ${type.name}Listener.create>`,
      dynamic: () => native ? 'unknown' : 'TR.NativeReference<unknown>',
      absence: type => native ? type.value : 'TR.NativeReference<unknown>',
      bytes: () => native ? 'Uint8Array<ArrayBuffer>' : 'number[]',
      map: type =>
        native
          ? `Record<string, ${typescriptType(type.value, true)}>`
          : `Array<{ Key: string; Value: ${typescriptType(type.value)} }>`,
      nullable: type =>
        `${typescriptType(type.value, native, structuralCallbacks)} | ${
          native && type.absence === 'undefined' ? 'undefined' : 'null'
        }`,
      callback: type =>
        native
          ? `(${
            type.parameters.map((parameter, index) => `value${index}: ${typescriptType(parameter.type, true)}`).join(
              ', ',
            )
          }) => void`
          : structuralCallbacks
          ? `{ invoke(...args: [${
            type.parameters.map(parameter => `TR.Value<${typescriptType(parameter.type)}>`).join(', ')
          }]): void | Promise<void> }`
          : `TR.ActionValue<[${
            type.parameters.map(parameter => `TR.Value<${typescriptType(parameter.type)}>`).join(', ')
          }]>`,
      list: type => `Array<${typescriptType(type.element, native, structuralCallbacks)}>`,
      union: type => type.members.map(member => typescriptType(member, native, structuralCallbacks)).join(' | '),
    })
  }
  function toNative(type: NativeApiType, value: string, lifetime?: string, path = '[]'): string {
    return Switch.kind(type, {
      primitive: () => value,
      enum: type => `to${type.name}(${value})`,
      record: type =>
        `to${type.name}(${value}${
          records.find(record => record.name === type.name)?.disposal ? '' : `, ${lifetime ?? '{}'}, ${path}`
        })`,
      reference: type => `${type.name}Reference.unwrap(${value})`,
      listener: type => `${type.name}Listener.unwrap(${value})`,
      dynamic: () => `TR.NativeValues.unbox(${value})`,
      absence: type => `checkedAbsence(TR.NativeValues.unbox(${value}), ${type.value})`,
      bytes: () => `TR.NativeBytes.fromList(${value})`,
      map: type => `to${type.name}(${value}, ${lifetime ?? '{}'}, ${path})`,
      nullable: type =>
        `((value: ${typescriptType(type)}) => value === null ? ${
          type.absence === 'undefined' ? 'undefined' : 'null'
        } : ${toNative(type.value, 'value', lifetime, path)})(${value})`,
      list: type =>
        type.element.kind === 'primitive'
          ? value
          : `${value}.map(value => ${toNative(type.element, 'value', lifetime, path)})`,
      union: type => unionConversion(type, value, 'to', lifetime, path),
      callback: type => {
        Assert.defined(lifetime, 'native callbacks require a subscription lifetime')
        const arguments_ = type.parameters.map((parameter, index) =>
          `TR.Value(${fromNative(parameter.type, `value${index}`)})`
        )
        return `nativeCallback(${lifetime}, ${path}, ${value}, (${
          type.parameters.map((parameter, index) => `value${index}: ${typescriptType(parameter.type, true)}`).join(', ')
        }) => [${arguments_.join(', ')}])`
      },
    })
  }
  function fromNative(type: NativeApiType, value: string, lifetime?: string): string {
    return Switch.kind(type, {
      primitive: () => value,
      reference: type => `${type.name}Reference.wrap(${value})`,
      listener: type => `${type.name}Listener.wrap(${value})`,
      dynamic: () => `TR.NativeValues.box(${value})`,
      absence: type => `TR.NativeValues.box(checkedAbsence(${value}, ${type.value}))`,
      bytes: () => `TR.NativeBytes.toList(${value})`,
      map: type => `from${type.name}(${value})`,
      enum: type => `from${type.name}(${value})`,
      record: type => {
        const owned = records.find(record => record.name === type.name)?.disposal
        if (owned) {
          Assert.defined(lifetime, 'native resources acquire ownership before invocation')
        }
        return `from${type.name}(${value}${owned ? `, ${lifetime}` : ''})`
      },
      nullable: type =>
        `((value: ${typescriptType(type, true)}) => value === ${
          type.absence === 'undefined' ? 'undefined' : 'null'
        } ? null : ${fromNative(type.value, 'value', lifetime)})(${value})`,
      list: type =>
        type.element.kind === 'primitive'
          ? value
          : `${value}.map(value => ${fromNative(type.element, 'value', lifetime)})`,
      union: type => unionConversion(type, value, 'from', lifetime),
      callback: () => Errors.throwUserInput('Callbacks cannot be converted as native data values.'),
    })
  }
  function predicate(type: NativeApiType, value: string, native: boolean): string {
    return Switch.kind(type, {
      primitive: type => `typeof ${value} === ${JSON.stringify(type.name === 'text' ? 'string' : type.name)}`,
      reference: type => {
        const reference = catalog.references?.find(reference => reference.name === type.name)
        Assert.defined(reference, 'referenced native type exists')
        return native ? `(${referencePredicate(reference, value)})` : `${type.name}Reference.is(${value})`
      },
      listener: type =>
        native
          ? `(typeof ${value} === 'function' || (${value} !== null && typeof ${value} === 'object' && typeof (${value} as { handleEvent?: unknown }).handleEvent === 'function'))`
          : `${type.name}Listener.is(${value})`,
      enum: type => {
        const enumeration = catalog.enums.find(enumeration => enumeration.name === type.name)
        Assert.defined(enumeration, 'referenced native enum exists')
        if (!native) {
          predicateEnums.add(type.name)
        }
        return `(${
          enumeration.members.map(member =>
            `Object.is(${value}, ${
              native
                ? enumeration.literal ? JSON.stringify(member.value) : `native().${enumeration.name}.${member.name}`
                : `${enumeration.name}.${enumCaseName(enumeration, member)}.evaluate().jsValue`
            })`
          ).join(' || ')
        })`
      },
      record: type => {
        const record = records.find(record => record.name === type.name)
        Assert.defined(record, 'referenced native record exists')
        Assert.input(!record.disposal, 'Subscription resources cannot be union values.')
        return `(${value} !== null && typeof ${value} === 'object'${
          native && record.tuple ? ` && Array.isArray(${value}) && ${value}.length === ${record.fields.length}` : ''
        }${
          record.fields.map((field, index) => {
            const key = JSON.stringify(native ? record.tuple ? index : field.name : taoName(field.name))
            const fieldValue = `(${value} as ${typescriptType(type, native)})[${key}]`
            const present = `Object.hasOwn(${value}, ${key})`
            const checked = predicate(field.type, fieldValue, native)
            return field.optional || !native && field.type.kind === 'nullable'
              ? ` && (!${present} || ${fieldValue} === ${native ? 'undefined' : 'null'} || ${checked})`
              : ` && ${present} && ${checked}`
          }).join('')
        })`
      },
      list: type =>
        `((values: unknown) => Array.isArray(values) && Array.from(values).every(value => ${
          predicate(type.element, 'value', native)
        }))(${value})`,
      nullable: type =>
        `(${value} === ${native && type.absence === 'undefined' ? 'undefined' : 'null'} || ${
          predicate(type.value, value, native)
        })`,
      union: type => `(${type.members.map(member => predicate(member, value, native)).join(' || ')})`,
      bytes: () =>
        native
          ? `${value} instanceof Uint8Array`
          : `((values: unknown) => Array.isArray(values) && Array.from(values).every(byte => typeof byte === 'number' && Number.isInteger(byte) && byte >= 0 && byte <= 255))(${value})`,
      dynamic: () => 'true',
      absence: type =>
        native
          ? `${value} === ${type.value}`
          : `((value: unknown) => { try { return TR.NativeValues.unbox(value) === ${type.value} } catch { return false } })(${value})`,
      map: type =>
        native
          ? `((values: unknown) => values !== null && typeof values === 'object' && !Array.isArray(values) && Object.values(values).every(entry => ${
            predicate(type.value, 'entry', native)
          }))(${value})`
          : `((values: unknown) => Array.isArray(values) && Array.from(values).every(entry => entry !== null && typeof entry === 'object' && typeof entry.Key === 'string' && ${
            predicate(type.value, 'entry.Value', native)
          }))(${value})`,
      callback: () => Errors.throwUserInput('Callbacks cannot be discriminated as native union values.'),
    })
  }
  function unionConversion(
    type: Extract<NativeApiType, { kind: 'union' }>,
    value: string,
    direction: 'to' | 'from',
    lifetime?: string,
    path = '[]',
  ): string {
    const convert = direction === 'to' ? toNative : fromNative
    const branches = type.members.map(member =>
      `${predicate(member, 'value', direction === 'from')} ? ${
        direction === 'to'
          ? toNative(member, `(value as ${typescriptType(member, false)})`, lifetime, path)
          : convert(member, `(value as ${typescriptType(member, true)})`, lifetime)
      } : `
    )
    return `((value: ${typescriptType(type, direction === 'from')}) => ${
      branches.join('')
    }invalidNativeUnion())(${value})`
  }
  function declarations(): string[] {
    const lines: string[] = []
    if (callbacks) {
      lines.push(
        'type NativeCallbackContext = Record<string, Pick<ReturnType<typeof TR.NativeAsyncCallbacks>, "active" | "invoke">>',
        'function nativeCallback<Raw extends unknown[], Args extends unknown[]>(context: NativeCallbackContext, path: string[], action: { invoke(...args: Args): void | Promise<void> }, convert: (...raw: Raw) => Args): (...raw: Raw) => void {',
        '  const lifetime = context[JSON.stringify(path)]',
        '  if (!lifetime) throw new TypeError("Expected verified native callback ownership.")',
        '  return (...raw) => { if (lifetime.active) lifetime.invoke(action, ...convert(...raw)) }',
        '}',
        '',
      )
    }
    // Shared checked fallbacks are emitted only when reachable from catalog conversions.
    if (union) {
      lines.push(
        'function invalidNativeUnion(): never { throw new TypeError("Expected a declared native union member.") }',
        '',
      )
    }
    if (absence) {
      lines.push(
        'function checkedAbsence<T extends null | undefined>(value: unknown, expected: T): T {',
        '  if (value !== expected) throw new TypeError("Expected the declared native absence value.")',
        '  return expected',
        '}',
        '',
      )
    }
    for (const map of maps.values()) {
      const type = typescriptType(map)
      const nativeType = typescriptType(map, true)
      if (conversions.to.has(map.name)) {
        lines.push(
          `function to${map.name}(value: ${type}${
            callbacks
              ? ', context: NativeCallbackContext = {}, path: string[] = []'
              : ', context: object = {}, path: string[] = []'
          }): ${nativeType} {`,
          '  void context; void path',
          `  const result: ${nativeType} = Object.create(null)`,
          '  for (const entry of value) {',
          '    if (typeof entry.Key !== "string" || Object.hasOwn(result, entry.Key)) throw new TypeError("Native map keys must be unique text values.")',
          `    result[entry.Key] = ${toNative(map.value, 'entry.Value', 'context', 'path')}`,
          '  }',
          '  return result',
          '}',
          '',
        )
      }
      if (conversions.from.has(map.name)) {
        lines.push(
          `function from${map.name}(value: ${nativeType}): ${type} {`,
          `  return Object.keys(value).map(key => ({ Key: key, Value: ${fromNative(map.value, 'value[key]!')} }))`,
          '}',
          '',
        )
      }
    }
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
        if (native && record.tuple) {
          lines.push(
            `type Native${record.name} = [${record.fields.map(field => typescriptType(field.type, true)).join(', ')}]`,
            '',
          )
          continue
        }
        lines.push(`type ${typescriptType(type, native)} = {`)
        for (const field of record.fields) {
          const fieldType = !native && record.disposal && field.type.kind === 'callback'
            ? '{ invoke(): void | Promise<void> }'
            : typescriptType(field.type, native, !native)
          lines.push(
            `  ${JSON.stringify(native ? field.name : taoName(field.name))}${
              field.optional || !native && field.type.kind === 'nullable' ? '?' : ''
            }: ${fieldType}${field.optional && !native ? ' | null' : ''}`,
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
          `function ${native ? 'to' : 'from'}${record.name}(value: ${typescriptType(type, !native)}${
            native
              ? callbacks
                ? ', context: NativeCallbackContext = {}, path: string[] = []'
                : ', context: object = {}, path: string[] = []'
              : ''
          }): ${typescriptType(type, native)} {`,
          ...(native ? ['  void context; void path'] : []),
          ...(record.tuple
            ? [
              `  if (!(${
                predicate(type, 'value', !native)
              })) throw new TypeError("Expected the declared fixed native tuple shape.")`,
            ]
            : []),
          `  return ${native && record.tuple ? '[' : '{'}`,
        )
        for (const [index, field] of record.fields.entries()) {
          const key = JSON.stringify(native ? field.name : taoName(field.name))
          const fieldValue = `value[${
            JSON.stringify(native ? taoName(field.name) : record.tuple ? index : field.name)
          }]`
          const checkedValue = native && field.type.kind === 'nullable'
            ? `(${fieldValue} ?? null)`
            : field.optional
            ? `(${fieldValue} as ${typescriptType(field.type, !native)})`
            : fieldValue
          const converted = native
            ? toNative(field.type, checkedValue, 'context', `[...path, ${JSON.stringify(field.name)}]`)
            : convert(field.type, checkedValue)
          const entry = native && record.tuple ? converted : `${key}: ${converted}`
          const present = native
            ? `${fieldValue} != null`
            : `Object.hasOwn(value, ${JSON.stringify(field.name)}) && (${fieldValue} !== undefined || ${
              permitsUndefined(field.type)
            })`
          lines.push(field.optional ? `    ...(${present} ? { ${entry} } : {}),` : `    ${entry},`)
        }
        lines.push(`  ${native && record.tuple ? ']' : '}'}`, '}', '')
      }
    }
    return lines
  }
  function permitsUndefined(type: NativeApiType): boolean {
    return Switch.kind(type, {
      primitive: () => false,
      enum: () => false,
      record: () => false,
      reference: () => false,
      listener: () => false,
      callback: () => false,
      list: () => false,
      bytes: () => false,
      map: () => false,
      dynamic: () => true,
      absence: type => type.value === 'undefined',
      nullable: type => type.absence === 'undefined',
      union: type => type.members.some(permitsUndefined),
    })
  }
  function taoDeclarations(): string[] {
    return [...maps.values()].flatMap(
      map => [
        `public type ${map.name}Entry is {\n   Key text,\n   Value ${taoType(map.value, `${map.name}EntryValue`)}\n}`,
        '',
      ],
    ).concat(taoTypes.declarations())
  }
  function projections(implementationImport: string): { tao: string[]; sidecar: string[] } {
    const tao: string[] = []
    const sidecar: string[] = []
    for (const alias of taoTypes.unions()) {
      const members = new Map(
        alias.type.members.filter(member => member.kind === 'record').map(member => [member.name, member]),
      )
      for (const member of members.values()) {
        const name = `${alias.name}As${member.name}`
        const test = `${alias.name}Is${member.name}`
        tao.push(
          `public action ${test}(Value ${alias.name}) returns boolean from ${implementationImport}`,
          '',
          `public action ${name}(Value ${alias.name}) returns ${member.name} from ${implementationImport}`,
          '',
        )
        sidecar.push(
          `export function ${test}(value: ${typescriptType(alias.type)}): boolean {`,
          '  try {',
          `    return ${predicate(member, 'value', false)}`,
          '  } catch { return false }',
          '}',
          '',
          `export function ${name}(value: ${typescriptType(alias.type)}): ${typescriptType(member)} {`,
          `  TR.NativeAssert.input(${test}(value), ${
            JSON.stringify(`Expected ${member.name} member of ${alias.name}.`)
          })`,
          `  return value as ${typescriptType(member)}`,
          '}',
          '',
        )
      }
    }
    return { tao, sidecar }
  }
  return {
    declarations,
    taoDeclarations,
    needsDynamic: () => dynamic,
    needsCallbacks: () => callbacks,
    taoType,
    typescriptType,
    toNative,
    fromNative,
    projections,
    enumCaseName,
    enumImports: () =>
      catalog.enums.filter(enumeration =>
        conversions.to.has(enumeration.name) || conversions.from.has(enumeration.name)
        || predicateEnums.has(enumeration.name)
      ),
  }
}
