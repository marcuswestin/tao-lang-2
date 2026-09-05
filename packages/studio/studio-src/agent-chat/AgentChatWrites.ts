// Studio agent chat: the tools that can change the app, and the two steps every change goes through.
//
// A change is proposed first and applied second, always. Proposing computes the exact source, formats it, and
// puts the diff in the transcript where a person can read it; applying is the step that pauses for approval.
// The alternative — one tool that computes and writes together — asks a person to approve an argument list
// rather than a change, which is not consent to anything they have seen.

import Formatter from '@formatter'
import { jsonSchema, tool, type ToolSet } from 'ai'
import { lowerFeature, lowerReword, textCandidates } from '../agent-poc/FeaturePlan'
import { resolveTarget } from '../agent-poc/SemanticSnapshot'
import { StudioProjectSession } from '../StudioProjectSession'
import { declarationSource } from './AgentChatFacts'
import { objectSchema, refusal, TEXT } from './AgentChatSchema'
import { requireOnly } from './AgentChatScope'
import type { AgentChatToolCall, AgentChatWorld } from './AgentChatTools'

/** A change that has been computed and shown, and is waiting to be approved. */
export type StagedChange = {
  id: string
  summary: string
  edits: readonly { path: string; before: string; after: string; diff: string }[]
  /** The versions this change was computed against, so applying it can refuse a file that moved underneath. */
  expect: readonly { path: string; sourceVersion: string }[]
}

export type AgentChatWriteWorld = AgentChatWorld & {
  /**
   * The verdict on a change that just landed, judged by the app's own tests against the last run taken
   * before it. Reported by the tool so the model must read it, and by the turn so the panel can show it.
   */
  verdict?: () => Promise<{ heading: string; status: string; broke: readonly { name: string }[] } | undefined>
  /** Applies a staged change as one mutation: compiled once, rolled back whole if the compile fails. */
  apply: (change: StagedChange) => Promise<{ status: string; message: string; rolledBack: boolean }>
  undo: () => Promise<{ status: string; message: string; restored: readonly string[] }>
  /**
   * The version of the content `files()` returned this turn — not a fresh read. A fresh read would hand the
   * precondition the version of an edit made after the change was computed, and applying would then overwrite
   * that edit while believing it had checked for exactly this.
   */
  sourceVersionOf: (path: string) => Promise<string>
}

const diffOf = StudioProjectSession.testing.sourceActionProposalDiff

/**
 * writeTools carry the change surface. `applyChange` and `undoLastChange` are the only two that touch the
 * project, and both are named in the approval list so neither can run without a person saying yes.
 */
export function stageChange(
  world: AgentChatWriteWorld,
  staged: Map<string, StagedChange>,
): (summary: string, edits: readonly { path: string; before: string; after: string }[]) => Promise<
  Record<string, unknown>
> {
  // Not `staged.size`: applying removes an entry, so the next proposal reused a live id and overwrote a
  // change the model still intended to apply, silently.
  let issued = 0
  return async (summary, edits) => {
    const real = edits.filter(edit => edit.before !== edit.after)
    if (real.length === 0) {
      return refusal('That produces no change: the source already reads that way.')
    }
    issued += 1
    const id = `change-${issued}`
    staged.set(id, {
      edits: real.map(edit => ({ ...edit, diff: diffOf(edit.path, edit.before, edit.after) })),
      expect: await Promise.all(real.map(async edit => ({
        path: edit.path,
        sourceVersion: await world.sourceVersionOf(edit.path),
      }))),
      id,
      summary,
    })
    return {
      changeId: id,
      diff: real.map(edit => `${edit.path}\n${diffOf(edit.path, edit.before, edit.after)}`).join('\n\n'),
      files: real.map(edit => edit.path),
      next: `Call applyChange with changeId ${id} to apply this. A person must approve it first.`,
      summary,
    }
  }
}

