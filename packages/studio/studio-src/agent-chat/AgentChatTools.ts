// Studio agent chat: the entire surface the model can act through.
//
// The model gets no shell, no script runner, and no filesystem path. It names declarations; Tao resolves where
// they live. Every tool here is total: it validates its operands against the semantic graph and returns a
// refusal a model can read, rather than throwing or reaching for something it was not given.

import { jsonSchema, tool, type ToolSet } from 'ai'
import {
  fieldStory,
  inspect,
  overview,
  resolveTarget,
  type SemanticSnapshot,
  trace,
} from '../agent-poc/SemanticSnapshot'
import type { StudioTestRun } from '../StudioTestRunner'
import { declarationSource, fileOutlines, improvementFacts } from './AgentChatFacts'

export type AgentChatFile = { path: string; content: string }

/** AgentChatWorld is everything the tools may touch. Nothing reaches past this. */
export type AgentChatWorld = {
  snapshot: () => Promise<SemanticSnapshot>
  files: () => Promise<readonly AgentChatFile[]>
  /** The app's own behavior tests. Slow, so a tool description says so and the model is told to use it sparingly. */
  runTests?: () => Promise<StudioTestRun>
  testStatus?: () => StudioTestRun | undefined
  /** Studio's real compile state, which sees validator errors the snapshot's parse does not. */
  compile?: () => { status: string; diagnostics: readonly { message: string; filePath?: string }[] }
}

/** A record of one tool call, kept for the transcript the panel renders and the run log on disk. */
export type AgentChatToolCall = {
  name: string
  input: unknown
  summary: string
  resultChars: number
}

const NO_ARGS = { additionalProperties: false, properties: {}, type: 'object' } as const

function objectSchema<Input>(properties: Record<string, unknown>, required: readonly string[]) {
  return jsonSchema<Input>({ additionalProperties: false, properties, required: [...required], type: 'object' })
}

const TEXT = (description: string) => ({ description, type: 'string' })

/**
 * refusal is how a tool says no. The model reads it and adapts; nothing throws, because a thrown tool is a
 * dead turn rather than a correction.
 */
function refusal(message: string, options: { known?: readonly string[] } = {}): Record<string, unknown> {
  return {
    refused: message,
    ...(options.known === undefined ? {} : { known: options.known.slice(0, 40) }),
  }
}

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
        'Facts about this app that are true and unusual: views no scenario covers, actions nothing invokes, fields nothing reads, design bundles nothing uses, compile problems. Use these to ground any suggestion about what to improve or build next. Each fact carries the evidence it came from; cite that evidence when you use it.',
      execute: async () => {
        const snapshot = await world.snapshot()
        const facts = improvementFacts(snapshot, world.compile?.())
        return capture('improvementFacts', {}, {
          facts,
          note: facts.length === 0
            ? 'Nothing unusual was found. Say so rather than inventing a suggestion.'
            : 'These are facts, not recommendations. Judge which matter and say why.',
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
        return capture('runTests', {}, {
          failed: run.failed,
          failures: run.failures.map(failure => ({ message: failure.message, name: failure.name })),
          passed: run.passed,
          status: run.status,
        })
      },
      inputSchema: jsonSchema<Record<string, never>>(NO_ARGS),
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
