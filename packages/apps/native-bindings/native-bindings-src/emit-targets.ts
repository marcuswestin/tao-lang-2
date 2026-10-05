import { Assert, Switch } from '@shared'
import type { NativeApiCatalog, NativeApiMember, NativeApiOperation, NativeApiReceiver } from './native-api'

export function nativeMember(member: NativeApiMember): string {
  return typeof member === 'string' ? JSON.stringify(member) : `Symbol.${member.symbol}`
}

export function nativePath(path: readonly string[], global = false): string {
  return `${global ? 'nativeGlobals()' : 'native()'}${path.map(member => `[${JSON.stringify(member)}]`).join('')}`
}

/** Only namespaces reached by generated paths need a runtime resolver. */
export function nativeNamespaces(
  catalog: NativeApiCatalog,
  nativeEnums: boolean,
): { module: boolean; global: boolean } {
  const namespaces = { module: nativeEnums, global: false }
  const use = (global = false) => {
    namespaces[global ? 'global' : 'module'] = true
  }
  for (const reference of catalog.references ?? []) {
    if (reference.runtimeConstructor) {
      use(reference.runtimeConstructor.global)
    }
  }
  for (const operation of catalog.operations) {
    if (!operation.target) {
      use()
    } else {
      Switch.kind(operation.target, {
        construct: target => use(target.global),
        call: target => use(target.global),
        method: target => {
          if (target.receiver.kind === 'module') {
            use(target.receiver.global)
          }
        },
        get: target => {
          if (target.receiver.kind === 'module') {
            use(target.receiver.global)
          }
        },
        set: target => {
          if (target.receiver.kind === 'module') {
            use(target.receiver.global)
          }
        },
      })
    }
    if (operation.arguments?.some(argument => argument.kind === 'export')) {
      use()
    }
  }
  return namespaces
}

/** Preserve the upstream receiver, including static methods and symbol members. */
export function nativeInvocation(
  operation: NativeApiOperation,
  arguments_: string[],
  fallback: string,
  receiverValue = 'receiver',
): string {
  if (!operation.target) {
    return `${fallback}[${JSON.stringify(operation.name)}](${arguments_.join(', ')})`
  }
  return Switch.kind(operation.target, {
    construct: target => `new (${nativePath(target.path, target.global)})(${arguments_.join(', ')})`,
    call: target => `${nativePath(target.path, target.global)}(${arguments_.join(', ')})`,
    method: target =>
      `${receiver(target.receiver, receiverValue)}[${nativeMember(target.member)}](${arguments_.join(', ')})`,
    get: target => {
      Assert.input(arguments_.length === 0, `Native getter '${operation.name}' must not take arguments.`)
      return `${receiver(target.receiver, receiverValue)}[${nativeMember(target.member)}]`
    },
    set: target => {
      Assert.input(
        arguments_.length === 1 && !operation.result,
        `Native setter '${operation.name}' must take one value and return nothing.`,
      )
      return `(${receiver(target.receiver, receiverValue)}[${nativeMember(target.member)}] = ${
        arguments_[0]
      }, undefined)`
    },
  })
}

function receiver(
  target: NativeApiReceiver,
  value: string,
): string {
  return Switch.kind(target, {
    module: target => nativePath(target.path, target.global),
    reference: target => `${target.name}Reference.unwrap(${value})`,
  })
}
