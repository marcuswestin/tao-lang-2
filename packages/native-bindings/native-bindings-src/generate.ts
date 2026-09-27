import { Assert } from '@shared'
import { nativeValueEmitter, taoName } from './emit-values'
import type {
  NativeApiCatalog,
  NativeApiDiagnostic,
  NativeApiImport,
  NativeApiSource,
} from './native-api'

type JavaScriptApiTarget = { module: string; receiver: string[] }

/** NativeBindings imports a source through its adapter and emits the supported JavaScript bindings. */
export const NativeBindings = {
  async generate(request: NativeApiImport & { source: NativeApiSource }): Promise<{
    catalog: NativeApiCatalog
    diagnostics: NativeApiDiagnostic[]
    files: Record<string, string>
  }> {
    const { catalog, diagnostics } = await request.source.read(request)
    const target = { module: request.packageName, receiver: request.exportName ? [request.exportName] : [] }
    return { catalog, diagnostics, files: emit(catalog, target, diagnostics) }
  },
}

function emit(
  catalog: NativeApiCatalog,
  target: JavaScriptApiTarget,
  diagnostics: readonly NativeApiDiagnostic[],
): Record<string, string> {
  const tao: string[] = ['// Generated from public native API declarations. Regenerate instead of editing.', '']
  const sidecar: string[] = ['// Generated from public native API declarations. Regenerate instead of editing.', '']
  const values = nativeValueEmitter(catalog)
  const usedNames = new Set<string>()
  const reserve = (name: string): string => {
    Assert.input(/^[A-Z][A-Za-z0-9_]*$/.test(name), `Native name '${name}' cannot be represented as a Tao declaration.`)
    Assert.input(!usedNames.has(name), `Native declarations collide at Tao name '${name}'.`)
    usedNames.add(name)
    return name
  }
  for (const record of catalog.records ?? []) {
    reserve(record.name)
    const names = new Set<string>()
    const fields = record.fields.map(field => {
      const name = taoName(field.name)
      Assert.input(
        /^[A-Z][A-Za-z0-9_]*$/.test(name) && !names.has(name),
        `Native fields collide or cannot be named in '${record.name}'.`,
      )
      names.add(name)
      return `${name} ${values.taoType(field.type)}${field.optional && field.type.kind !== 'nullable' ? '?' : ''}`
    })
    tao.push(`public type ${record.name} is { ${fields.join(', ')} }`, '')
  }
  if ((catalog.records?.length ?? 0) > 0) {
    sidecar.push(`import TR from '@tao/runtime'`, '')
  }
  for (const enumeration of catalog.enums) {
    reserve(enumeration.name)
    for (const member of enumeration.members) {
      Assert.input(
        /^[A-Z][A-Za-z0-9_]*$/.test(member.name),
        `Enum case '${member.name}' cannot be represented as a Tao case.`,
      )
    }
    tao.push(
      `public type ${enumeration.name} is one of ${
        enumeration.members.map(member => values.enumCaseName(enumeration, member)).join(', ')
      }`,
      '',
    )
  }
  if (catalog.enums.length > 0) {
    sidecar.push(`import { ${catalog.enums.map(type => type.name).join(', ')} } from './Bindings.tao'`, '')
  }
  sidecar.push(
    `const native = (): typeof import(${JSON.stringify(target.module)}) => require(${JSON.stringify(target.module)})`,
    '',
  )
  sidecar.push(...values.declarations())
  for (const operation of catalog.operations) {
    const name = reserve(taoName(operation.name))
    const parameterNames = new Set<string>()
    const parameters = operation.parameters.map(parameter => {
      const label = taoName(parameter.name)
      Assert.input(
        /^[A-Z][A-Za-z0-9_]*$/.test(label) && !parameterNames.has(label),
        `Parameter '${parameter.name}' cannot be represented as a unique Tao label.`,
      )
      parameterNames.add(label)
      let type = values.taoType(parameter.type)
      if (parameter.type.kind === 'union') {
        type = reserve(`${name}${taoName(parameter.name)}`)
        tao.push(`public type ${type} is ${values.taoType(parameter.type)}`, '')
      }
      return `${label} ${type}${
        parameter.optional ? `${parameter.type.kind === 'nullable' ? '' : '?'} default none` : ''
      }`
    })
    if (operation.platforms.length > 0) {
      tao.push(`// Upstream platform annotation: ${operation.platforms.join(', ')}.`)
    }
    tao.push(
      `public action ${name}(${parameters.join(', ')})${
        operation.result ? ` returns ${values.taoType(operation.result)}` : ''
      } from ./Bindings.ts`,
      '',
    )
    const resultType = operation.result ? values.typescriptType(operation.result) : 'void'
    const result = operation.result
    const subscription = result?.kind === 'record'
      && catalog.records?.some(record => record.name === result.name && record.disposal)
    sidecar.push(
      `export ${operation.asynchronous && operation.result ? 'async ' : ''}function ${name}(${
        operation.parameters.map((parameter, index) =>
          `argument${index}: ${values.typescriptType(parameter.type)}${parameter.optional ? ' | null' : ''}`
        ).join(', ')
      }): ${operation.asynchronous ? `Promise<${resultType}>` : resultType} {`,
    )
    const indent = subscription ? '    ' : '  '
    if (subscription) {
      sidecar.push('  const lifetime = TR.NativeSubscription()', '  try {')
    }
    const invoke = (arity: number): string[] => {
      const receiver = ['native()', ...target.receiver.map(member => `[${JSON.stringify(member)}]`)].join('')
      const args = operation.parameters.slice(0, arity).map((parameter, index) => {
        const argument = `argument${index}`
        const value = values.toNative(parameter.type, argument, subscription ? 'lifetime' : undefined)
        return parameter.optional ? `${argument} === null ? undefined : ${value}` : value
      })
      const call = `${receiver}[${JSON.stringify(operation.name)}](${args.join(', ')})`
      return operation.result
        ? [
          `const result = ${operation.asynchronous ? 'await ' : ''}${call}`,
          `return ${values.fromNative(operation.result, 'result', subscription ? 'lifetime' : undefined)}`,
        ]
        : [`return ${call}`]
    }
    // A trailing absent Tao argument must remain absent at the upstream call, not a copied docs default.
    for (let arity = 0; arity < operation.parameters.length; arity++) {
      const omitted = operation.parameters.slice(arity)
      if (omitted.every(parameter => parameter.optional)) {
        const condition = omitted.map((_, index) => `argument${arity + index} === null`).join(' && ')
        if (!operation.result) {
          sidecar.push(`${indent}if (${condition}) ${invoke(arity)[0]}`)
        } else {
          sidecar.push(`${indent}if (${condition}) {`, ...invoke(arity).map(line => `${indent}  ${line}`), `${indent}}`)
        }
      }
    }
    sidecar.push(...invoke(operation.parameters.length).map(line => `${indent}${line}`))
    if (subscription) {
      sidecar.push('  } catch (error) {', '    lifetime.remove()', '    throw error', '  }')
    }
    sidecar.push('}', '')
  }
  return {
    'Bindings.tao': tao.join('\n'),
    'Bindings.ts': sidecar.join('\n'),
    'bindings.json': `${JSON.stringify({ schemaVersion: 1, catalog, target, diagnostics }, null, 2)}\n`,
  }
}
