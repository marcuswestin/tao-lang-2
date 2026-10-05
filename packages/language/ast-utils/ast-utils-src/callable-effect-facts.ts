import { AST } from '@parser'
import { Assert } from '@shared'
import type { CallableEffectFact, ExecutedEffectEdge, PurityContract, PurityViolation } from './callable-effects'
import type { FailureContract } from './failure-contracts'

type PublicationStatus =
  | Readonly<{ kind: 'complete'; reason?: never }>
  | Readonly<{ kind: 'unknown'; reason: 'incomplete-fact' | 'dynamic-target' | 'unclassified-native' }>

type EffectContract = Readonly<{ purity: PurityContract; failures: FailureContract }>

/** Correspondence and selected defaults are published before effect-dependent admission. */
export type ResolvedCallExecution =
  & PublicationStatus
  & Readonly<{
    site: AST.Node
    operation: 'function' | 'action' | 'schedule' | 'unknown'
    target?: AST.Node
    body?: AST.Node
    contract?: EffectContract
    pairs: readonly Readonly<{ argument: AST.Node; parameter: AST.Node }>[]
    defaults: readonly Readonly<{ parameter: AST.Node; expression: AST.Node }>[]
    /** Additional executing arguments for separately owned syntax; current arguments come from AST. */
    explicitArguments?: readonly AST.Node[]
    failureTransfer?: ExecutedEffectEdge['failureTransfer']
  }>

type ResolvedReadExecution =
  & PublicationStatus
  & Readonly<{
    reference: AST.Node
    classification: 'immutable' | 'reactive' | 'unknown'
    initializer?: AST.Node
  }>

export type NativeEffectPublication =
  & PublicationStatus
  & EffectContract
  & Readonly<{
    /** Evaluation runs at this witness; invocation describes a separately executed callable value. */
    phase: 'evaluation' | 'invocation'
    /** Actual Tao declaration or expression-position bridge site; never a fabricated native node. */
    declaration: AST.Node
    /** Actual Tao publication origin witnessing the independently resolved native export. */
    exportSource: AST.Node
  }>

export type CallableEffectFactInputs = Readonly<{
  calls: readonly ResolvedCallExecution[]
  reads: readonly ResolvedReadExecution[]
  natives: readonly NativeEffectPublication[]
}>

/** Real supported source implementation roots and conservative, potentially legal defaults; no signature purity promise. */
type SourceRootExecution =
  & PublicationStatus
  & Readonly<{
    node: AST.Node
    bodies: readonly AST.Node[]
    defaults: readonly Readonly<{ parameter: AST.Node; expression: AST.Node }>[]
  }>

export type SourceDiscoveryContext = Readonly<{
  root?: SourceRootExecution
  covered?: ReadonlySet<AST.Node>
}>