export function writeTools(
  world: AgentChatWriteWorld,
  staged: Map<string, StagedChange>,
  record: (call: AgentChatToolCall) => void,
  /**
   * The literal each text handle was issued for. Handles are positional (`T1`, `T2`, ...), so one applied
   * change repoints every one of them; a model still holding an old handle would reword a line it never
   * looked at, and the reword guardrail would happily validate the wrong line. Remembering what a handle
   * was issued against turns that from a warning in a description into a refusal.
   */
  issued: Map<string, string> = new Map(),
): ToolSet {
  const capture = (name: string, input: unknown, result: unknown): unknown => {
    record({
      input,
      name,
      resultChars: JSON.stringify(result ?? null).length,
      summary: JSON.stringify(result).slice(0, 160),
    })
    return result
  }

  /** stage records a computed change and returns what the model (and the person) should see of it. */
  const stage = stageChange(world, staged)

  return {
    applyChange: tool({
      description:
        'Apply a change you proposed earlier, by its changeId. Studio writes every file as one change, compiles once, and restores all of them if the compile fails. A person must approve this before it runs.',
      execute: async ({ changeId }: { changeId: string }) => {
        const change = staged.get(changeId)
        if (change === undefined) {
          return capture('applyChange', { changeId }, refusal(`No change is staged under "${changeId}".`))
        }
        try {
          const result = await world.apply(change)
          staged.delete(changeId)
          // Text handles are positional, so a change that lands repoints them all.
          issued.clear()
          const verdict = result.rolledBack ? undefined : await world.verdict?.()
          return capture('applyChange', { changeId }, {
            applied: !result.rolledBack,
            compile: result.status,
            message: result.message,
            ...(result.rolledBack
              ? { note: 'The compile failed, so every file was restored. Read the message and propose a fix.' }
              : {}),
            ...(verdict === undefined ? {} : {
              tests: verdict.heading,
              ...(verdict.status === 'broke'
                ? {
                  broke: verdict.broke.map(test => test.name),
                  note:
                    'This change broke tests the app passed before it. Say so before describing what you built, and offer to undo it.',
                }
                : {}),
            }),
          })
        } catch (error) {
          // A conflict means a file moved under the change. Re-proposing against current source is the fix.
          return capture(
            'applyChange',
            { changeId },
            refusal(
              `${
                String(error instanceof Error ? error.message : error)
              } Re-read the declaration and propose the change again.`,
            ),
          )
        }
      },
      inputSchema: objectSchema<{ changeId: string }>({ changeId: TEXT('The changeId from a propose tool.') }, [
        'changeId',
      ]),
    }),

    proposeEdit: tool({
      description:
        "Replace one declaration's whole source text with new Tao. Use this only when no other propose tool fits: it is the one place you write Tao yourself, and Tao has a syntax you have not seen. Read the declaration first, keep the change small, and expect to be corrected by the compiler.",
      execute: async ({ declaration, replacement }: { declaration: string; replacement: string }) => {
        const [snapshot, files] = await Promise.all([world.snapshot(), world.files()])
        const node = resolveTarget(snapshot, declaration)
        if (node === undefined) {
          return capture('proposeEdit', { declaration }, refusal(`No declaration named "${declaration}".`))
        }
        const source = declarationSource(files, node)
        if (source === undefined || node.start === undefined || node.end === undefined) {
          return capture('proposeEdit', { declaration }, refusal(`${declaration} has no source range to replace.`))
        }
        const before = files.find(file => file.path === source.path)?.content ?? ''
        const merged = before.slice(0, node.start) + replacement + before.slice(node.end)
        let after: string
        try {
          // Formatting is the first check: source the formatter cannot parse never reaches the project.
          after = await Formatter.formatCode(merged)
        } catch (error) {
          return capture(
            'proposeEdit',
            { declaration },
            refusal(
              `That is not valid Tao: ${String(error instanceof Error ? error.message : error)}`,
              { youWrote: replacement },
            ),
          )
        }
        // The tool named one declaration; the edit may change nothing else. Without this gate an
        // approved raw edit could add or remove declarations the diff alone had to catch.
        const outOfScope = await requireOnly(before, after, [], [`${node.kind} ${node.name}`])
        if (outOfScope !== undefined) {
          return capture('proposeEdit', { declaration }, refusal(outOfScope))
        }
        return capture(
          'proposeEdit',
          { declaration, replacement },
          await stage(`replace ${declaration}`, [{ after, before, path: source.path }]),
        )
      },
      inputSchema: objectSchema<{ declaration: string; replacement: string }>({
        declaration: TEXT('The declaration to replace, by name.'),
        replacement: TEXT('The complete new source for that declaration, including its header line.'),
      }, ['declaration', 'replacement']),
    }),

    proposeFlag: tool({
      description:
        'Add a yes/no field to an entity and a checkbox that turns it on and off, placed the way this app already places such a field. Tao decides where every part goes; you only name what the flag is.',
      execute: async (
        { entity, field, label, view }: { entity: string; field: string; label: string; view: string },
      ) => {
        const [snapshot, files] = await Promise.all([world.snapshot(), world.files()])
        const problems: string[] = []
        const plan = await lowerFeature(
          snapshot,
          {
            entity,
            featureName: label,
            fieldKind: 'yes/no',
            fieldName: field,
            label,
            presentIn: view,
            scenarioName: label,
            summary: `add ${entity}.${field} and show it in ${view}`,
          },
          async path => files.find(file => file.path === path)?.content ?? '',
          problems,
        )
        if (plan.edits.length === 0) {
          return capture(
            'proposeFlag',
            { entity, field, view },
            refusal(
              problems.join('; ') || 'Tao could not place that flag from this app’s structure.',
            ),
          )
        }
        return capture(
          'proposeFlag',
          { entity, field, label, view },
          {
            ...(await stage(`add ${entity}.${field} and show it in ${view}`, plan.edits)),
            placements: plan.steps.map(step => `${step.action} [decided by ${step.decidedBy}]`),
            ...(problems.length === 0 ? {} : { problems }),
          },
        )
      },
      inputSchema: objectSchema<{ entity: string; field: string; label: string; view: string }>({
        entity: TEXT('The entity that gains the field, by its declared collection name.'),
        field: TEXT('The new field name, capitalised, for example Bookmarked.'),
        label: TEXT('What the checkbox says on screen.'),
        view: TEXT('The view that shows the checkbox.'),
      }, ['entity', 'field', 'label', 'view']),
    }),

    proposeReword: tool({
      description:
        'Change the wording of text a view already shows. Call listTexts first to get the handle of the line you mean. You may only use placeholders that the original line already has, or fields of an entity the view takes.',
      execute: async ({ newText, textHandle }: { newText: string; textHandle: string }) => {
        const [snapshot, files] = await Promise.all([world.snapshot(), world.files()])
        const candidates = textCandidates(snapshot)
        const issuedFor = issued.get(textHandle)
        const now = candidates.find(candidate => candidate.handle === textHandle)
        if (issuedFor === undefined) {
          return capture(
            'proposeReword',
            { newText, textHandle },
            refusal(`${textHandle} was not issued in this conversation. Call listTexts and use a handle from it.`),
          )
        }
        if (now === undefined || now.text !== issuedFor) {
          issued.clear()
          return capture(
            'proposeReword',
            { newText, textHandle },
            refusal(
              `${textHandle} no longer names ${issuedFor}: the source changed since you listed it. Call listTexts again and use a fresh handle.`,
            ),
          )
        }
        const problems: string[] = []
        const plan = await lowerReword(
          snapshot,
          candidates,
          { featureName: `reword ${textHandle}`, newText, summary: `reword ${textHandle}`, textHandle },
          async path => files.find(file => file.path === path)?.content ?? '',
          problems,
        )
        if (plan.edits.length === 0) {
          return capture(
            'proposeReword',
            { newText, textHandle },
            refusal(problems.join('; ') || 'That reword was refused.'),
          )
        }
        return capture(
          'proposeReword',
          { newText, textHandle },
          await stage(`reword ${textHandle}`, plan.edits),
        )
      },
      inputSchema: objectSchema<{ newText: string; textHandle: string }>({
        newText: TEXT('The replacement text, without surrounding quotes.'),
        textHandle: TEXT('The handle of the line to change, from listTexts.'),
      }, ['newText', 'textHandle']),
    }),

    listTexts: tool({
      description:
        'Every piece of text the app shows on screen, with a handle for each. Call this before proposing a reword; the handles are only valid until a change is applied.',
      execute: async () => {
        const snapshot = await world.snapshot()
        const candidates = textCandidates(snapshot)
        issued.clear()
        for (const candidate of candidates) {
          issued.set(candidate.handle, candidate.text)
        }
        return capture('listTexts', {}, {
          texts: candidates.map(candidate => ({
            handle: candidate.handle,
            text: candidate.text,
            view: candidate.view,
          })),
        })
      },
      inputSchema: jsonSchema<Record<string, never>>({
        additionalProperties: false,
        properties: {},
        type: 'object',
      }),
    }),

    undoLastChange: tool({
      description: 'Restore every file the last applied change touched. A person must approve this before it runs.',
      execute: async () => {
        try {
          const result = await world.undo()
          return capture('undoLastChange', {}, {
            compile: result.status,
            message: result.message,
            restored: result.restored,
          })
        } catch (error) {
          return capture(
            'undoLastChange',
            {},
            refusal(String(error instanceof Error ? error.message : error)),
          )
        }
      },
      inputSchema: jsonSchema<Record<string, never>>({
        additionalProperties: false,
        properties: {},
        type: 'object',
      }),
    }),
  }
}

/** The tools that may never run until a person says yes. */
export const APPROVAL_REQUIRED = ['applyChange', 'undoLastChange'] as const
