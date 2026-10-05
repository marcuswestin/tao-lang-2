import { Assert, Switch } from '@shared'
import { emitNativeBridgeTypes } from './emit-bridge-types'
import { emitCapabilities } from './emit-capabilities'
import { emitCommonValues } from './emit-common-values'
import { nativeOriginEmitter } from './emit-origin'
import { emitReferences } from './emit-references'
import { nativeInvocation, nativeNamespaces, nativePath } from './emit-targets'
import { nativeValueEmitter, taoName } from './emit-values'
import type {
  NativeApiArgument,
  NativeApiCatalog,
  NativeApiDiagnostic,
  NativeApiImport,
  NativeApiOriginOptions,
  NativeApiProvenance,
  NativeApiSource,
  NativeApiType,
} from './native-api'

type JavaScriptApiTarget = { module: string; receiver: string[] }

/** NativeBindings imports a source through its adapter and emits the supported JavaScript bindings. */
export const NativeBindings = {
  async generate(
    request: NativeApiImport & NativeApiOriginOptions & {
      source: NativeApiSource
      implementationImport?: string
      taoTypeImport?: string
    },
  ): Promise<{
    catalog: NativeApiCatalog
    diagnostics: NativeApiDiagnostic[]
    files: Record<string, string>
  }> {
    const { catalog, diagnostics, resolvedInputs } = await request.source.read(request)
    const target = { module: request.packageName, receiver: request.exportName ? [request.exportName] : [] }
    const origins = nativeOriginEmitter(resolvedInputs ?? [], {
      ...request,
      taoOriginDirectory: request.taoOriginDirectory ?? request.fromDirectory,
      typescriptOriginDirectory: request.typescriptOriginDirectory ?? request.fromDirectory,
    })
    return { catalog, diagnostics, files: emit(catalog, target, diagnostics, request, origins) }
  },
}