/** Consume source identities without reference resolution, type inference, or admission callbacks. */
export function discoverCallableEffectFacts(
  owner: AST.Node,
  inputs: CallableEffectFactInputs,
  context?: SourceDiscoveryContext,
): readonly CallableEffectFact[] {
  Assert(!context?.root || context.root.node === owner, 'Expected source root identity to match the effect owner.')
  const calls = indexRows(inputs.calls, row => row.site)
  const reads = indexRows(inputs.reads, row => row.reference)
  const natives = indexRows(inputs.natives, row => row.declaration)
  const targets = new Map<AST.Node, Readonly<{ body?: AST.Node; contract?: EffectContract }>>()
  const exports = new Map<AST.Node, NativeEffectPublication>()
  const origins = new Map<AST.Node, Map<NativeEffectPublication['phase'], NativeEffectPublication>>()
  for (const row of inputs.calls) {
    if (!row.target || (!row.body && !row.contract)) {
      continue
    }
    const previous = targets.get(row.target)
    Assert(
      !previous || (previous.body === row.body && sameContract(previous.contract, row.contract)),
      'Expected consistent callable target publications.',
    )
    Assert(!row.body || !row.contract, 'Expected one callable body or compact contract.')
    targets.set(row.target, { body: row.body, contract: row.contract })
  }
  for (const row of inputs.natives) {
    Assert(
      row.phase === 'evaluation' || row.phase === 'invocation',
      'Expected an explicit native effect publication phase.',
    )
    const target = targets.get(row.declaration)
    Assert(row.phase === 'evaluation' || !target?.body, 'Expected one source body or native target publication.')
    Assert(
      row.phase === 'evaluation' || !target?.contract || sameContract(target.contract, row),
      'Expected consistent native target contracts.',
    )
    const phases = origins.get(row.exportSource) ?? new Map<NativeEffectPublication['phase'], NativeEffectPublication>()
    const previous = phases.get(row.phase)
    Assert(
      !previous
        || (previous.kind === row.kind && previous.reason === row.reason
          && sameContract(previous, row)),
      'Expected consistent native export publications.',
    )
    phases.set(row.phase, row)
    origins.set(row.exportSource, phases)
    if (row.phase === 'evaluation') {
      exports.set(row.exportSource, row)
    }
  }

  const queue = [owner]
  const queued = new Set<AST.Node>(queue)
  const facts: CallableEffectFact[] = []
  const enter = (node: AST.Node) => {
    if (!queued.has(node)) {
      queued.add(node)
      queue.push(node)
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index]!
    const executes: ExecutedEffectEdge[] = []
    const violations: PurityViolation[] = []
    let reason: Extract<PublicationStatus, { kind: 'unknown' }>['reason'] | undefined
    let purity: PurityContract = { violations, open: false }
    let failures: FailureContract = { cases: [], open: false }
    const edge = (target: AST.Node, site: AST.Node = node, failureTransfer?: ExecutedEffectEdge['failureTransfer']) => {
      // The same argument may appear in syntax and publication; evaluate its witness once.
      if (executes.some(existing => existing.target === target && existing.site === site)) {
        return
      }
      executes.push({ site, target, ...(failureTransfer ? { failureTransfer } : {}) })
      enter(target)
    }
    const native = natives.get(node)
    const exported = exports.get(node)
    const ownNative = native?.phase === 'evaluation' || (native && !AST.isExpression(node)) ? native : undefined
    const ownExported = exported?.phase === 'evaluation' ? exported : undefined
    const target = targets.get(node)
    const call = calls.get(node)
    const read = reads.get(node)
    const sourceRoot = context?.root?.node === node ? context.root : undefined
    if (sourceRoot) {
      for (const body of sourceRoot.bodies) {
        edge(body, sourceRoot.node)
      }
      for (const selected of sourceRoot.defaults) {
        edge(selected.expression, selected.parameter)
      }
    }
    const callSite = call || AST.isFunctionCallExpression(node) || AST.isDoStatement(node)
    const applyOperationContract = (
      contract: EffectContract,
      transfer: ExecutedEffectEdge['failureTransfer'],
      status?: PublicationStatus,
    ) => {
      purity = {
        violations: [...violations, ...contract.purity.violations],
        open: contract.purity.open || status?.kind === 'unknown',
      }
      failures = transfer?.handlesAll || transfer?.detached
        ? { cases: [], open: false }
        : {
          cases: contract.failures.cases.filter(value => !transfer?.handledCases?.includes(value)),
          open: contract.failures.open || status?.kind === 'unknown',
        }
      if (status?.kind === 'unknown' && !transfer?.handlesAll && !transfer?.detached) {
        reason ??= status.reason
      }
    }
    // Read evaluation is an independent facet, outside any operation's failure transfer.
    if (read?.initializer) {
      edge(read.initializer)
    }
    if (read?.classification === 'reactive') {
      violations.push('reactive-state')
    }
    reason ??= read?.reason
    if (read?.classification === 'unknown') {
      reason ??= 'incomplete-fact'
    }
    if ((read || (!callSite && (native || exported))) && AST.isExpression(node) && !AST.isActionExpression(node)) {
      for (const child of AST.streamContents(node)) {
        if (AST.isTypeReference(child)) {
          continue
        }
        edge(child)
      }
    }
    if (AST.isActionExpression(node) && !ownNative && !ownExported) {
      // Construction remains independent of every invocation publication targeting this value.
    } else if (!callSite && ownNative?.phase === 'invocation') {
      applyOperationContract(ownNative, undefined, ownNative)
    } else if (!callSite && ownNative && ownNative.exportSource !== node) {
      edge(ownNative.exportSource)
    } else if (!callSite && ownExported) {
      applyOperationContract(ownExported, undefined, ownExported)
    } else if (!callSite && target && !AST.isExpression(node)) {
      if (target.body) {
        edge(target.body)
      }
      if (target.contract) {
        applyOperationContract(target.contract, undefined)
      }
    } else if (callSite) {
      // Syntax owns explicit evaluation, including unmatched arguments and missing publications.
      if (AST.isFunctionCallExpression(node) || AST.isDoStatement(node)) {
        for (const argument of node.argumentList?.arguments ?? []) {
          edge(argument.value, argument)
        }
      } else {
        for (const child of AST.streamContents(node)) {
          if (AST.isParameterDeclaration(child) || AST.isTypeReference(child)) {
            continue
          }
          if (AST.isFunctionDeclaration(child) || AST.isActionDeclaration(child) || AST.isPhraseDeclaration(child)) {
            continue
          }
          edge(child)
        }
      }
      for (const argument of call?.explicitArguments ?? []) {
        edge(AST.isArgument(argument) ? argument.value : argument, argument)
      }
      for (const selected of call?.defaults ?? []) {
        edge(selected.expression, selected.parameter)
      }
      if (AST.isDoStatement(node) && (!AST.isValueReference(node.action) || reads.has(node.action))) {
        edge(node.action)
      }
      if (call?.operation === 'action' || call?.operation === 'schedule' || AST.isDoStatement(node)) {
        violations.push('action')
      }
      reason ??= call?.reason
      if ((!call && !ownNative && !ownExported) || call?.operation === 'unknown') {
        reason ??= 'incomplete-fact'
      }
      const transfer = call?.operation === 'schedule'
        ? { ...call.failureTransfer, detached: true }
        : call?.failureTransfer
      if (ownNative || ownExported) {
        if (ownNative?.phase === 'invocation') {
          applyOperationContract(ownNative, transfer, ownNative)
        } else if (ownNative && ownNative.exportSource !== node) {
          edge(ownNative.exportSource, node, transfer)
        } else {
          const contract = (ownExported ?? ownNative)!
          applyOperationContract(contract, transfer, contract)
        }
      } else if (call?.target) {
        const nativeTarget = natives.get(call.target)
        if (AST.isExpression(call.target) || nativeTarget?.phase === 'evaluation') {
          // Evaluate the target value separately; its invocation belongs only to this call site.
          if (call.target !== node) {
            edge(call.target)
          }
          if (call.body) {
            edge(call.body, call.target, transfer)
          } else if (call.contract) {
            applyOperationContract(call.contract, transfer)
          } else if (nativeTarget?.phase === 'invocation') {
            applyOperationContract(nativeTarget, transfer, nativeTarget)
          } else {
            reason ??= 'incomplete-fact'
          }
        } else {
          edge(call.target, node, transfer)
        }
      } else {
        executes.push({
          site: node,
          unknown: call?.reason === 'dynamic-target' ? 'dynamic-target' : 'unresolved-target',
        })
        reason ??= 'incomplete-fact'
      }
    } else if (read || AST.isValueReference(node) || AST.isMemberAccessExpression(node)) {
      if (!read) {
        reason ??= 'incomplete-fact'
      }
    } else if (AST.isFunctionDeclaration(node)) {
      if (node === owner) {
        edge(node.block)
      } else {
        reason = 'incomplete-fact'
      }
    } else if (AST.isActionDeclaration(node)) {
      if (node === owner && node.block) {
        edge(node.block)
      } else if (!sourceRoot) {
        reason = 'unclassified-native'
      }
    } else if (AST.isPhraseDeclaration(node)) {
      if (node === owner) {
        if (node.text) {
          edge(node.text)
        }
        for (const form of node.forms) {
          edge(form.text)
        }
      } else {
        reason = 'incomplete-fact'
      }
    } else if (AST.isAsyncActionStatement(node)) {
      violations.push('action')
      edge(node.block, node, { detached: true })
    } else if (AST.isNowExpression(node)) {
      reason = 'unclassified-native'
    } else if (AST.isFromExpression(node)) {
      edge(node.expression)
      const publication = calls.get(node.expression)
      if (!natives.has(node.expression) && !(publication?.target && natives.has(publication.target))) {
        reason = 'unclassified-native'
      }
    } else {
      // Publication owns supported implementation identity; associated owners need not be top-level declarations.
      const publishedDeclarationRoots = Boolean(sourceRoot && !AST.isExpression(node) && !isStructuralEvaluation(node))
      if (!publishedDeclarationRoots) {
        for (const child of AST.streamContents(node)) {
          if (AST.isParameterDeclaration(child) || AST.isTypeReference(child)) {
            continue
          }
          if (AST.isFunctionDeclaration(child) || AST.isActionDeclaration(child) || AST.isPhraseDeclaration(child)) {
            continue
          }
          edge(child)
        }
      }
      if (!isStructuralEvaluation(node) && !publishedDeclarationRoots) {
        reason = 'incomplete-fact'
      }
    }
    if (sourceRoot?.kind === 'unknown') {
      reason ??= sourceRoot.reason
    }
    if (context?.covered && !context.covered.has(node)) {
      reason ??= 'incomplete-fact'
    }
    facts.push({
      node,
      purity,
      failures,
      executes,
      ...(reason ? { kind: 'unknown', reason } as const : { kind: 'complete' } as const),
    })
  }
  return facts
}

