// Semantic agent proof of concept: a fixed overlay panel in the Studio page. Deliberately plain DOM,
// inline styles, and no Tao/React portal involvement; it exists to make the flow observable.
import { StudioInspector } from '../StudioInspector'
import type { StudioCanonicalSourceAction, StudioSourceActionIdentity } from '../StudioProtocol'
import type { StudioInspectorSelection } from '../StudioInspector'
import { StudioApiClient } from '../client/StudioApiClient'

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
  const panel = document.createElement('section')
  panel.className = 'studio-agent-poc'
  panel.setAttribute('aria-label', 'Semantic agent proof of concept')
  panel.style.cssText = 'position:fixed;right:12px;bottom:12px;width:460px;max-height:70vh;overflow:auto;background:#151a17;color:#e8ede9;border:1px solid #3a4a3f;border-radius:10px;padding:10px 12px;font:12px/1.45 ui-monospace,Menlo,monospace;z-index:9000;box-shadow:0 8px 24px rgba(0,0,0,.4)'
  panel.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <strong style="flex:1">Local agent (PoC)</strong>
      <input class="poc-view" placeholder="view (uses selection)" style="width:150px;background:#0f1411;color:#e8ede9;border:1px solid #3a4a3f;border-radius:6px;padding:3px 6px;font:inherit">
      <button class="poc-review" type="button">Review</button>
      <button class="poc-toggle" type="button" title="Collapse">–</button>
    </div>
    <div class="poc-status" style="color:#9fb3a5">Select a render in the preview, then Review. Inference runs on-device through Apple Foundation Models.</div>
    <div class="poc-body"></div>
  `
  root.append(panel)
  const status = panel.querySelector<HTMLElement>('.poc-status')!
  const body = panel.querySelector<HTMLElement>('.poc-body')!
  const viewInput = panel.querySelector<HTMLInputElement>('.poc-view')!
  const reviewButton = panel.querySelector<HTMLButtonElement>('.poc-review')!
  const toggle = panel.querySelector<HTMLButtonElement>('.poc-toggle')!
  toggle.addEventListener('click', () => {
    body.hidden = !body.hidden
    status.hidden = body.hidden
    toggle.textContent = body.hidden ? '+' : '–'
  })

  let lastCheckpoint: { id: string; identity: StudioSourceActionIdentity; path: string; afterVersion: string } | undefined

  reviewButton.addEventListener('click', () => void review())

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
        ? `Reviewed ${result.viewName} in ${((Date.now() - started) / 1000).toFixed(1)}s · model ${(result.elapsedMs / 1000).toFixed(1)}s · ${result.toolCalls.length} tool calls · prompt ${result.promptChars} chars + tool results ${result.toolResultChars} chars`
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
      heading.style.cssText = 'margin:8px 0 3px;color:#9fb3a5;text-transform:uppercase;font-size:10px;letter-spacing:.06em'
      heading.textContent = title
      body.append(heading)
    }
    section('Packet given to the model (Tao facts; origin per fact)')
    const packet = document.createElement('details')
    packet.innerHTML = `<summary>${JSON.stringify(result.packet).length} chars</summary>`
    const pre = document.createElement('pre')
    pre.style.cssText = 'white-space:pre-wrap;max-height:160px;overflow:auto;background:#0f1411;padding:6px;border-radius:6px'
    pre.textContent = JSON.stringify(result.packet, null, 1)
    packet.append(pre)
    body.append(packet)

    section('Model tool calls (progressive inquiry)')
    for (const call of result.toolCalls) {
      const details = document.createElement('details')
      details.innerHTML = `<summary>${call.name}(${JSON.stringify(call.arguments)}) → ${call.resultChars} chars</summary>`
      const out = document.createElement('pre')
      out.style.cssText = 'white-space:pre-wrap;max-height:160px;overflow:auto;background:#0f1411;padding:6px;border-radius:6px'
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
      text.style.cssText = 'white-space:pre-wrap;background:#0f1411;padding:6px;border-radius:6px;max-height:160px;overflow:auto'
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
      row.style.cssText = 'margin:3px 0;padding:5px 7px;border-radius:6px;background:#0f1411;border-left:3px solid ' + ({ fact: '#6fb38a', inference: '#d9b45c', suggestion: '#7aa6d9' }[finding.kind] ?? '#888')
      const label = document.createElement('strong')
      label.textContent = finding.kind === 'fact' ? 'Model restating Tao fact' : finding.kind === 'inference' ? 'Model inference' : 'Model suggestion'
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
    const request = { designName: result.designName, entry: [change.key, Number(change.value)], kind: 'set-design-entry', memberName: change.bundle }
    body.append(line(JSON.stringify(request)))
    if (result.normalization !== undefined) {
      body.append(line(`Tao operand check: ${result.normalization.note}${result.normalization.usedByThisView === false ? ' (not used by this view)' : ''}`))
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
      pre.style.cssText = 'white-space:pre-wrap;background:#0f1411;padding:6px;border-radius:6px;max-height:200px;overflow:auto'
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

  async function applyChange(envelope: unknown, identity: StudioSourceActionIdentity, path: string, box: HTMLElement): Promise<void> {
    box.append(line('Applying…'))
    try {
      const applied = await StudioApiClient.sourceAction(envelope)
      lastCheckpoint = { afterVersion: applied.sourceVersion, id: applied.checkpoint.id, identity, path }
      box.append(line(`Applied. Compile: ${applied.compile.status} (${applied.compile.message}). Checkpoint ${applied.checkpoint.id}.`))
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
      box.append(line(`Undone. Compile: ${result.compile.status} (${result.compile.message}). Source version ${result.sourceVersion}.`))
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
      const known = typeof packet['source'] === 'string' && evidence === packet['id'] ? /^src:(.+):(\d+)-(\d+)$/.exec(packet['source'] as string) : null
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
