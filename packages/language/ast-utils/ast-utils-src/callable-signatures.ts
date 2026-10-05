import { AST } from '@parser'
import { Assert } from '@shared'
import { type ArgumentBindingResult, resolveParameterArgumentBindings } from './argument-bindings'
import { type FailureContract, failureContractSatisfiesBound } from './failure-contracts'
import { parameterRequiresWritable } from './reactive-parameters'
import { type TaoType, Type } from './Type'
import { type BindingDiagnostic, resolveBindings } from './type-binding-matches'

/** CallableInput separates a receiving role and argument label from its local lexical alias. */
export type CallableInput = Readonly<{
  declaration: AST.ParameterDeclaration
  role?: string
  labelName: string
  localName: string
  type: TaoType
  acceptsNone: boolean
  omissible: boolean
  callerWritable: boolean
}>

/** CallableSignature carries concrete input domains and a full known/open propagated-failure bound. */
export type CallableSignature = Readonly<{
  inputs: readonly CallableInput[]
  failures: FailureContract
}>

/** Contract discovery supplies a guarded domain resolver without entering structural admission. */
export type CallableSignatureResolution = Readonly<{
  inputDomain(parameter: AST.ParameterDeclaration): TaoType
  accepts(actual: TaoType, expected: TaoType): boolean
}>

type InputIncompatibility = 'input-domain' | 'omission' | 'caller-storage' | 'write-domain'

export type CallableSignatureDiagnostic =
  | BindingDiagnostic<CallableInput, CallableInput>
  | {
    kind: 'incompatible-input'
    required: CallableInput
    supplied: CallableInput
    reasons: readonly InputIncompatibility[]
  }
  | { kind: 'failure-bound'; supplied: FailureContract; required: FailureContract }
  | { kind: 'unresolved-input'; input: CallableInput; side: 'supplied' | 'required' }

export type CallableSignatureComparison = Readonly<{
  compatible: boolean
  /** Unique safe correspondence in supplied implementation parameter order. */
  correspondence: readonly Readonly<{ required: CallableInput; supplied: CallableInput }>[]
  diagnostics: readonly CallableSignatureDiagnostic[]
}>

/** callableSignatureOf extracts view or concrete parameter inputs; unknown body failures remain open. */
export function callableSignatureOf(
  view: AST.ViewDeclaration,
  failures?: FailureContract,
  resolution?: CallableSignatureResolution,
): CallableSignature
export function callableSignatureOf(
  parameters: readonly AST.ParameterDeclaration[],
  failures?: FailureContract,
  resolution?: CallableSignatureResolution,
): CallableSignature
export function callableSignatureOf(
  source: AST.ViewDeclaration | readonly AST.ParameterDeclaration[],
  failures: FailureContract = { cases: [], open: true },
  resolution?: CallableSignatureResolution,
): CallableSignature {
  // Keep real parameter ownership for storage analysis; view aliases still resolve through AST.
  const parameters = AST.isViewDeclaration(source) ? AST.parametersOf(source) : source
  return {
    inputs: parameters.map(parameter => {
      const type = resolution ? resolution.inputDomain(parameter) : inputDomain(parameter)
      const name = Type.parameterName(parameter)
      return {
        declaration: parameter,
        role: parameter.inlineType?.name,
        labelName: name,
        localName: name,
        type,
        acceptsNone: (resolution?.accepts ?? Type.isAssignable)(Type.ofNone(), type),
        omissible: parameter.defaultValue !== undefined,
        callerWritable: parameterRequiresWritable(parameter),
      }
    }),
    failures,
  }
}