function emit(
  catalog: NativeApiCatalog,
  target: JavaScriptApiTarget,
  diagnostics: readonly NativeApiDiagnostic[],
  locations: { implementationImport?: string; taoTypeImport?: string },
  origins: ReturnType<typeof nativeOriginEmitter>,
): Record<string, string> {
  const implementationImport = locations.implementationImport ?? './Bindings.ts'
  const taoTypeImport = locations.taoTypeImport ?? './Bindings.tao'
  const tao: string[] = ['// Generated from public native API declarations. Regenerate instead of editing.']
  const sidecar: string[] = ['// Generated from public native API declarations. Regenerate instead of editing.', '']
  const values = nativeValueEmitter(catalog)
  const namespaces = nativeNamespaces(catalog, values.enumImports().some(enumeration => !enumeration.literal))
  for (const operation of catalog.operations) {
    const result = operation.result
    const subscription = result?.kind === 'record'
      && catalog.records?.some(record => record.name === result.name && record.disposal)
    const origin = operation.provenance?.signature ?? operation.name
    const ownershipPaths = new Set<string>()
    for (const owner of operation.callbackOwnership ?? []) {
      const key = JSON.stringify([owner.parameter, ...owner.fields])
      Assert.input(
        !ownershipPaths.has(key),
        `Native operation '${operation.name}' repeats callback ownership '${key}'.`,
      )
      ownershipPaths.add(key)
      let ownedType: NativeApiType | undefined = operation.parameters[owner.parameter]?.type
      for (const field of owner.fields) {
        while (ownedType?.kind === 'nullable') {
          ownedType = ownedType.value
        }
        Assert.input(
          ownedType?.kind === 'record',
          `Native operation '${operation.name}' has no callback field '${key}'.`,
        )
        const name = ownedType.name
        const definition = catalog.records?.find(record => record.name === name)
        ownedType = definition?.fields.find(parameter => parameter.name === field)?.type
      }
      while (ownedType?.kind === 'nullable') {
        ownedType = ownedType.value
      }
      Assert.input(
        ownedType?.kind === 'callback',
        `Native operation '${operation.name}' has no callback field '${key}'.`,
      )
      Switch.kind(owner.lifetime, {
        call: () => {},
        subscription: () =>
          Assert.input(subscription, `Native operation '${operation.name}' requires a disposable subscription result.`),
        promise: () =>
          Assert.input(
            operation.pending,
            `Native operation '${operation.name}' requires a pending result for promise callbacks.`,
          ),
        receiver: lifetime =>
          Assert.input(
            operation.parameters[lifetime.parameter]?.type.kind === 'reference',
            `Native operation '${operation.name}' requires a reference receiver for callbacks.`,
          ),
        resource: () =>
          Assert.input(
            result?.kind === 'reference',
            `Native operation '${operation.name}' requires a reference result for callbacks.`,
          ),
      })
    }
    function checkData(
      type: NativeApiType,
      parameter: number | undefined,
      fields: string[],
      resourceAllowed = false,
      seen = new Set<string>(),
    ): void {
      Switch.kind(type, {
        primitive: () => {},
        enum: () => {},
        reference: () => {},
        listener: () => {},
        dynamic: () => {},
        bytes: () => {},
        absence: () => {},
        callback: type => {
          const owned = operation.callbackOwnership?.find(owner =>
            owner.parameter === parameter && JSON.stringify(owner.fields) === JSON.stringify(fields)
          )
          Assert.input(
            parameter !== undefined
              && (!!owned || fields.length === 0 && (subscription || operation.callbackLifetime === 'call')),
            `Native operation '${operation.name}' (${origin}) needs an explicit callback lifetime.`,
          )
          type.parameters.forEach(argument => checkData(argument.type, undefined, []))
        },
        nullable: type => checkData(type.value, parameter, fields, false, seen),
        list: type => checkData(type.element, parameter, fields, false, seen),
        map: type => checkData(type.value, parameter, fields, false, seen),
        union: type => type.members.forEach(member => checkData(member, parameter, fields, false, new Set(seen))),
        record: type => {
          if (seen.has(type.name)) {
            return
          }
          seen.add(type.name)
          const record = catalog.records?.find(record => record.name === type.name)
          Assert.defined(record, 'referenced native record exists')
          if (record.disposal) {
            Assert.input(
              resourceAllowed,
              `Native operation '${operation.name}' (${origin}) contains an unsupported nested subscription.`,
            )
          } else {
            record.fields.forEach(field =>
              checkData(field.type, parameter, [...fields, field.name], false, new Set(seen))
            )
          }
        },
      })
    }
    operation.parameters.forEach((parameter, index) => checkData(parameter.type, index, [], true))
    if (operation.result) {
      checkData(operation.result, undefined, [], true)
    }
    if (operation.pending?.result) {
      checkData(operation.pending.result, undefined, [], true)
    }
    Assert.input(
      !subscription || operation.callbackLifetime !== 'call',
      `Native operation '${operation.name}' cannot treat a returned subscription as call-scoped callbacks.`,
    )
  }
  const usedNames = new Set<string>()
  const reserve = (name: string): string => {
    Assert.input(/^[A-Z][A-Za-z0-9_]*$/.test(name), `Native name '${name}' cannot be represented as a Tao declaration.`)
    Assert.input(!usedNames.has(name), `Native declarations collide at Tao name '${name}'.`)
    usedNames.add(name)
    return name
  }
  for (const record of catalog.records ?? []) {
    reserve(record.name)
    Assert.input(
      !record.tuple || record.fields.every(field => !field.optional && !field.rest),
      `Native tuple '${record.name}' must have fixed required fields.`,
    )
    const names = new Set<string>()
    const fields = record.fields.map(field => {
      const name = taoName(field.name)
      Assert.input(
        /^[A-Z][A-Za-z0-9_]*$/.test(name) && !names.has(name),
        `Native fields collide or cannot be named in '${record.name}'.`,
      )
      names.add(name)
      return `${name} ${values.taoType(field.type, `${record.name}${name}`)}${
        field.optional && field.type.kind !== 'nullable' ? '?' : ''
      }`
    })
    tao.push(
      `public type ${record.name} is ${fields.length === 0 ? '{ }' : `{\n   ${fields.join(',\n   ')}\n}`}`,
      '',
    )
  }
  const referenceDeclarations = emitReferences(catalog, implementationImport, origins)
  const capabilities = emitCapabilities(catalog, values, implementationImport)
  const projections = values.projections(implementationImport)
  const bridgeTypes = emitNativeBridgeTypes(catalog, values)
  const capabilityOrigins = new Map<string, NativeApiProvenance>()
  for (const listener of catalog.listeners ?? []) {
    for (
      const name of [listener.name, `${listener.name}Listener`, `Create${listener.name}`, `Release${listener.name}`]
    ) {
      capabilityOrigins.set(name, listener.provenance)
    }
  }
  for (const operation of catalog.operations) {
    if (!operation.pending || !operation.provenance) {
      continue
    }
    const name = operation.pending.name
    for (
      const declaration of [
        name,
        `${name}Pending`,
        `${name}Status`,
        `${name}Error`,
        `${name}Result`,
        `Release${name}`,
        `Observe${name}`,
      ]
    ) {
      capabilityOrigins.set(declaration, operation.provenance)
    }
  }
  for (const line of capabilities.tao) {
    const name = line.match(/^public (?:type|action) (\w+)/)?.[1]
    if (name) {
      reserve(name)
    }
  }
  const common = emitCommonValues(values.needsDynamic(), implementationImport)
  for (const reference of catalog.references ?? []) {
    reserve(reference.name)
    reserve(`Release${reference.name}`)
    for (const protocol of reference.protocols ?? []) {
      reserve(`${reference.name}As${protocol}`)
    }
  }
  if (values.needsDynamic()) {
    for (const line of common.tao) {
      const name = line.match(/^public (?:type|action) (\w+)/)?.[1]
      if (name) {
        reserve(name)
      }
    }
  }
  for (const line of values.taoDeclarations()) {
    const name = line.match(/^public type (\w+)/)?.[1]
    if (name) {
      reserve(name)
    }
  }
  for (const line of projections.tao) {
    const name = line.match(/^public action (\w+)/)?.[1]
    if (name) {
      reserve(name)
    }
  }
  tao.push(
    ...referenceDeclarations.tao,
    ...common.tao,
    ...origins.decorate(capabilities.tao, capabilityOrigins, 'tao'),
    ...values.taoDeclarations(),
    ...projections.tao,
  )
  if (
    (catalog.records?.length ?? 0) > 0 || (catalog.references?.length ?? 0) > 0 || values.needsDynamic()
    || values.needsCallbacks() || capabilities.sidecar.length > 0 || namespaces.global
    || catalog.operations.some(operation => operation.callbackEffect)
    || JSON.stringify(catalog).includes('"kind":"bytes"')
  ) {
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
  const enumImports = values.enumImports()
  if (enumImports.length > 0) {
    sidecar.push(
      `import { ${enumImports.map(type => type.name).join(', ')} } from ${JSON.stringify(taoTypeImport)}`,
      '',
    )
  }
  if (namespaces.module) {
    sidecar.push(
      `const native = (): typeof import(${JSON.stringify(target.module)}) => require(${JSON.stringify(target.module)})`,
      '',
    )
  }
  if (namespaces.global) {
    sidecar.push(
      'function nativeGlobals(): typeof globalThis {',
      '  TR.NativeAbortSupport()',
      '  return globalThis',
      '}',
      '',
    )
  }
  sidecar.push(...values.declarations())
  sidecar.push(...projections.sidecar)
  sidecar.push(
    ...referenceDeclarations.sidecar,
    ...common.sidecar,
    ...origins.decorate(capabilities.sidecar, capabilityOrigins, 'sidecar'),
    ...bridgeTypes.sidecar,
  )
  for (const operation of catalog.operations) {
    const name = reserve(taoName(operation.name))
    const parameterNames = new Set<string>()
    const instance = operation.target && ['method', 'get', 'set'].includes(operation.target.kind)
        && 'receiver' in operation.target && operation.target.receiver.kind === 'reference'
      ? operation.target.receiver.name
      : undefined
    const catalogReceiver = instance && operation.parameters[0]?.name === 'receiver'
      && operation.parameters[0].type.kind === 'reference' && operation.parameters[0].type.name === instance
    if (instance && !catalogReceiver) {
      parameterNames.add('Receiver')
    }
    // Tao requires optional parameters last; retain catalog indices for native invocation and ownership.
    const publicParameters = operation.parameters.map((parameter, index) => ({ parameter, index })).sort((
      left,
      right,
    ) => Number(left.parameter.optional) - Number(right.parameter.optional) || left.index - right.index)
    const parameters = publicParameters.map(({ parameter }) => {
      const label = taoName(parameter.name)
      Assert.input(
        /^[A-Z][A-Za-z0-9_]*$/.test(label) && !parameterNames.has(label),
        `Parameter '${parameter.name}' cannot be represented as a unique Tao label.`,
      )
      parameterNames.add(label)
      const type = values.taoType(parameter.type, `${name}${label}`)
      return `${label} ${type}${
        parameter.optional ? `${parameter.type.kind === 'nullable' ? '' : '?'} default none` : ''
      }`
    })
    if (instance && !catalogReceiver) {
      parameters.unshift(`Receiver ${instance}`)
    }
    if (operation.provenance) {
      const origin =
        `// Source: ${operation.provenance.packageName}/${operation.provenance.declaration}:${operation.provenance.line}:${operation.provenance.column}`
      tao.push(origin)
      sidecar.push(origin)
      const physical = origins.comments(operation.provenance)
      tao.push(...physical.tao)
      sidecar.push(...physical.sidecar)
    }
    if (operation.platforms.length > 0) {
      tao.push(`// Upstream platform annotation: ${operation.platforms.join(', ')}.`)
    }
    tao.push(
      `public action ${name}(${parameters.join(', ')})${
        operation.pending
          ? ` returns ${operation.pending.name}`
          : operation.result
          ? ` returns ${values.taoType(operation.result, `${name}Result`)}`
          : ''
      } from ${implementationImport}`,
      '',
    )
    const resultType = operation.pending
      ? `ReturnType<typeof ${operation.pending.name}Pending.start>`
      : operation.result
      ? values.typescriptType(operation.result)
      : 'void'
    const result = operation.result
    const subscription = result?.kind === 'record'
      && catalog.records?.some(record => record.name === result.name && record.disposal)
    const callCallbacks = operation.callbackLifetime === 'call'
    const ownership = operation.callbackOwnership ?? []
    const ownsCallbacks = subscription || callCallbacks || ownership.length > 0
    const asynchronous = operation.asynchronous && !operation.pending
    const awaited = asynchronous && (!!operation.result || callCallbacks || ownership.length > 0)
    sidecar.push(
      `export ${awaited ? 'async ' : ''}function ${name}(${
        [
          ...(instance && !catalogReceiver ? ['receiver: unknown'] : []),
          ...publicParameters.map(({ parameter, index }) =>
            `argument${index}: ${
              parameter.type.kind === 'reference' ? 'unknown' : values.typescriptType(parameter.type)
            }${parameter.optional ? ' | null' : ''}`
          ),
        ].join(', ')
      }): ${asynchronous ? `Promise<${resultType}>` : resultType} {`,
    )
    const indent = ownsCallbacks ? '    ' : '  '
    if (ownsCallbacks) {
      if (subscription || callCallbacks) {
        sidecar.push(`  const lifetime = TR.${callCallbacks ? 'NativeCallCallbacks' : 'NativeSubscription'}()`)
      }
      ownership.forEach((owner, index) => {
        Assert.input(
          owner.parameter >= 0 && owner.parameter < operation.parameters.length,
          `Native callback ownership '${operation.name}' must name a declared parameter.`,
        )
        sidecar.push(`  const callbackScope${index} = TR.NativeAsyncCallbacks()`)
      })
      sidecar.push('  try {')
      ownership.forEach((owner, index) => {
        if (owner.lifetime.kind === 'receiver') {
          const parameter = operation.parameters[owner.lifetime.parameter]
          Assert.input(
            parameter?.type.kind === 'reference',
            `Native callback receiver '${operation.name}' must name a reference parameter.`,
          )
          sidecar.push(
            `    TR.NativeReceiverCallbacks.attach(${
              values.toNative(parameter.type, `argument${owner.lifetime.parameter}`)
            }, callbackScope${index})`,
          )
        }
      })
    }
    const invoke = (arity: number): string[] => {
      const receiver = ['native()', ...target.receiver.map(member => `[${JSON.stringify(member)}]`)].join('')
      const converted = operation.parameters.slice(0, arity).map((parameter, index) => {
        const argument = `argument${index}`
        const entries = ownership.flatMap((owner, scope) =>
          owner.parameter === index ? [`${JSON.stringify(JSON.stringify(owner.fields))}: callbackScope${scope}`] : []
        )
        if (entries.length === 0 && (subscription || callCallbacks) && parameter.type.kind === 'callback') {
          entries.push(`${JSON.stringify('[]')}: lifetime`)
        }
        const context = entries.length ? `{ ${entries.join(', ')} }` : undefined
        const value = values.toNative(parameter.type, argument, context)
        return parameter.optional ? `${argument} === null ? undefined : ${value}` : value
      })
      const args = operation.arguments
        ? operation.arguments.map(argument =>
          Switch.kind<NativeApiArgument, string>(argument, {
            literal: argument => JSON.stringify(argument.value),
            export: argument => nativePath(argument.path),
            parameter: (argument): string => {
              Assert.input(
                argument.index >= 0 && argument.index < operation.parameters.length,
                `Native argument '${operation.name}' must name a declared parameter.`,
              )
              if (argument.index >= arity) {
                return argument.rest ? '...[]' : 'undefined'
              }
              return `${argument.rest ? '...' : ''}${converted[argument.index]}`
            },
          })
        )
        : converted.flatMap((value, index) =>
          catalogReceiver && index === 0 ? [] : [`${operation.parameters[index]!.rest ? '...' : ''}${value}`]
        )
      while (args.at(-1) === 'undefined' || args.at(-1) === '...[]') {
        args.pop()
      }
      let call = nativeInvocation(operation, args, receiver, catalogReceiver ? 'argument0' : 'receiver')
      if (operation.eventBinding) {
        const binding = operation.eventBinding
        const nativeReceiver = converted[binding.receiverParameter]
        Assert.defined(nativeReceiver, 'event binding receiver is present')
        const callback = (index: number): string => {
          const type = operation.parameters[index]?.type
          Assert.defined(type, 'event binding callback is present')
          const nullableAbsence = type.kind === 'union'
            && type.members.some(member => member.kind === 'absence' && member.value === 'null')
          return nullableAbsence
            ? `(${binding.listener}Listener.is(argument${index}) ? argument${index} : checkedAbsence(TR.NativeValues.unbox(argument${index}), null))`
            : `argument${index}`
        }
        call = Switch.kind(binding, {
          register: binding =>
            `${binding.listener}Listener.add(${nativeReceiver}, ${
              binding.eventName.kind === 'literal'
                ? JSON.stringify(binding.eventName.value)
                : `argument${binding.eventName.index}`
            }, ${callback(binding.callbackParameter)}${
              binding.optionsParameter === undefined ? '' : `, ${converted[binding.optionsParameter] ?? 'undefined'}`
            })`,
          remove: binding =>
            `${binding.listener}Listener.remove(${nativeReceiver}, ${
              binding.eventName.kind === 'literal'
                ? JSON.stringify(binding.eventName.value)
                : `argument${binding.eventName.index}`
            }, ${callback(binding.callbackParameter)}${
              binding.optionsParameter === undefined ? '' : `, ${converted[binding.optionsParameter] ?? 'undefined'}`
            })`,
          'property-get': binding =>
            `${binding.listener}Listener.get(${nativeReceiver}, ${
              'member' in operation.target! ? JSON.stringify(operation.target!.member) : 'undefined'
            })`,
          'property-set': binding =>
            `${binding.listener}Listener.set(${nativeReceiver}, ${
              'member' in operation.target! ? JSON.stringify(operation.target!.member) : 'undefined'
            }, argument${binding.callbackParameter})`,
        })
      }
      const before: string[] = []
      if (operation.callbackEffect) {
        const parameter = operation.parameters[operation.callbackEffect.parameter]
        Assert.input(
          parameter?.type.kind === 'reference',
          `Native callback cancellation '${operation.name}' must name a reference parameter.`,
        )
        before.push(
          `TR.NativeReceiverCallbacks.cancel(${
            values.toNative(parameter.type, `argument${operation.callbackEffect.parameter}`)
          })`,
        )
      }
      const finish = ownership.flatMap((owner, index) =>
        owner.lifetime.kind === 'call' ? [`callbackScope${index}.finishCall()`] : []
      )
      const subscriptionScopes = ownership.flatMap((owner, index) =>
        owner.lifetime.kind === 'subscription' ? [`callbackScope${index}`] : []
      )
      const resultLifetime = subscriptionScopes.length
        ? `{ ...lifetime, attach(remove: () => void) { lifetime.attach(() => { ${
          subscriptionScopes.map(scope => `${scope}.cancel()`).join('; ')
        }; remove() }) } }`
        : 'lifetime'
      const attach = ownership.flatMap((owner, index) =>
        owner.lifetime.kind === 'resource' ? [`TR.NativeReceiverCallbacks.attach(result, callbackScope${index})`] : []
      )
      if (operation.pending) {
        const scopes = ownership.flatMap((owner, index) =>
          owner.lifetime.kind === 'promise' ? [`callbackScope${index}`] : []
        )
        const progress = scopes.length
          ? `, { finishCall() { ${scopes.map(scope => `${scope}.finishCall()`).join('; ')} }, cancel() { ${
            scopes.map(scope => `${scope}.cancel()`).join('; ')
          } } }`
          : ''
        return [...before, `return ${operation.pending.name}Pending.start(() => ${call}${progress})`]
      }
      if (operation.eventBinding?.kind === 'property-get') {
        return [...before, `return ${call}`]
      }
      return operation.result
        ? [
          ...before,
          `const result = ${awaited ? 'await ' : ''}${call}`,
          ...(callCallbacks ? ['lifetime.finishCall()'] : []),
          ...finish,
          ...(attach.length > 0
            ? [
              `const convertedResult = ${
                values.fromNative(operation.result, 'result', subscription ? resultLifetime : undefined)
              }`,
            ]
            : []),
          ...attach,
          attach.length > 0
            ? 'return convertedResult'
            : `return ${values.fromNative(operation.result, 'result', subscription ? resultLifetime : undefined)}`,
        ]
        : callCallbacks
        ? [
          ...before,
          `const result = ${awaited ? 'await ' : ''}${call}`,
          'lifetime.finishCall()',
          ...finish,
          'return result',
        ]
        : finish.length > 0
        ? [...before, `const result = ${awaited ? 'await ' : ''}${call}`, ...finish, 'return result']
        : [...before, `return ${call}`]
    }
    // A trailing absent Tao argument must remain absent at the upstream call, not a copied docs default.
    for (let arity = 0; arity < operation.parameters.length; arity++) {
      const omitted = operation.parameters.slice(arity)
      if (omitted.every(parameter => parameter.optional)) {
        const condition = omitted.map((_, index) => `argument${arity + index} === null`).join(' && ')
        {
          sidecar.push(`${indent}if (${condition}) {`, ...invoke(arity).map(line => `${indent}  ${line}`), `${indent}}`)
        }
      }
    }
    sidecar.push(...invoke(operation.parameters.length).map(line => `${indent}${line}`))
    if (ownsCallbacks) {
      sidecar.push(
        '  } catch (error) {',
        ...(subscription || callCallbacks ? [`    lifetime.${callCallbacks ? 'cancel' : 'remove'}()`] : []),
        ...ownership.map((_, index) => `    callbackScope${index}.cancel()`),
        '    throw error',
        '  }',
      )
    }
    sidecar.push('}', '')
  }
  return {
    'Bindings.tao': `${tao.join('\n').replace(/^public (type|action) /gm, 'public\n$1 ').trimEnd()}\n`,
    'Bindings.ts': sidecar.join('\n'),
    'bindings.json': `${
      JSON.stringify({ schemaVersion: 1, catalog, target, diagnostics, bridgeTypes: bridgeTypes.names }, null, 2)
    }\n`,
  }
}
