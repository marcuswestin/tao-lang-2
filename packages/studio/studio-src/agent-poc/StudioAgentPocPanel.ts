// Semantic agent proof of concept: a fixed overlay panel in the Studio page. Deliberately plain DOM,
// inline styles, and no Tao/React portal involvement; it exists to make the flow observable.
import { StudioApiClient } from '../client/StudioApiClient'
import { StudioInspector } from '../StudioInspector'
import type { StudioInspectorSelection } from '../StudioInspector'
import type { StudioCanonicalSourceAction, StudioSourceActionIdentity } from '../StudioProtocol'
import { type FeatureTestVerdict, featureTestVerdict, type TestRunSummary } from './FeatureVerdict'

type Json = Record<string, unknown>
type Finding = { kind: 'fact' | 'inference' | 'suggestion'; text: string; evidence: string[] }
type Change = { operation: 'set-design-entry' | 'none'; bundle: string; key: string; value: string; rationale: string }
type ReviewResult = {
  status: 'ok' | 'failure'
  message?: string
  analysis?: string
  notes: string[]
  value?: { findings: Finding[]; change: Change }
  toolCalls: { name: string; arguments: Json; resultChars: number; result: string }[]
  transcript: { kind: string; text?: string; name?: string; calls?: { name: string; arguments: string }[] }[]
  elapsedMs: number
  promptChars: number
  toolResultChars: number
  packet: Json
  designName?: string
  designPath?: string
  normalization?: { original: string; resolved?: string; note: string; usedByThisView?: boolean; viewStyles: string[] }
  viewName: string
}

export type StudioAgentPocPanelHooks = {
  selection: () => StudioInspectorSelection | undefined
  activeScenario: () => string | undefined
  identityFor: (file: { path: string; sourceVersion: string }) => StudioSourceActionIdentity | undefined
  openFile: (path: string, reveal?: number) => Promise<void>
}