/** compareCallableSignatures checks substitution without positional ties or unsafe exact edges. */
export function compareCallableSignatures(
  supplied: CallableSignature,
  required: CallableSignature,
  accepts: (actual: TaoType, expected: TaoType) => boolean = Type.isAssignable,
): CallableSignatureComparison {
  const resolution = resolveBindings<CallableInput, CallableInput>({
    candidates: required.inputs,
    targets: supplied.inputs,
    candidateLabel: input => input.role,
    targetName: input => input.role ?? input.labelName,
    candidateType: input => input.type,
    targetType: input => input.type,
    namedTypeAccepts: accepts,
    pairAccepts: (caller, implementation) => inputIncompatibilities(caller, implementation, accepts).length === 0,
    targetRequiresValue: input => !input.omissible,
    completeCorrespondence: true,
    duplicateTargetTypesOnlyWithCandidates: true,
    unresolvedCandidatesExcuseMissing: false,
  })
  const diagnostics: CallableSignatureDiagnostic[] = resolution.diagnostics.map(diagnostic => {
    if (diagnostic.kind === 'named-type') {
      return {
        kind: 'incompatible-input',
        required: diagnostic.candidate,
        supplied: diagnostic.target,
        reasons: inputIncompatibilities(diagnostic.candidate, diagnostic.target, accepts),
      }
    }
    return diagnostic
  })
  for (const input of required.inputs) {
    if (unresolvedDomain(input.type)) {
      diagnostics.push({ kind: 'unresolved-input', input, side: 'required' })
    }
  }
  for (const input of supplied.inputs) {
    if (unresolvedDomain(input.type)) {
      diagnostics.push({ kind: 'unresolved-input', input, side: 'supplied' })
    }
  }
  if (!failureContractSatisfiesBound(supplied.failures, required.failures)) {
    diagnostics.push({ kind: 'failure-bound', supplied: supplied.failures, required: required.failures })
  }
  return {
    compatible: diagnostics.length === 0,
    correspondence: resolution.pairs
      .filter(([caller, implementation]) => inputIncompatibilities(caller, implementation, accepts).length === 0)
      .map(([caller, implementation]) => ({ required: caller, supplied: implementation })),
    diagnostics,
  }
}

/** bindCallableArguments retains ordinary argument semantics and stable public labels across aliases. */
export function bindCallableArguments(
  signature: CallableSignature,
  arguments_: readonly AST.Argument[],
): ArgumentBindingResult {
  const inputs = new Map(signature.inputs.map(input => [input.declaration, input]))
  const inputOf = (parameter: AST.ParameterDeclaration): CallableInput => {
    const input = inputs.get(parameter)
    Assert.defined(input, 'Expected a signature input for every bound parameter.')
    return input
  }
  return resolveParameterArgumentBindings(
    signature.inputs.map(input => input.declaration),
    arguments_,
    {
      parameterName: parameter => inputOf(parameter).labelName,
      parameterType: parameter => inputOf(parameter).type,
      parameterOmissible: parameter => inputOf(parameter).omissible,
    },
  )
}

function inputIncompatibilities(
  required: CallableInput,
  supplied: CallableInput,
  accepts: (actual: TaoType, expected: TaoType) => boolean,
): InputIncompatibility[] {
  const reasons: InputIncompatibility[] = []
  if (
    unresolvedDomain(required.type) || unresolvedDomain(supplied.type)
    || !accepts(required.type, supplied.type)
  ) {
    reasons.push('input-domain')
  }
  if (required.omissible && !supplied.omissible) {
    reasons.push('omission')
  }
  if (supplied.callerWritable && !required.callerWritable) {
    reasons.push('caller-storage')
  }
  if (supplied.callerWritable && !accepts(supplied.type, required.type)) {
    reasons.push('write-domain')
  }
  return reasons
}

function unresolvedDomain(type: TaoType): boolean {
  return type.kind === 'unresolved'
    || (type.kind === 'union' && type.members.some(unresolvedDomain))
    || (type.kind === 'list' && type.element !== undefined && unresolvedDomain(type.element))
    || (type.kind === 'primitive' && type.primitive === 'action'
      && type.parameters.some(input => unresolvedDomain(input.type)))
}

function inputDomain(parameter: AST.ParameterDeclaration): TaoType {
  const inline = parameter.inlineType
  if (!inline) {
    return Type.ofParameter(parameter)
  }
  const underlying = Type.ofTypeExpression(inline.type)
  // Inline primitive/list names are callable roles. Strip only that scoped parameter identity;
  // referenced nominal types, list elements, and structural/constrained definitions retain theirs.
  if (!AST.isNamedTypeReference(inline.type) && (underlying.kind === 'primitive' || underlying.kind === 'list')) {
    return inline.optional ? { kind: 'union', members: [underlying, Type.ofNone()] } : underlying
  }
  return Type.ofParameter(parameter)
}
