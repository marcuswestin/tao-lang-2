// Studio agent chat: the entire surface the model can act through.
//
// The model gets no shell, no script runner, and no filesystem path. It names declarations; Tao resolves where
// they live. Every tool here is total: it validates its operands against the semantic graph and returns a
// refusal a model can read, rather than throwing or reaching for something it was not given.

import { jsonSchema, tool, type ToolSet } from 'ai'
import type { TestRunSummary } from '../agent-poc/FeatureVerdict'
import {
  fieldStory,
  inspect,
  overview,
  resolveTarget,
  type SemanticSnapshot,
  trace,
} from '../agent-poc/SemanticSnapshot'
import { parseChecks, viewCoverage } from './AgentChatCoverage'
import { declarationSource, fileOutlines, improvementFacts } from './AgentChatFacts'
import { taoGuarantees } from './AgentChatGuarantees'
import { findSpec, specSections } from './AgentChatReference'
import { objectSchema, refusal, TEXT } from './AgentChatSchema'

type AgentChatFile = { path: string; content: string; sourceVersion?: string }

/** AgentChatWorld is everything the tools may touch. Nothing reaches past this. */
export type AgentChatWorld = {
  snapshot: () => Promise<SemanticSnapshot>
  files: () => Promise<readonly AgentChatFile[]>
  /** The app's own behavior tests. Slow, so a tool description says so and the model is told to use it sparingly. */
  runTests?: () => Promise<TestRunSummary | undefined>
  testStatus?: () => TestRunSummary | undefined
  /** Studio's real compile state, which sees validator errors the snapshot's parse does not. */
  compile?: () => { status: string; diagnostics: readonly { message: string; filePath?: string }[] }
  /** The app's `.test.tao` sidecars, which the semantic graph never sees. */
  testSources?: () => Promise<readonly AgentChatFile[]>
}

/** A record of one tool call, kept for the transcript the panel renders and the run log on disk. */
export type AgentChatToolCall = {
  name: string
  input: unknown
  summary: string
  resultChars: number
}

const NO_ARGS = { additionalProperties: false, properties: {}, type: 'object' } as const

