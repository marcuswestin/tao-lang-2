import { Assert, Errors } from '@shared'
import type * as TS from 'typescript'
import type { NativeApiEnum, NativeApiParameter, NativeApiRecord, NativeApiType } from './native-api'

export type NativeResourceContract = { packageName: string; typeName: string; disposal: string; declaration?: string }
export type NativeTypeSubstitutions = ReadonlyMap<TS.Type, TS.Type>

/** Resolves concrete value shapes while delegating live object identity to the catalog. */
export function nativeTypeReader(
  ts: typeof TS,
  checker: TS.TypeChecker,
  resources: readonly NativeResourceContract[],
  enums: { declaration: NativeApiEnum; types: readonly TS.Type[] }[],
  reference?: (type: TS.Type, hint: string, substitutions: NativeTypeSubstitutions) => NativeApiType,
  unresolved?: (type: TS.Type, node?: TS.Node) => never,
  listener?: (
    type: TS.Type,
    node: TS.Node | undefined,
    substitutions: NativeTypeSubstitutions,
  ) => NativeApiType | undefined,
) {
  const records: NativeApiRecord[] = []
  const byteViews: TS.Type[] = []
  const recordNames = new Map<string, string>()
  const pending = new Set<string>()
  const ids = new Map<TS.Type, number>()
  const symbolIds = new Map<TS.Symbol, number>()
  function identity(type: TS.Type): number {
    if (!ids.has(type)) {
      ids.set(type, ids.size)
    }
    return ids.get(type)!
  }
  function key(type: TS.Type, substitutions: NativeTypeSubstitutions): string {
    const symbol = type.aliasSymbol ?? type.getSymbol()
    if (symbol && !symbol.name.startsWith('__')) {
      if (!symbolIds.has(symbol)) {
        symbolIds.set(symbol, symbolIds.size)
      }
      const arguments_ = type.aliasTypeArguments ?? checker.getTypeArguments(type as TS.TypeReference)
      return `symbol${symbolIds.get(symbol)}:${
        arguments_.map(argument => identity(concrete(argument, substitutions))).join(',')
      }`
    }
    return `${identity(type)}:${[...substitutions].map(([a, b]) => `${identity(a)}=${identity(b)}`).sort().join(',')}`
  }
  function concrete(type: TS.Type, substitutions: NativeTypeSubstitutions): TS.Type {
    const replacement = substitutions.get(type)
    if (replacement) {
      return concrete(replacement, substitutions)
    }
    if (type.flags & ts.TypeFlags.IndexedAccess) {
      const indexed = type as TS.IndexedAccessType
      const object = concrete(indexed.objectType, substitutions)
      const index = concrete(indexed.indexType, substitutions)
      if (index.isStringLiteral() || index.isNumberLiteral()) {
        const property = checker.getPropertyOfType(object, String(index.value))
        const declaration = property?.valueDeclaration ?? property?.declarations?.[0]
        Assert.input(
          property !== undefined && declaration !== undefined,
          `Cannot resolve native indexed type '${checker.typeToString(type)}'.`,
        )
        return concrete(checker.getTypeOfSymbolAtLocation(property, declaration), substitutions)
      }
    }
    return type
  }
  function read(
    input: TS.Type,
    hint: string,
    optional = false,
    substitutions: NativeTypeSubstitutions = new Map(),
    node?: TS.Node,
  ): NativeApiType {
    const type = concrete(input, substitutions)
    // Unresolved declarations have TypeScript's error intrinsic, despite carrying the Any flag.
    if (type.flags & ts.TypeFlags.Any && (type as TS.Type & { intrinsicName?: string }).intrinsicName === 'error') {
      return unresolved
        ? unresolved(type, node)
        : Errors.throwUserInput(`Unresolved TypeScript type '${checker.typeToString(type)}'.`)
    }
    const listening = listener?.(type, node, substitutions)
    if (listening) {
      return listening
    }
    const present = type.isUnion() ? type.types.filter(member => !(member.flags & ts.TypeFlags.Undefined)) : [type]
    const undefinedAbsent = type.isUnion() && present.length !== type.types.length
    if (undefinedAbsent && !optional) {
      const values = present.filter(member => !(member.flags & ts.TypeFlags.Null))
      if (values.length === 1 && values.length === present.length) {
        return { kind: 'nullable', value: read(values[0]!, hint, false, substitutions, node), absence: 'undefined' }
      }
    }
    if (present.length === 1 && present[0] !== type && (optional || !undefinedAbsent)) {
      return read(present[0]!, hint, false, substitutions, node)
    }
    const enumeration = enums.find(item => present.length > 0 && present.every(member => item.types.includes(member)))
    if (enumeration && present.length === enumeration.types.length) {
      return { kind: 'enum', name: enumeration.declaration.name }
    }
    Assert.input(
      !(type.flags & ts.TypeFlags.EnumLiteral) || enumeration !== undefined,
      'Enum values require a public runtime enum export.',
    )
    if (present.some(member => member.flags & ts.TypeFlags.Null)) {
      const values = present.filter(member => !(member.flags & ts.TypeFlags.Null))
      if (values.length === 1 && !undefinedAbsent) {
        return { kind: 'nullable', value: read(values[0]!, hint, false, substitutions, node) }
      }
    }
    if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) {
      return { kind: 'dynamic' }
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
    if (type.flags & ts.TypeFlags.Null) {
      return { kind: 'absence', value: 'null' }
    }
    if (type.flags & ts.TypeFlags.Undefined) {
      return { kind: 'absence', value: 'undefined' }
    }
    if (
      present.length > 0 && !undefinedAbsent
      && present.every(member =>
        member.isStringLiteral() || member.isNumberLiteral() || member.flags & ts.TypeFlags.BooleanLiteral
      )
    ) {
      const name = type.aliasSymbol?.name ?? hint
      const members = present.map(member => {
        const value = member.isStringLiteral() || member.isNumberLiteral()
          ? member.value
          : checker.typeToString(member) === 'true'
        return { name: literalName(String(value)), value }
      })
      const existing = enums.find(item => item.declaration.name === name)
      Assert.input(
        existing === undefined || JSON.stringify(existing.declaration.members) === JSON.stringify(members),
        `Native literal type name '${name}' is ambiguous.`,
      )
      Assert.input(
        new Set(members.map(member => member.name)).size === members.length,
        `Literal cases collide in '${name}'.`,
      )
      if (!existing) {
        enums.push({ declaration: { name, members, literal: true }, types: present })
      }
      return { kind: 'enum', name }
    }
    const symbol = type.aliasSymbol ?? type.getSymbol()
    if (
      symbol?.name === 'Uint8Array'
      && symbol.declarations?.some(declaration => declaration.getSourceFile().hasNoDefaultLib)
    ) {
      if (!byteViews.includes(type)) {
        byteViews.push(type)
      }
      return { kind: 'bytes' }
    }
    if (checker.isArrayType(type) || type.getSymbol()?.name === 'ReadonlyArray') {
      const element = checker.getTypeArguments(type as TS.TypeReference)[0]
      Assert.defined(element, 'array has an element type')
      return { kind: 'list', element: read(element, `${hint}Item`, false, substitutions, node) }
    }
    if (type.isUnion()) {
      const remaining = new Set(optional ? present : type.types)
      const members: NativeApiType[] = []
      // Only complete native enums can be grouped: a partial enum must retain its narrower cases.
      for (const enumeration of enums.filter(item => !item.declaration.literal)) {
        if (enumeration.types.length > 0 && enumeration.types.every(member => remaining.has(member))) {
          members.push({ kind: 'enum', name: enumeration.declaration.name })
          enumeration.types.forEach(member => remaining.delete(member))
        }
      }
      members.push(...[...remaining].map(member =>
        read(
          member,
          `${hint}${upper(checker.typeToString(member).replace(/[^A-Za-z0-9]/g, ''))}`,
          false,
          substitutions,
          node,
        )
      ))
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
      return { kind: 'callback', parameters: parameters(signature, hint, substitutions) }
    }
    if (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) {
      if (checker.isTupleType(type)) {
        const tuple = type as TS.TypeReference
        const elements = checker.getTypeArguments(tuple)
        Assert.input(
          (tuple.target as TS.TupleType).elementFlags.every(flag => flag === ts.ElementFlags.Required),
          `Native tuple '${checker.typeToString(type)}' requires a fixed required element for every position.`,
        )
        const tupleKey = key(type, substitutions)
        const known = recordNames.get(tupleKey)
        if (known) {
          return { kind: 'record', name: known }
        }
        Assert.input(!records.some(record => record.name === hint), `Native tuple record name '${hint}' is ambiguous.`)
        const record: NativeApiRecord = {
          name: hint,
          tuple: true,
          fields: elements.map((element, index) => ({
            name: `item${index}`,
            optional: false,
            type: read(element, `${hint}Item${index}`, false, substitutions, node),
          })),
        }
        records.push(record)
        recordNames.set(tupleKey, hint)
        return { kind: 'record', name: hint }
      }
      const resource = resources.find(contract =>
        symbol?.name === contract.typeName
        && symbol.declarations?.some(declaration =>
          declaration.getSourceFile().fileName.replaceAll('\\', '/').includes(`/node_modules/${contract.packageName}/`)
          && (contract.declaration === undefined
            || declaration.getSourceFile().fileName.replaceAll('\\', '/').endsWith(`/${contract.declaration}`))
        )
      )
      const properties = checker.getPropertiesOfType(type)
      const live = !resource && (symbol?.declarations?.some(ts.isClassDeclaration) || properties.some(property => {
        const declaration = property.valueDeclaration ?? property.declarations?.[0]
        return declaration !== undefined
          && (ts.isMethodSignature(declaration) || ts.isMethodDeclaration(declaration)
            || ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration))
      }))
      if (live && reference) {
        return reference(type, hint, substitutions)
      }
      const indexes = checker.getIndexInfosOfType(type)
      if (indexes.length > 0) {
        Assert.input(
          indexes.length === 1 && !!(indexes[0]!.keyType.flags & ts.TypeFlags.String) && properties.length === 0,
          'Native maps require only a string index signature.',
        )
        return { kind: 'map', name: hint, value: read(indexes[0]!.type, `${hint}Value`, false, substitutions, node) }
      }
      const typeKey = key(type, substitutions)
      const known = recordNames.get(typeKey)
      Assert.input(!pending.has(typeKey), 'Recursive native records are not supported.')
      if (known) {
        return { kind: 'record', name: known }
      }
      const arguments_ = type.aliasTypeArguments ?? checker.getTypeArguments(type as TS.TypeReference)
      const suffix = arguments_.map(argument =>
        upper(checker.typeToString(concrete(argument, substitutions)).replace(/[^A-Za-z0-9]/g, ''))
      ).join('')
      const name = (symbol && !symbol.name.startsWith('__') ? symbol.name : hint) + suffix
      Assert.input(!records.some(record => record.name === name), `Native record type name '${name}' is ambiguous.`)
      Assert.input(properties.length > 0, 'Empty native object types are not supported.')
      const record: NativeApiRecord = { name, fields: [] }
      records.push(record)
      recordNames.set(typeKey, name)
      pending.add(typeKey)
      try {
        record.fields = properties.map(property => {
          const declaration = property.valueDeclaration ?? property.declarations?.[0]
          Assert.defined(declaration, 'native record field has a declaration')
          const fieldType = checker.getTypeOfSymbolAtLocation(property, declaration)
          const fieldOptional = !!(property.flags & ts.SymbolFlags.Optional)
          return {
            name: property.name,
            optional: fieldOptional,
            type: read(fieldType, `${name}${upper(property.name)}`, fieldOptional, substitutions, declaration),
          }
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
        pending.delete(typeKey)
      }
      return { kind: 'record', name }
    }
    return Errors.throwUserInput(`Unsupported native API type '${checker.typeToString(type)}'.`)
  }
  function parameters(
    signature: TS.Signature,
    hint: string,
    substitutions: NativeTypeSubstitutions = new Map(),
  ): NativeApiParameter[] {
    const names = new Set(
      signature.parameters.filter(parameter =>
        parameter.valueDeclaration && ts.isParameter(parameter.valueDeclaration)
        && ts.isIdentifier(parameter.valueDeclaration.name)
      ).map(parameter => parameter.name),
    )
    return signature.parameters.map((parameter, index) => {
      const declaration = parameter.valueDeclaration
      Assert.input(declaration !== undefined && ts.isParameter(declaration), 'A parameter declaration is required.')
      const optional = declaration.questionToken !== undefined || declaration.initializer !== undefined
      let name = parameter.name
      if (!ts.isIdentifier(declaration.name)) {
        name = `argument${index + 1}`
        while (names.has(name)) {
          name += 'Value'
        }
        names.add(name)
      }
      return {
        name,
        type: read(
          checker.getTypeOfSymbolAtLocation(parameter, declaration),
          `${hint}${upper(name)}`,
          optional,
          substitutions,
          declaration,
        ),
        optional,
        ...(declaration.dotDotDotToken ? { rest: true as const } : {}),
      }
    })
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
  return { read, parameters, records, checkpoint, concrete, byteViews }
}

function upper(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}
function literalName(value: string): string {
  const name = value.split(/[^A-Za-z0-9_]+/).filter(Boolean).map(upper).join('')
  Assert.input(name.length > 0, `Literal '${value}' cannot be named as a Tao case.`)
  return /^[A-Z]/.test(name) ? name : `Value${name}`
}
