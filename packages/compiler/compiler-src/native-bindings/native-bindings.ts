import { Assert, Switch } from '@shared'
import type {
  NativeApiCatalog,
  NativeApiDiagnostic,
  NativeApiImport,
  NativeApiOperation,
  NativeApiSource,
  NativeApiType,
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
  const usedNames = new Set<string>()
  const reserve = (name: string): string => {
    Assert.input(/^[A-Z][A-Za-z0-9_]*$/.test(name), `Native name '${name}' cannot be represented as a Tao declaration.`)
    Assert.input(!usedNames.has(name), `Native declarations collide at Tao name '${name}'.`)
    usedNames.add(name)
    return name
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
      `public type ${enumeration.name} is one of ${enumeration.members.map(member => member.name).join(', ')}`,
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
  for (const enumeration of catalog.enums) {
    sidecar.push(
      `function to${enumeration.name}(value: unknown): import(${JSON.stringify(target.module)}).${enumeration.name} {`,
    )
    for (const member of enumeration.members) {
      sidecar.push(
        `  if (Object.is(value, ${enumeration.name}.${member.name}.evaluate().jsValue)) return native().${enumeration.name}.${member.name}`,
      )
    }
    sidecar.push(`  throw new TypeError(${JSON.stringify(`Expected a declared ${enumeration.name} case.`)})`, '}', '')
  }
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
      let type = taoType(parameter.type)
      if (parameter.type.kind === 'union') {
        type = reserve(`${name}${taoName(parameter.name)}`)
        tao.push(`public type ${type} is ${taoType(parameter.type)}`, '')
      }
      return `${label} ${type}${parameter.optional ? '? default none' : ''}`
    })
    if (operation.platforms.length > 0) {
      tao.push(`// Upstream platform annotation: ${operation.platforms.join(', ')}.`)
    }
    tao.push(`public action ${name}(${parameters.join(', ')}) from ./Bindings.ts`, '')
    sidecar.push(
      `export function ${name}(${
        operation.parameters.map((parameter, index) =>
          `argument${index}: ${typescriptType(parameter.type)}${parameter.optional ? ' | null' : ''}`
        ).join(', ')
      }): ${operation.asynchronous ? 'Promise<void>' : 'void'} {`,
    )
    // A trailing absent Tao argument must remain absent at the upstream call, not a copied docs default.
    for (let arity = 0; arity < operation.parameters.length; arity++) {
      const omitted = operation.parameters.slice(arity)
      if (omitted.every(parameter => parameter.optional)) {
        sidecar.push(
          `  if (${omitted.map((_, index) => `argument${arity + index} === null`).join(' && ')}) return ${
            call(operation, target, arity)
          }`,
        )
      }
    }
    sidecar.push(`  return ${call(operation, target, operation.parameters.length)}`, '}', '')
  }
  return {
    'Bindings.tao': tao.join('\n'),
    'Bindings.ts': sidecar.join('\n'),
    'bindings.json': `${JSON.stringify({ schemaVersion: 1, catalog, target, diagnostics }, null, 2)}\n`,
  }
}

function taoName(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function taoType(type: NativeApiType): string {
  return Switch.kind(type, {
    primitive: type => type.name,
    enum: type => type.name,
    list: type => `list of ${taoType(type.element)}`,
    union: type => type.members.map(taoType).join(' | '),
  })
}

function typescriptType(type: NativeApiType): string {
  return Switch.kind(type, {
    primitive: type => type.name === 'text' ? 'string' : type.name,
    enum: () => 'unknown',
    list: type => `Array<${typescriptType(type.element)}>`,
    union: type => type.members.map(typescriptType).join(' | '),
  })
}

function convert(type: NativeApiType, value: string): string {
  return Switch.kind(type, {
    enum: type => `to${type.name}(${value})`,
    primitive: () => value,
    list: type =>
      type.element.kind === 'primitive' ? value : `${value}.map(value => ${convert(type.element, 'value')})`,
    union: () => value,
  })
}

function call(operation: NativeApiOperation, target: JavaScriptApiTarget, arity: number): string {
  const receiver = ['native()', ...target.receiver.map(member => `[${JSON.stringify(member)}]`)].join('')
  const args = operation.parameters.slice(0, arity).map((parameter, index) => {
    const argument = `argument${index}`
    const value = convert(parameter.type, argument)
    return parameter.optional ? `${argument} === null ? undefined : ${value}` : value
  })
  return `${receiver}[${JSON.stringify(operation.name)}](${args.join(', ')})`
}