export function mountStudioAgentPocPanel(root: HTMLElement, hooks: StudioAgentPocPanelHooks): void {
  const panel = document.createElement('div')
  panel.className = 'studio-agent-poc'
  panel.setAttribute('aria-label', 'Semantic agent proof of concept')
  // Position, chrome and collapse belong to the shell that hosts this.
  panel.style.cssText = 'display:block'
  panel.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <span style="flex:1"></span>
      <input class="poc-view" placeholder="view (uses selection)" style="width:150px;background:#0f1411;color:#e8ede9;border:1px solid #3a4a3f;border-radius:6px;padding:3px 6px;font:inherit">
      <button class="poc-review" type="button">Review</button>
    </div>
    <div class="poc-status" style="color:#9fb3a5">Select a render in the preview, then Review. Inference runs on-device through Apple Foundation Models.</div>
    <div style="display:flex;gap:8px;align-items:center;margin:8px 0 4px">
      <input class="poc-feature" placeholder="describe a feature, e.g. let people archive documents" style="flex:1;background:#0f1411;color:#e8ede9;border:1px solid #3a4a3f;border-radius:6px;padding:3px 6px;font:inherit">
      <button class="poc-plan" type="button">Plan feature</button>
    </div>
    <div class="poc-body"></div>
  `
  root.append(panel)
  const status = panel.querySelector<HTMLElement>('.poc-status')!
  const body = panel.querySelector<HTMLElement>('.poc-body')!
  const viewInput = panel.querySelector<HTMLInputElement>('.poc-view')!
  const reviewButton = panel.querySelector<HTMLButtonElement>('.poc-review')!

  let lastCheckpoint:
    | { id: string; identity: StudioSourceActionIdentity; path: string; afterVersion: string }
    | undefined

  // The app's tests as they stood before the agent touched anything. Taken while the plan is on screen, so
  // a failure after applying can be attributed to this change rather than to whatever was already red.
  let testBaseline: Promise<TestRunSummary | undefined> | undefined

  async function runAppTests(): Promise<TestRunSummary | undefined> {
    try {
      return await StudioApiClient.testRun()
    } catch {
      // A Studio service without the test runtime simply yields no verdict.
      return undefined
    }
  }

  reviewButton.addEventListener('click', () => void review())
  const featureInput = panel.querySelector<HTMLInputElement>('.poc-feature')!
  const planButton = panel.querySelector<HTMLButtonElement>('.poc-plan')!
  planButton.addEventListener('click', () => void planFeature())

  type PlanStep = { file: string; action: string; decidedBy: string; evidence: string[]; status: string; note?: string }
  type FeaturePlanResult = {
    kind: 'add-flag' | 'reword-text' | 'other'
    shape: Record<string, string>
    steps: PlanStep[]
    edits: { path: string; before: string; after: string; diff: string }[]
    packet: Json
    problems: string[]
    explanation?: string
    model: { status: string; message?: string; elapsedMs: number; promptChars: number; toolCalls: unknown[] }
  }

  async function planFeature(): Promise<void> {
    const request = featureInput.value.trim()
    if (request === '') {
      status.textContent = 'Describe the feature first.'
      return
    }
    planButton.disabled = true
    body.replaceChildren()
    status.textContent = 'Asking the on-device model for the feature shape, then lowering it with Tao…'
    const started = Date.now()
    try {
      const plan = await StudioApiClient.agentPoc<FeaturePlanResult>('plan-feature', { request })
      status.textContent = plan.model.status === 'ok'
        ? `Planned in ${((Date.now() - started) / 1000).toFixed(1)}s · model ${
          (plan.model.elapsedMs / 1000).toFixed(1)
        }s · prompt ${plan.model.promptChars} chars · ${plan.edits.length} files`
        : `Model failure: ${plan.model.message ?? 'unknown'}`
      renderPlan(plan, request)
    } catch (error) {
      status.textContent = `Plan failed: ${String(error)}`
    } finally {
      planButton.disabled = false
    }
  }

  function renderPlan(plan: FeaturePlanResult, request: string): void {
    const heading = (title: string) => {
      const element = document.createElement('div')
      element.style.cssText =
        'margin:8px 0 3px;color:#9fb3a5;text-transform:uppercase;font-size:10px;letter-spacing:.06em'
      element.textContent = title
      body.append(element)
    }
    if (plan.explanation !== undefined) {
      heading('This request is outside what the proof of concept builds')
      const note = document.createElement('div')
      note.style.cssText =
        'margin:3px 0;padding:7px 9px;border-radius:6px;background:#221a10;border-left:3px solid #d9b45c;white-space:pre-wrap'
      note.textContent = plan.explanation
      body.append(note)
      return
    }
    heading(`Kind of change the model recognized: ${plan.kind}`)
    heading('Facts given to the model')
    const packet = document.createElement('details')
    packet.innerHTML = `<summary>${JSON.stringify(plan.packet).length} chars</summary>`
    const packetText = document.createElement('pre')
    packetText.style.cssText =
      'white-space:pre-wrap;max-height:160px;overflow:auto;background:#0f1411;padding:6px;border-radius:6px'
    packetText.textContent = JSON.stringify(plan.packet, null, 1)
    packet.append(packetText)
    body.append(packet)

    heading('Feature shape chosen by the model')
    body.append(line(`"${request}" → ${JSON.stringify(plan.shape)}`))
    for (const problem of plan.problems) {
      body.append(line(`Tao rejected: ${problem}`))
    }

    heading('Plan (placements decided by Tao from the semantic graph)')
    for (const step of plan.steps) {
      const row = document.createElement('div')
      const colour = { model: '#7aa6d9', tao: '#6fb38a', 'poc-hard-coded': '#d9b45c' }[step.decidedBy] ?? '#888'
      row.style.cssText = 'margin:3px 0;padding:5px 7px;border-radius:6px;background:#0f1411;border-left:3px solid '
        + colour
      const label = document.createElement('strong')
      label.textContent = step.decidedBy === 'model'
        ? 'Model chose'
        : step.decidedBy === 'tao'
        ? 'Tao placed'
        : 'PoC hard-coded'
      row.append(
        label,
        document.createTextNode(
          ` — ${step.file}: ${step.action}${step.status === 'unsupported' ? ' (UNSUPPORTED)' : ''}`,
        ),
      )
      if (step.note !== undefined) {
        row.append(document.createElement('br'), document.createTextNode(step.note))
      }
      for (const evidence of step.evidence) {
        row.append(document.createTextNode(' '), evidenceLink(evidence, { packet: plan.packet } as ReviewResult))
      }
      body.append(row)
    }
    if (plan.edits.length === 0) {
      body.append(line('No source edits produced.'))
      return
    }

    heading('Source proposal (ordinary Tao, formatted)')
    for (const edit of plan.edits) {
      const details = document.createElement('details')
      details.innerHTML = `<summary>${edit.path}</summary>`
      const pre = document.createElement('pre')
      pre.style.cssText =
        'white-space:pre-wrap;background:#0f1411;padding:6px;border-radius:6px;max-height:220px;overflow:auto'
      pre.textContent = edit.diff
      details.append(pre)
      body.append(details)
    }
    // Start measuring the app's current behavior now, while a person reads the plan. By the time they press
    // Apply the baseline is usually already in hand.
    testBaseline = runAppTests()
    const apply = document.createElement('button')
    apply.type = 'button'
    apply.textContent = `Apply ${plan.edits.length} files as one change, compile, refresh preview`
    body.append(apply)
    const box = document.createElement('div')
    body.append(box)
    apply.addEventListener('click', () => void applyFeature(plan, box))
  }

  async function applyFeature(plan: FeaturePlanResult, box: HTMLElement): Promise<void> {
    box.replaceChildren(line('Applying…'))
    try {
      // The baseline has to finish before the files change. A run still in flight would see a mix of the old
      // and new sources, and a test this change breaks would land in the baseline's failures and be excused.
      const before = await testBaseline
      const result = await StudioApiClient.agentPoc<
        { compile: { status: string; message: string; diagnostics: { message: string }[] }; rolledBack: boolean }
      >(
        'apply-feature',
        { edits: plan.edits.map(edit => ({ after: edit.after, path: edit.path })), writeId: crypto.randomUUID() },
      )
      if (result.rolledBack) {
        box.append(
          line(
            `Compile failed, every file was restored: ${
              result.compile.diagnostics[0]?.message ?? result.compile.message
            }`,
          ),
        )
        return
      }
      box.append(line(`Applied. Compile: ${result.compile.status} (${result.compile.message}).`))
      await hooks.openFile(plan.edits[1]?.path ?? plan.edits[0]!.path)
      const undo = document.createElement('button')
      undo.type = 'button'
      undo.textContent = 'Undo the whole feature (restore all files)'
      box.append(undo)
      undo.addEventListener('click', () => void undoFeature(box))
      const checking = line('Running the app\u2019s own tests against the change\u2026')
      box.append(checking)
      const after = await runAppTests()
      checking.remove()
      renderVerdict(box, featureTestVerdict(before, after))
    } catch (error) {
      box.append(line(`Apply failed: ${String(error)}`))
    }
  }

  /**
   * renderVerdict shows what the app's own tests say about the change. A compile says a change is
   * well-formed; only these say it is right, and they are the only part of this panel that can contradict
   * a plan that looked convincing.
   */
  function renderVerdict(box: HTMLElement, verdict: FeatureTestVerdict): void {
    const colour = { broke: '#d4736b', held: '#6fb38a', unknown: '#9fb3a5' }[verdict.status]
    const panel = document.createElement('div')
    panel.style.cssText =
      `margin:6px 0;padding:7px 9px;border-radius:6px;background:#0f1411;border-left:3px solid ${colour}`
    const heading = document.createElement('strong')
    heading.textContent = verdict.heading
    panel.append(heading)
    if (verdict.detail !== undefined) {
      panel.append(document.createElement('br'), document.createTextNode(verdict.detail))
    }
    for (const broken of verdict.broke) {
      const row = document.createElement('div')
      row.style.cssText = 'margin-top:5px'
      const name = document.createElement('em')
      name.textContent = broken.name
      row.append(name, document.createElement('br'), document.createTextNode(broken.message))
      panel.append(row)
    }
    box.append(panel)
  }

  async function undoFeature(box: HTMLElement): Promise<void> {
    try {
      const result = await StudioApiClient.agentPoc<
        { compile: { status: string; message: string }; restored: string[] }
      >('undo-feature', {})
      box.append(
        line(`Undone: ${result.restored.join(', ')}. Compile: ${result.compile.status} (${result.compile.message}).`),
      )
      await hooks.openFile(result.restored[0]!)
    } catch (error) {
      box.append(line(`Undo failed: ${String(error)}`))
    }
  }

  async function review(): Promise<void> {
    const selection = hooks.selection()
    reviewButton.disabled = true
    body.replaceChildren()
    status.textContent = 'Building semantic snapshot and asking the on-device model…'
    const started = Date.now()
    try {
      const result = await StudioApiClient.agentPoc<ReviewResult>('review', {
        renderId: selection?.renderId,
        scenario: hooks.activeScenario(),
        viewName: viewInput.value.trim(),
      })
      status.textContent = result.status === 'ok'
        ? `Reviewed ${result.viewName} in ${((Date.now() - started) / 1000).toFixed(1)}s · model ${
          (result.elapsedMs / 1000).toFixed(1)
        }s · ${result.toolCalls.length} tool calls · prompt ${result.promptChars} chars + tool results ${result.toolResultChars} chars`
        : `Model failure: ${result.message ?? 'unknown'}`
      renderResult(result)
    } catch (error) {
      status.textContent = `Review failed: ${String(error)}`
    } finally {
      reviewButton.disabled = false
    }
  }

  function renderResult(result: ReviewResult): void {
    const section = (title: string) => {
      const heading = document.createElement('div')
      heading.style.cssText =
        'margin:8px 0 3px;color:#9fb3a5;text-transform:uppercase;font-size:10px;letter-spacing:.06em'
      heading.textContent = title
      body.append(heading)
    }
    section('Packet given to the model (Tao facts; origin per fact)')
    const packet = document.createElement('details')
    packet.innerHTML = `<summary>${JSON.stringify(result.packet).length} chars</summary>`
    const pre = document.createElement('pre')
    pre.style.cssText =
      'white-space:pre-wrap;max-height:160px;overflow:auto;background:#0f1411;padding:6px;border-radius:6px'
    pre.textContent = JSON.stringify(result.packet, null, 1)
    packet.append(pre)
    body.append(packet)

    section('Model tool calls (progressive inquiry)')
    for (const call of result.toolCalls) {
      const details = document.createElement('details')
      details.innerHTML = `<summary>${call.name}(${
        JSON.stringify(call.arguments)
      }) → ${call.resultChars} chars</summary>`
      const out = document.createElement('pre')
      out.style.cssText =
        'white-space:pre-wrap;max-height:160px;overflow:auto;background:#0f1411;padding:6px;border-radius:6px'
      out.textContent = call.result
      details.append(out)
      body.append(details)
    }
    if (result.toolCalls.length === 0) {
      body.append(line('(none)'))
    }

    if (result.analysis !== undefined) {
      section('Model free-text analysis (phase 1, before structured conversion)')
      const analysis = document.createElement('details')
      analysis.innerHTML = `<summary>${result.analysis.length} chars</summary>`
      const text = document.createElement('div')
      text.style.cssText =
        'white-space:pre-wrap;background:#0f1411;padding:6px;border-radius:6px;max-height:160px;overflow:auto'
      text.textContent = result.analysis
      analysis.append(text)
      body.append(analysis)
    }
    for (const note of result.notes) {
      body.append(line(`note: ${note}`))
    }
    section('Findings')
    const findings = result.value?.findings ?? []
    for (const finding of findings) {
      const row = document.createElement('div')
      row.style.cssText = 'margin:3px 0;padding:5px 7px;border-radius:6px;background:#0f1411;border-left:3px solid '
        + ({ fact: '#6fb38a', inference: '#d9b45c', suggestion: '#7aa6d9' }[finding.kind] ?? '#888')
      const label = document.createElement('strong')
      label.textContent = finding.kind === 'fact'
        ? 'Model restating Tao fact'
        : finding.kind === 'inference'
        ? 'Model inference'
        : 'Model suggestion'
      row.append(label, document.createTextNode(' — ' + finding.text))
      for (const evidence of finding.evidence) {
        row.append(document.createTextNode(' '), evidenceLink(evidence, result))
      }
      body.append(row)
    }
    if (findings.length === 0) {
      body.append(line('(no findings)'))
    }

    section('Typed change request from the model')
    const change = result.value?.change
    if (change === undefined || change.operation === 'none') {
      body.append(line('none'))
      return
    }
    const request = {
      designName: result.designName,
      entry: [change.key, Number(change.value)],
      kind: 'set-design-entry',
      memberName: change.bundle,
    }
    body.append(line(JSON.stringify(request)))
    if (result.normalization !== undefined) {
      body.append(
        line(
          `Tao operand check: ${result.normalization.note}${
            result.normalization.usedByThisView === false ? ' (not used by this view)' : ''
          }`,
        ),
      )
      if (result.normalization.resolved === undefined) {
        body.append(line(`Bundles this view uses: ${result.normalization.viewStyles.join(', ')}`))
        return
      }
    }
    body.append(line(`Rationale (model): ${change.rationale}`))
    const propose = document.createElement('button')
    propose.type = 'button'
    propose.textContent = 'Ask Tao for a source proposal'
    body.append(propose)
    const proposalBox = document.createElement('div')
    body.append(proposalBox)
    propose.addEventListener('click', () => void proposeChange(request, result, proposalBox))
  }

  async function proposeChange(action: Json, result: ReviewResult, box: HTMLElement): Promise<void> {
    box.replaceChildren(line('Resolving against current source…'))
    if (result.designPath === undefined) {
      box.replaceChildren(line('No selected design found.'))
      return
    }
    try {
      const file = await StudioApiClient.file(result.designPath)
      const identity = hooks.identityFor(file)
      if (identity === undefined) {
        box.replaceChildren(line('No preview identity available yet; wait for the preview to connect.'))
        return
      }
      // Design edits do not target a render occurrence or a cell, so keep only project/app/preview/source identity.
      const plainIdentity: StudioSourceActionIdentity = {
        appName: identity.appName,
        path: identity.path,
        previewInstanceId: identity.previewInstanceId,
        project: identity.project,
        sourceVersion: identity.sourceVersion,
      }
      const operationId = crypto.randomUUID()
      const envelope = StudioInspector.singleAction({
        action: action as StudioCanonicalSourceAction,
        checkpointId: `checkpoint:${operationId}`,
        identity: plainIdentity,
        requestId: `request:${operationId}`,
      })
      const proposal = await StudioApiClient.sourceActionProposal(envelope)
      box.replaceChildren()
      const pre = document.createElement('pre')
      pre.style.cssText =
        'white-space:pre-wrap;background:#0f1411;padding:6px;border-radius:6px;max-height:200px;overflow:auto'
      pre.textContent = proposal.diff
      box.append(line(`Tao proposal for ${proposal.path} (ordinary source, formatted):`), pre)
      const apply = document.createElement('button')
      apply.type = 'button'
      apply.textContent = 'Apply, compile, and refresh preview'
      box.append(apply)
      apply.addEventListener('click', () => void applyChange(envelope, plainIdentity, proposal.path, box))
    } catch (error) {
      box.replaceChildren(line(`Proposal failed: ${String(error)}`))
    }
  }

  async function applyChange(
    envelope: unknown,
    identity: StudioSourceActionIdentity,
    path: string,
    box: HTMLElement,
  ): Promise<void> {
    box.append(line('Applying…'))
    try {
      const applied = await StudioApiClient.sourceAction(envelope)
      lastCheckpoint = { afterVersion: applied.sourceVersion, id: applied.checkpoint.id, identity, path }
      box.append(
        line(
          `Applied. Compile: ${applied.compile.status} (${applied.compile.message}). Checkpoint ${applied.checkpoint.id}.`,
        ),
      )
      await hooks.openFile(applied.path)
      const undo = document.createElement('button')
      undo.type = 'button'
      undo.textContent = 'Undo (restore exact starting source)'
      box.append(undo)
      undo.addEventListener('click', () => void undoChange(box))
    } catch (error) {
      box.append(line(`Apply failed: ${String(error)}`))
    }
  }

  async function undoChange(box: HTMLElement): Promise<void> {
    if (lastCheckpoint === undefined) {
      return
    }
    try {
      const result = await StudioApiClient.undoSourceAction(StudioInspector.undo({
        checkpointId: lastCheckpoint.id,
        identity: { ...lastCheckpoint.identity, sourceVersion: lastCheckpoint.afterVersion },
        requestId: `undo:${crypto.randomUUID()}`,
      }))
      box.append(
        line(
          `Undone. Compile: ${result.compile.status} (${result.compile.message}). Source version ${result.sourceVersion}.`,
        ),
      )
      await hooks.openFile(result.path)
      lastCheckpoint = undefined
    } catch (error) {
      box.append(line(`Undo failed: ${String(error)}`))
    }
  }

  function evidenceLink(evidence: string, result: ReviewResult): HTMLElement {
    const link = document.createElement('a')
    link.href = '#'
    link.style.cssText = 'color:#8fc7a6;margin-right:4px'
    link.textContent = `[${evidence}]`
    link.title = 'Open the source this evidence points at'
    link.addEventListener('click', event => {
      event.preventDefault()
      const source = /src:([^\s:]+):(\d+)-(\d+)/.exec(evidence) ?? /render:([^\s:]+):(\d+):(\d+)/.exec(evidence)
      if (source !== null) {
        void hooks.openFile(source[1]!, Number(source[2]))
        return
      }
      const packet = result.packet
      const known = typeof packet['source'] === 'string' && evidence === packet['id']
        ? /^src:(.+):(\d+)-(\d+)$/.exec(packet['source'] as string)
        : null
      if (known !== null) {
        void hooks.openFile(known[1]!, Number(known[2]))
        return
      }
      void StudioApiClient.agentPoc<Json>('inspect', { target: evidence }).then(info => {
        const match = typeof info['source'] === 'string' ? /^src:(.+):(\d+)-(\d+)$/.exec(info['source']) : null
        if (match !== null) {
          void hooks.openFile(match[1]!, Number(match[2]))
        }
      })
    })
    return link
  }
}

function line(text: string): HTMLElement {
  const element = document.createElement('div')
  element.style.cssText = 'margin:2px 0'
  element.textContent = text
  return element
}