function indexRows<Row>(rows: readonly Row[], identity: (row: Row) => AST.Node): Map<AST.Node, Row> {
  const result = new Map<AST.Node, Row>()
  for (const row of rows) {
    const node = identity(row)
    Assert(!result.has(node), 'Expected one published effect row per source witness.')
    result.set(node, row)
  }
  return result
}

function sameContract(left: EffectContract | undefined, right: EffectContract | undefined): boolean {
  if (!left || !right) {
    return left === right
  }
  return left.purity.open === right.purity.open && left.failures.open === right.failures.open
    && left.purity.violations.join('\0') === right.purity.violations.join('\0')
    && left.failures.cases.join('\0') === right.failures.cases.join('\0')
}

/** Unsupported syntax still walks its operands but cannot silently acquire a closed contract. */
function isStructuralEvaluation(node: AST.Node): boolean {
  return AST.isNumberLiteral(node) || AST.isStringLiteral(node) || AST.isBooleanLiteral(node) || AST.isNoneLiteral(node)
    || AST.isBinaryExpression(node) || AST.isUnaryExpression(node) || AST.isListLiteral(node)
    || AST.isInterpolatedString(node) || AST.isInterpolatedStringPart(node)
    || AST.isFunctionBlock(node) || AST.isActionBlock(node) || AST.isBlock(node)
    || AST.isReturnStatement(node) || AST.isRenderStatement(node)
    || AST.isIfFunctionStatement(node) || AST.isIfActionStatement(node) || AST.isCheckStatement(node)
    || AST.isWhenExpression(node) || AST.isWhenBranch(node) || AST.isWhenOtherwise(node)
    || AST.isArgument(node) || AST.isArgumentList(node) || AST.isActionResultStatement(node)
}