function summarize(value: unknown, limit = 160): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const collapsed = (text ?? '').replace(/\s+/g, ' ').trim()
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit - 1)}…`
}

/**
 * readTools are the story-one surface: everything needed to answer a question about an app, and nothing that
 * can change it. They are also the base of every other mode, because an agent that cannot look has nothing to
 * decide from.
 */
export function readTools(world: AgentChatWorld, record: (call: AgentChatToolCall) => void): ToolSet {
  const capture = (name: string, input: unknown, result: unknown): unknown => {
    record({ input, name, resultChars: JSON.stringify(result ?? null).length, summary: summarize(result) })
    return result
  }

  return {
    coverageOfTests: tool({
      description:
        "Which of the app's tests exist and what they are named, plus the last run result if there is one. Does not run anything.",
      execute: async () => {
        const status = world.testStatus?.()
        return capture('coverageOfTests', {}, {
          lastRun: status === undefined ? 'never run in this session' : {
            failed: status.failed,
            failures: status.failures.map(failure => failure.name),
            passed: status.passed,
            status: status.status,
          },
        })
      },
      inputSchema: jsonSchema<Record<string, never>>(NO_ARGS),
    }),

    coverageOfView: tool({
      description:
        "What one view shows on screen, and which of the app's checks exercise each piece of it. Use this to find what is untested before proposing a test. Match is textual, and the result says so.",
      execute: async ({ view }: { view: string }) => {
        const snapshot = await world.snapshot()
        const node = resolveTarget(snapshot, view)
        if (node === undefined || node.kind !== 'view') {
          return capture(
            'coverageOfView',
            { view },
            refusal(`No view named "${view}".`, {
              known: [...snapshot.nodes.values()].filter(entry => entry.kind === 'view').map(entry => entry.name),
            }),
          )
        }
        const sources = (await world.testSources?.()) ?? []
        const checks = sources.flatMap(file => parseChecks(file.content))
        return capture('coverageOfView', { view }, viewCoverage(snapshot, node, checks))
      },
      inputSchema: objectSchema<{ view: string }>({ view: TEXT('The view to review, by name.') }, ['view']),
    }),

    fieldStory: tool({
      description:
        'Everything the app does with one entity field: where it is declared, what reads it, what writes it, and what renders it. Name it as Entity.Field.',
      execute: async ({ field }: { field: string }) => {
        const snapshot = await world.snapshot()
        return capture('fieldStory', { field }, fieldStory(snapshot, field))
      },
      inputSchema: objectSchema<{ field: string }>({
        field: TEXT('The field, written as Entity.Field, for example Story.Title.'),
      }, [
        'field',
      ]),
    }),

    fileOutline: tool({
      description:
        'The declarations in every source file of the project, in order, with their line numbers. Use this to answer questions about how the app is structured across files.',
      execute: async () => {
        const [snapshot, files] = await Promise.all([world.snapshot(), world.files()])
        return capture('fileOutline', {}, { files: fileOutlines(snapshot, files) })
      },
      inputSchema: jsonSchema<Record<string, never>>(NO_ARGS),
    }),

    improvementFacts: tool({
      description:
        'Facts about this app that are true and unusual, and — just as important — the relations this graph cannot see well enough to judge. Use these to ground any suggestion about what to improve or build next. Each fact says where it came from and whether it rests on the compiler or on name matching; cite that when you use it, and do not make a suggestion this returns nothing to support.',
      execute: async () => {
        const [snapshot, files] = await Promise.all([world.snapshot(), world.files()])
        const facts = improvementFacts(snapshot, world.compile?.(), files)
        const usable = facts.filter(fact => fact.kind !== 'relation-not-modelled')
        return capture('improvementFacts', {}, {
          facts,
          note: usable.length === 0
            ? 'Nothing here supports a suggestion about this app. Say that plainly — say which relations this graph cannot see, and offer to look at something specific instead. Do not fall back on what is usually true of apps.'
            : 'These are facts, not recommendations. Judge which matter and say why, and cite the evidence line. A fact marked `poc-derived` comes from name matching rather than the compiler, so treat it as a strong hint and check it before relying on it.',
        })
      },
      inputSchema: jsonSchema<Record<string, never>>(NO_ARGS),
    }),

    inspect: tool({
      description:
        'Everything the semantic graph knows about one declaration: a view, entity, field, action, query, design bundle, or scenario. Name it exactly as it is declared.',
      execute: async ({ name }: { name: string }) => {
        const snapshot = await world.snapshot()
        const found = resolveTarget(snapshot, name)
        if (found === undefined) {
          return capture(
            'inspect',
            { name },
            refusal(`No declaration named "${name}". Call overview to see what this app declares.`, {
              known: [...snapshot.nodes.values()]
                .filter(node => ['action', 'entity', 'query', 'view'].includes(node.kind))
                .map(node => node.name),
            }),
          )
        }
        return capture('inspect', { name }, inspect(snapshot, name))
      },
      inputSchema: objectSchema<{ name: string }>({
        name: TEXT('The exact declared name, for example StoryRow or OpenStory.'),
      }, [
        'name',
      ]),
    }),

    overview: tool({
      description:
        "The shape of the whole app in one packet: its entities and their fields, its views with per-view counts of renders, states, queries and scenarios, its design and that design's bundles, and a count of parse diagnostics. Start here, then use inspect for anything it only counts.",
      execute: async () => {
        const snapshot = await world.snapshot()
        return capture('overview', {}, overview(snapshot))
      },
      inputSchema: jsonSchema<Record<string, never>>(NO_ARGS),
    }),

    readSource: tool({
      description:
        'The Tao source text of one declaration, by name. There is no way to read a file by path: name the declaration and Tao finds it.',
      execute: async ({ name }: { name: string }) => {
        const [snapshot, files] = await Promise.all([world.snapshot(), world.files()])
        const found = resolveTarget(snapshot, name)
        if (found === undefined) {
          return capture('readSource', { name }, refusal(`No declaration named "${name}".`))
        }
        const source = declarationSource(files, found)
        if (source === undefined) {
          return capture(
            'readSource',
            { name },
            refusal(`${name} has no source range in the graph; inspect it instead.`),
          )
        }
        return capture('readSource', { name }, source)
      },
      inputSchema: objectSchema<{ name: string }>({ name: TEXT('The exact declared name.') }, ['name']),
    }),

    runTests: tool({
      description:
        "Run the app's own behavior tests and report what passed and failed. This is slow: run it when you need a verdict, not to explore.",
      execute: async () => {
        if (world.runTests === undefined) {
          return capture('runTests', {}, refusal('This session cannot run tests.'))
        }
        const run = await world.runTests()
        if (run === undefined) {
          return capture('runTests', {}, refusal('This Studio session has no test runtime.'))
        }
        return capture('runTests', {}, {
          failed: run.failed,
          failures: run.failures.map(failure => ({ message: failure.message, name: failure.name })),
          passed: run.passed,
          status: run.status,
        })
      },
      inputSchema: jsonSchema<Record<string, never>>(NO_ARGS),
    }),

    taoGuarantees: tool({
      description:
        'What Tao already guarantees for an app, so you do not write a test for something that cannot happen — and what only looks guaranteed. Call this before proposing any test. An entry marked `not-testable-yet` must never be reported as covered.',
      execute: async ({ area }: { area?: string }) => capture('taoGuarantees', { area }, taoGuarantees(area)),
      inputSchema: jsonSchema<{ area?: string }>({
        additionalProperties: false,
        properties: { area: TEXT('Narrow to one area, for example "time", "guards", "emptiness". Omit for all.') },
        type: 'object',
      }),
    }),

    taoReference: tool({
      description:
        'Look up how Tao itself works, from the language specification. Use this before writing any Tao: you have not seen this language, and the spec is the only account of what it actually implements. Name a topic, for example "scenario", "checkbox", "query", "fixture" or "test".',
      execute: async ({ topic }: { topic: string }) => {
        const found = findSpec(await specSections(), topic)
        return capture('taoReference', { topic }, {
          note: found.note,
          sections: found.sections.map(section => ({
            deferralWarning: section.carriesDeferral
              ? 'This section marks part of what it describes as not implemented.'
              : undefined,
            from: `Docs/Spec/${section.file}.md § ${section.heading}`,
            text: section.text,
          })),
        })
      },
      inputSchema: objectSchema<{ topic: string }>({ topic: TEXT('What to look up, in a word or two.') }, [
        'topic',
      ]),
    }),

    trace: tool({
      description:
        'Follow one relationship out of a declaration. Relationships: renders, styled-by, writes, reads, invokes, covers, uses-design, declares, queries.',
      execute: async ({ name, relationship }: { name: string; relationship: string }) => {
        const snapshot = await world.snapshot()
        if (resolveTarget(snapshot, name) === undefined) {
          return capture('trace', { name, relationship }, refusal(`No declaration named "${name}".`))
        }
        return capture('trace', { name, relationship }, trace(snapshot, name, relationship))
      },
      inputSchema: objectSchema<{ name: string; relationship: string }>({
        name: TEXT('The exact declared name to start from.'),
        relationship: TEXT(
          'One of renders, styled-by, writes, reads, invokes, covers, uses-design, declares, queries.',
        ),
      }, ['name', 'relationship']),
    }),
  }
}
