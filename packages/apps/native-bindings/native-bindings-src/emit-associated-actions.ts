import { Assert } from '@shared'
import type { nativeValueEmitter } from './emit-values'
import { taoName } from './emit-values'
import type { NativeApiCatalog } from './native-api'

/** Associated actions share the existing checked native wrappers and their lifetime contracts. */
export function emitAssociatedActions(
  catalog: NativeApiCatalog,
  values: ReturnType<typeof nativeValueEmitter>,
  implementationImport: string,
): { declarations: ReadonlyMap<string, readonly string[]>; sidecar: string[] } {
  const declarations = new Map<string, string[]>()
  const sidecar: string[] = []
  const referenceNames = new Set(catalog.references?.map(reference => reference.name))
  const exports = new Set(catalog.operations.map(operation => taoName(operation.name)))
  const members = new Map<string, Set<string>>()
  const append = (owner: string, member: string, declaration: string, flatExport: string): void => {
    const names = members.get(owner) ?? new Set<string>()
    Assert.input(!names.has(member), `Native associated actions collide at '${owner}.${member}'.`)
    names.add(member)
    members.set(owner, names)
    const exportName = `${owner}_${member}`
    Assert.input(!exports.has(exportName), `Native associated export '${exportName}' collides.`)
    exports.add(exportName)
    const body = declarations.get(owner) ?? []
    body.push(declaration)
    declarations.set(owner, body)
    sidecar.push(`export const ${exportName} = ${flatExport}`, '')
  }
  for (const operation of catalog.operations) {
    const target = operation.target
    if (target === undefined) {
      continue
    }
    const instance = 'receiver' in target && target.receiver.kind === 'reference'
      ? target.receiver.name
      : undefined
    const staticOwner = target.kind === 'construct' && operation.result?.kind === 'reference'
      ? operation.result.name
      : 'receiver' in target && target.receiver.kind === 'module'
      ? target.receiver.path.at(-1)
      : undefined
    const owner = instance ?? staticOwner
    if (owner === undefined || !referenceNames.has(owner)) {
      continue
    }
    const name = taoName(operation.name)
    const member = name.startsWith(owner) && name.length > owner.length ? name.slice(owner.length) : name
    const receiverParameter = instance !== undefined && operation.parameters[0]?.name === 'receiver'
      && operation.parameters[0].type.kind === 'reference' && operation.parameters[0].type.name === instance
    const parameters = operation.parameters
      .map((parameter, index) => ({ parameter, index }))
      .filter(({ index }) => !receiverParameter || index !== 0)
      .sort((left, right) =>
        Number(left.parameter.optional) - Number(right.parameter.optional) || left.index - right.index
      )
      .map(({ parameter }) => {
        const label = taoName(parameter.name)
        const type = values.taoType(parameter.type, `${name}${label}`)
        return `${label} ${type}${
          parameter.optional ? `${parameter.type.kind === 'nullable' ? '' : '?'} default none` : ''
        }`
      })
    const result = operation.pending
      ? ` returns ${operation.pending.name}`
      : operation.result
      ? ` returns ${values.taoType(operation.result, `${name}Result`)}`
      : ''
    append(
      owner,
      member,
      `${instance === undefined ? 'static ' : ''}action ${member}(${
        parameters.join(', ')
      })${result} from ${implementationImport}`,
      name,
    )
  }
  for (const reference of catalog.references ?? []) {
    append(
      reference.name,
      'ReleaseReference',
      `action ReleaseReference() from ${implementationImport}`,
      `Release${reference.name}`,
    )
  }
  return { declarations, sidecar }
}
