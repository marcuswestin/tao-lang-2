import { Assert, Switch } from '@shared'
import type { NativeApiCatalog, NativeApiType } from './native-api'

/** TypeReference has no nullable postfix or inline union; names preserve compound grouping. */
export function nativeTaoTypeEmitter(catalog: NativeApiCatalog) {
  const maps = new Map<string, Extract<NativeApiType, { kind: 'map' }>>()
  const occupied = new Set([
    ...catalog.enums.map(type => type.name),
    ...(catalog.records ?? []).map(type => type.name),
    ...(catalog.listeners ?? []).flatMap(type => [type.name, `Create${type.name}`, `Release${type.name}`]),
    ...(catalog.references ?? []).flatMap(
      type => [type.name, `Release${type.name}`, ...(type.protocols ?? []).map(parent => `${type.name}As${parent}`)],
    ),
    ...catalog.operations.map(operation => upper(operation.name)),
    'NativeValue',
    'NativeValueKind',
    'NativeValueKeys',
    'NativeValueReadKey',
    'NativeValueLength',
    'NativeValueReadIndex',
    'NativeValueText',
    'NativeValueNumber',
    'NativeValueBoolean',
    'ReleaseNativeValue',
  ])
  const aliases = new Map<
    string,
    { name: string; definition: string; type: Extract<NativeApiType, { kind: 'union' }> }
  >()
  for (const operation of catalog.operations) {
    const owner = `Native operation '${operation.name}' (${operation.provenance?.signature ?? operation.name})`
    for (const parameter of operation.parameters) {
      validate(parameter.type, true, owner, describe(parameter.type), 'parameter', new Set())
    }
    if (operation.result) {
      validate(operation.result, true, owner, describe(operation.result), 'result', new Set())
    }
    if (operation.pending?.result) {
      validate(operation.pending.result, true, owner, describe(operation.pending.result), 'pending result', new Set())
    }
  }
  for (const listener of catalog.listeners ?? []) {
    const callback: NativeApiType = { kind: 'callback', parameters: listener.parameters }
    validate(callback, false, `Native listener '${listener.name}'`, describe(callback), 'listener', new Set())
  }
  for (const record of catalog.records ?? []) {
    validate(
      { kind: 'record', name: record.name },
      true,
      `Native record '${record.name}'`,
      record.name,
      'record',
      new Set(),
    )
  }
  function validate(
    type: NativeApiType,
    slot: boolean,
    owner: string,
    root: string,
    position: string,
    seen: Set<string>,
  ): void {
    Switch.kind(type, {
      primitive: () => {},
      enum: () => {},
      reference: () => {},
      listener: () => {},
      dynamic: () => {},
      bytes: () => {},
      absence: () => {},
      nullable: type => {
        Assert.input(
          slot,
          `${owner} cannot represent type '${root}' in Tao: nullable type '${describe(type)}' occurs in ${position}.`,
        )
        validate(type.value, false, owner, root, 'nullable value', seen)
      },
      list: type => validate(type.element, false, owner, root, 'list element', seen),
      map: type => {
        maps.set(type.name, type)
        occupied.add(`${type.name}Entry`)
        validate(type.value, true, owner, root, 'map entry value', seen)
      },
      union: type => type.members.forEach(member => validate(member, false, owner, root, 'union member', seen)),
      callback: type =>
        type.parameters.forEach(parameter => {
          Assert.input(
            !parameter.optional,
            `${owner} cannot represent type '${root}' in Tao: an optional callback argument needs a TypeReference.`,
          )
          validate(parameter.type, false, owner, root, 'callback argument', seen)
        }),
      record: type => {
        if (seen.has(type.name)) {
          return
        }
        seen.add(type.name)
        const record = catalog.records?.find(record => record.name === type.name)
        Assert.defined(record, 'referenced native record exists')
        record.fields.forEach(field =>
          validate(field.type, true, owner, root, `field '${record.name}.${field.name}'`, seen)
        )
      },
    })
  }
  function render(type: NativeApiType, hint: string): string {
    return Switch.kind(type, {
      primitive: type => type.name,
      enum: type => type.name,
      record: type => type.name,
      reference: type => type.name,
      listener: type => type.name,
      dynamic: () => 'NativeValue',
      absence: () => 'NativeValue',
      bytes: () => 'list of number',
      map: type => `list of ${type.name}Entry`,
      nullable: type => `${render(type.value, `${hint}Value`)}?`,
      list: type => `list of ${render(type.element, `${hint}Element`)}`,
      callback: type =>
        `action(${
          type.parameters.map((parameter, index) => render(parameter.type, `${hint}Argument${index + 1}`)).join(', ')
        })`,
      union: type => {
        const key = JSON.stringify(type)
        const known = aliases.get(key)
        if (known) {
          return known.name
        }
        let name = hint
        for (let suffix = 2; occupied.has(name); suffix++) {
          name = `${hint}${suffix}`
        }
        occupied.add(name)
        const members = type.members.map((member, index) => render(member, `${name}Member${index + 1}`))
        aliases.set(key, { name, definition: `public type ${name} is ${members.join(' | ')}`, type })
        return name
      },
    })
  }
  return {
    maps,
    render,
    names: () => [...aliases.values()].map(alias => alias.name),
    unions: () => [...aliases.values()],
    declarations: () => [...aliases.values()].flatMap(alias => [alias.definition, '']),
  }
}

function upper(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function describe(type: NativeApiType): string {
  return Switch.kind(type, {
    primitive: type => type.name === 'text' ? 'string' : type.name,
    enum: type => type.name,
    record: type => type.name,
    reference: type => type.name,
    listener: type => type.name,
    dynamic: () => 'unknown',
    bytes: () => 'Uint8Array',
    absence: type => type.value,
    nullable: type => `${describe(type.value)} | ${type.absence ?? 'null'}`,
    list: type => `Array<${describe(type.element)}>`,
    map: type => `Record<string, ${describe(type.value)}>`,
    union: type => type.members.map(describe).join(' | '),
    callback: type =>
      `(${
        type.parameters.map(parameter =>
          `${parameter.name}${parameter.optional ? '?' : ''}: ${describe(parameter.type)}`
        ).join(', ')
      }) => void`,
  })
}
