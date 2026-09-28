import { Assert, Errors } from '@shared'
import type * as TS from 'typescript'
import type { NativeApiEnum, NativeApiParameter, NativeApiRecord, NativeApiType } from './native-api'

export type NativeResourceContract = { packageName: string; typeName: string; disposal: string }

/** Resolves the structural value types shared by every declaration-reader adapter. */
export function nativeTypeReader(
  ts: typeof TS,
  checker: TS.TypeChecker,
  resources: readonly NativeResourceContract[],
  enums: { declaration: NativeApiEnum; types: readonly TS.Type[] }[],
) {
  const records: NativeApiRecord[] = []
  const recordNames = new Map<TS.Type, string>()
  const pending = new Set<TS.Type>()

  function read(type: TS.Type, hint: string, optional = false): NativeApiType {
    assertAbsence(type, optional)
    const present = type.isUnion() ? type.types.filter(member => !(member.flags & ts.TypeFlags.Undefined)) : [type]
    const enumeration = enums.find(item => present.length > 0 && present.every(member => item.types.includes(member)))
    if (enumeration) {
      Assert.input(present.length === enumeration.types.length, 'Narrowed enum subsets require an explicit mapping.')
      return { kind: 'enum', name: enumeration.declaration.name }
    }
    Assert.input(!(type.flags & ts.TypeFlags.EnumLiteral), 'Enum values require a public runtime enum export.')
    if (present.some(member => member.flags & ts.TypeFlags.Null)) {
      const values = present.filter(member => !(member.flags & ts.TypeFlags.Null))
      Assert.input(values.length === 1, 'Nullable unions require one present type.')
      return { kind: 'nullable', value: read(values[0]!, hint) }
    }
    if (present.length === 1 && present[0] !== type) {
      return read(present[0]!, hint)
    }
    if (type.flags & ts.TypeFlags.String) {
      return { kind: 'primitive', name: 'text' }
    }
    if (type.flags & ts.TypeFlags.Number) {
      return { kind: 'primitive', name: 'number' }
    }
    if (
      type.flags & ts.TypeFlags.Boolean
      || present.length === 2 && present.every(t => t.flags & ts.TypeFlags.BooleanLiteral)
    ) {
      return { kind: 'primitive', name: 'boolean' }
    }
    if (present.length > 0 && present.every(member => member.isStringLiteral())) {
      const name = type.aliasSymbol?.name ?? hint
      const members = present.map(member => ({
        name: literalName((member as TS.StringLiteralType).value),
        value: (member as TS.StringLiteralType).value,
      }))
      const existing = enums.find(item => item.declaration.name === name)
      Assert.input(existing === undefined, `Native literal type name '${name}' is ambiguous.`)
      Assert.input(
        new Set(members.map(member => member.name)).size === members.length,
        `Literal cases collide in '${name}'.`,
      )
      enums.push({ declaration: { name, members, literal: true }, types: present })
      return { kind: 'enum', name }
    }
    if (checker.isArrayType(type)) {
      const element = checker.getTypeArguments(type as TS.TypeReference)[0]
      Assert.defined(element, 'array has an element type')
      const item = read(element, `${hint}Item`)
      Assert.input(item.kind !== 'union', 'Arrays of unions require a named element type.')
      return { kind: 'list', element: item }
    }
    if (type.isUnion() && present.length > 0) {
      const members = present.map(member => read(member, hint))
      Assert.input(
        members.every(member =>
          member.kind === 'primitive' || member.kind === 'list' && member.element.kind === 'primitive'
        ),
        'Only primitive and primitive-list unions are supported.',
      )
      return members.length === 1 ? members[0]! : { kind: 'union', members }
    }
    const signatures = checker.getSignaturesOfType(type, ts.SignatureKind.Call)
    if (signatures.length > 0) {
      Assert.input(signatures.length === 1, 'Overloaded callbacks are not supported.')
      const signature = signatures[0]!
      Assert.input(
        !signature.typeParameters?.length && !!(checker.getReturnTypeOfSignature(signature).flags & ts.TypeFlags.Void),
        'Callbacks must be non-generic and return void.',
      )
      const args = parameters(signature, hint)
      Assert.input(
        args.every(parameter => !parameter.optional),
        'Optional callback parameters require an explicit absence mapping.',
      )
      return { kind: 'callback', parameters: args }
    }
    if (type.flags & ts.TypeFlags.Object) {
      Assert.input(!pending.has(type), 'Recursive native records are not supported.')
      const known = recordNames.get(type)
      if (known) {
        return { kind: 'record', name: known }
      }
      Assert.input(
        !type.aliasTypeArguments?.length && !checker.getTypeArguments(type as TS.TypeReference).length,
        'Generic native records are not supported.',
      )
      Assert.input(checker.getIndexInfosOfType(type).length === 0, 'Indexed native records are not supported.')
      const symbol = type.aliasSymbol ?? type.getSymbol()
      const name = symbol && !symbol.name.startsWith('__') ? symbol.name : hint
      Assert.input(!records.some(record => record.name === name), `Native record type name '${name}' is ambiguous.`)
      const properties = checker.getPropertiesOfType(type)
      Assert.input(properties.length > 0, 'Empty native object types are not supported.')
      const resource = resources.find(contract =>
        symbol?.name === contract.typeName
        && symbol.declarations?.some(declaration =>
          declaration.getSourceFile().fileName.replaceAll('\\', '/').includes(`/node_modules/${contract.packageName}/`)
        )
      )
      const record: NativeApiRecord = { name, fields: [] }
      records.push(record)
      recordNames.set(type, name)
      pending.add(type)
      try {
        record.fields = properties.map(property => {
          const declaration = property.valueDeclaration ?? property.declarations?.[0]
          Assert.defined(declaration, 'native record field has a declaration')
          const fieldType = checker.getTypeOfSymbolAtLocation(property, declaration)
          const optional = !!(property.flags & ts.SymbolFlags.Optional)
          assertAbsence(fieldType, optional)
          const reflected = read(fieldType, `${name}${upper(property.name)}`, optional)
          Assert.input(
            reflected.kind !== 'callback' || resource,
            'Returned methods need a declared native resource contract.',
          )
          return { name: property.name, optional, type: reflected }
        })
        if (resource) {
          Assert.input(
            record.fields.length === 1 && record.fields[0]?.name === resource.disposal && !record.fields[0].optional
              && record.fields[0].type.kind === 'callback' && record.fields[0].type.parameters.length === 0,
            `Native ${resource.typeName} must expose only required ${resource.disposal}(): void.`,
          )
          record.disposal = resource.disposal
        }
      } finally {
        pending.delete(type)
      }
      return { kind: 'record', name }
    }
    return Errors.throwUserInput(`Unsupported native API type '${checker.typeToString(type)}'.`)
  }

  function parameters(signature: TS.Signature, hint: string): NativeApiParameter[] {
    return signature.parameters.map(parameter => {
      const declaration = parameter.valueDeclaration
      Assert.input(declaration !== undefined && ts.isParameter(declaration), 'A parameter declaration is required.')
      Assert.input(declaration.dotDotDotToken === undefined, 'Rest parameters are not supported.')
      const type = checker.getTypeOfSymbolAtLocation(parameter, declaration)
      const optional = declaration.questionToken !== undefined || declaration.initializer !== undefined
      assertAbsence(type, optional)
      return { name: parameter.name, type: read(type, `${hint}${upper(parameter.name)}`, optional), optional }
    })
  }

  function assertAbsence(type: TS.Type, optional: boolean): void {
    Assert.input(
      optional
        || !(type.flags & ts.TypeFlags.Undefined)
          && (!type.isUnion() || !type.types.some(member => member.flags & ts.TypeFlags.Undefined)),
      'Required values accepting undefined need an explicit absence mapping.',
    )
  }

  function checkpoint(): () => void {
    const recordCount = records.length
    const enumCount = enums.length
    const names = new Map(recordNames)
    return () => {
      records.splice(recordCount)
      enums.splice(enumCount)
      recordNames.clear()
      for (const [type, name] of names) {
        recordNames.set(type, name)
      }
    }
  }
  return { read, parameters, records, checkpoint }
}

function upper(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function literalName(value: string): string {
  const name = value.split(/[^A-Za-z0-9_]+/).filter(Boolean).map(upper).join('')
  Assert.input(name.length > 0, `Literal '${value}' cannot be named as a Tao case.`)
  return /^[A-Z]/.test(name) ? name : `Value${name}`
}
