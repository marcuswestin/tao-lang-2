import { Text } from '@shared/core'
// Studio agent chat: describing a state you want to develop against, and pinning behavior with a check.
//
// Both are ordinary Tao source, so both go through the same propose-then-apply path as any other change. What
// is different is the gate: this mode may author scenarios, fixtures and tests, and nothing else. When the
// state a person asked for cannot be reached without changing the app itself, the agent has to say so and get
// an answer, because "show me the empty feed" and "make the feed able to be empty" are different requests and
// only one of them was made.

import Formatter from '@formatter'
import { jsonSchema, tool, type ToolSet } from 'ai'
import { LIST, objectSchema, refusal, TEXT } from './AgentChatSchema'
import { requireOnly } from './AgentChatScope'
import type { AgentChatToolCall } from './AgentChatTools'
import type { AgentChatWriteWorld } from './AgentChatWrites'
import { resolveTarget } from './SemanticSnapshot'

export type CodeChangeRequest = { reason: string; missing: string }

/**
 * authoringTools are the scenario-and-test surface. `stage` is shared with the write tools so an authored
 * scenario is approved and applied exactly like any other change.
 */
export function authoringTools(
  world: AgentChatWriteWorld,
  stage: (summary: string, edits: readonly { path: string; before: string; after: string }[]) => Promise<
    Record<string, unknown>
  >,
  requests: CodeChangeRequest[],
  record: (call: AgentChatToolCall) => void,
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

  return {
    listTestFiles: tool({
      description:
        "The app's test files and the checks each already has. Read this before proposing a test, so you add to the suite that exists rather than inventing a second one.",
      execute: async () => {
        const sources = (await world.testSources?.()) ?? []
        return capture('listTestFiles', {}, {
          files: sources.map(file => ({
            path: file.path,
            // A suite is a `test` at the start of a line; the checks inside it are indented. Matching both
            // handed the model a check name to pass back as a suite.
            suites: [...file.content.matchAll(/^test\s+"([^"]*)"\s*\{/gm)].map(match => match[1]),
            checks: [...file.content.matchAll(/^\s+test\s+"([^"]*)"\s*\{/gm)].map(match => match[1]),
          })),
          ...(sources.length === 0
            ? { note: 'This app has no test file yet. Say so before proposing one, and where it would go.' }
            : {}),
        })
      },
      inputSchema: jsonSchema<Record<string, never>>({ additionalProperties: false, properties: {}, type: 'object' }),
    }),

    proposeScenario: tool({
      description:
        'Add a fixture and a scenario so a view can be seen in one exact state in the preview grid. The fixture holds the rows; the scenario renders the view with them. Look at an existing fixture and scenarios block with readSource first and follow its shape.',
      execute: async (
        { fixtureName, groupName, rows, scenarioName, view }: {
          fixtureName: string
          groupName: string
          rows: string[]
          scenarioName: string
          view: string
        },
      ) => {
        const [snapshot, files] = await Promise.all([world.snapshot(), world.files()])
        const node = resolveTarget(snapshot, view)
        if (node === undefined || node.kind !== 'view') {
          return capture('proposeScenario', { view }, refusal(`No view named "${view}".`))
        }
        const parameters = (node.detail?.['parameters'] ?? []) as string[]
        const entityParameter = parameters.find(parameter => parameter.includes('(entity '))
        if (entityParameter === undefined && rows.length > 0) {
          return capture(
            'proposeScenario',
            { view },
            refusal(
              `${view} takes no entity parameter, so it cannot be rendered with fixture rows. Propose a scenario with no rows, or say what would have to change in the app.`,
            ),
          )
        }
        const path = node.path
        const before = files.find(file => file.path === path)?.content
        if (path === undefined || before === undefined) {
          return capture('proposeScenario', { view }, refusal(`Studio cannot read the source that declares ${view}.`))
        }
        // Each row is one field assignment, and only a literal is allowed on the right. Without this the
        // strings are spliced straight into app source, and a row that closes the fixture block can add any
        // declaration the formatter accepts -- in the one mode that promises it cannot change app code.
        const badRow = rows.find(row => !/^[A-Z]\w*:\s*(?:"[^"\\]*"|-?\d+(?:\.\d+)?|true|false|now)$/.test(row.trim()))
        if (badRow !== undefined) {
          return capture(
            'proposeScenario',
            { view },
            refusal(
              `"${badRow}" is not a fixture row. Each row is one \`Field: value\` pair whose value is a quoted string, a number, true, false, or now.`,
            ),
          )
        }
        const handle = `${scenarioName.replace(/[^A-Za-z0-9]/g, '')}Row`
        const singular = entityParameter?.match(/\(entity (\w+)\)/)?.[1] ?? ''
        const parameterName = entityParameter?.split(' ')[0] ?? ''
        const entityNode = singular === '' ? undefined : resolveTarget(snapshot, singular)
        const fixture = rows.length === 0
          ? ''
          : `\nfixture ${fixtureName} {\n   ${handle} = create ${
            String(entityNode?.detail?.['singular'] ?? singular)
          } { ${rows.join(', ')} }\n}\n`
        // With no rows there is nothing to render the view with, so the entry carries no subject -- the shape
        // WordFlower already uses for `scenario "library" { }`.
        const subject = rows.length === 0 ? '' : `\n      render (${parameterName}: ${handle})`
        const scenario = `\nscenarios ${view} ${JSON.stringify(groupName)} {\n${
          rows.length === 0 ? '' : `   fixture ${fixtureName}\n`
        }   device phone\n   appearance light\n   network online\n   locale "en"\n   scenario ${
          JSON.stringify(scenarioName)
        } {${subject}\n}  }\n`
        let after: string
        try {
          after = await Formatter.formatCode(`${before}${fixture}${scenario}`)
        } catch (error) {
          return capture(
            'proposeScenario',
            { view },
            refusal(`That is not valid Tao: ${String(error instanceof Error ? error.message : error)}`, {
              youWrote: `${fixture}${scenario}`,
            }),
          )
        }
        const outOfScope = await requireOnly(before, after, ['fixture', 'scenarios'])
        if (outOfScope !== undefined) {
          return capture('proposeScenario', { view }, refusal(outOfScope))
        }
        return capture(
          'proposeScenario',
          { fixtureName, groupName, rows, scenarioName, view },
          await stage(`show ${view} as ${scenarioName}`, [{ after, before, path }]),
        )
      },
      inputSchema: objectSchema<
        { fixtureName: string; groupName: string; rows: string[]; scenarioName: string; view: string }
      >({
        fixtureName: TEXT('A name for the fixture holding the rows.'),
        groupName: TEXT('What this group of scenarios is about, for example "states".'),
        rows: LIST(
          'The row for the fixture, as `Field: value` pairs, for example ["Title: \\"A very long title\\"", "CommentCount: 1200"]. Empty for a scenario with no rows.',
        ),
        scenarioName: TEXT('What this one state is called, for example "empty" or "longTitle".'),
        view: TEXT('The view to show.'),
      }, ['fixtureName', 'groupName', 'rows', 'scenarioName', 'view']),
    }),

    proposeTest: tool({
      description:
        'Add one check to the app\'s test file. Steps are ordinary Tao test steps, one per line, for example "run HNReaderStub" then "expect text \\"Nothing yet\\"". Call taoGuarantees first: do not write a check for something Tao already guarantees, and never write one for something marked not-testable-yet.',
      execute: async ({ name, steps, suite }: { name: string; steps: string[]; suite: string }) => {
        const sources = (await world.testSources?.()) ?? []
        const file = sources.find(source => source.content.includes(`test "${suite}"`)) ?? sources[0]
        if (file === undefined) {
          return capture(
            'proposeTest',
            { name, suite },
            refusal('This app has no test file, and this mode does not create one. Say that it needs one.'),
          )
        }
        const before = file.content
        // The end of the named suite, not the end of the file: a file with two suites would otherwise take
        // every new check into the last one, whichever was asked for.
        const header = new RegExp(`^test\\s+"${Text.escapeRegExp(suite)}"\\s*\\{`, 'm')
        const opens = header.exec(before)
        if (opens === null) {
          return capture(
            'proposeTest',
            { name, suite },
            refusal(`${file.path} declares no suite named "${suite}". Call listTestFiles for the ones it has.`),
          )
        }
        let depth = 0
        let closing = -1
        for (let index = opens.index; index < before.length; index += 1) {
          const character = before[index]
          if (character === '{') {
            depth += 1
          } else if (character === '}') {
            depth -= 1
            if (depth === 0) {
              closing = index
              break
            }
          }
        }
        if (closing < 0) {
          return capture('proposeTest', { name, suite }, refusal(`${file.path} has no suite to add a check to.`))
        }
        const check = `   test ${JSON.stringify(name)} {\n${
          steps.map(step => `      ${step.trim()}`).join('\n')
        }\n   }\n`
        const merged = `${before.slice(0, closing)}${check}${before.slice(closing)}`
        let after: string
        try {
          after = await Formatter.formatCode(merged)
        } catch (error) {
          return capture(
            'proposeTest',
            { name, steps, suite },
            refusal(
              `Those steps are not valid Tao: ${String(error instanceof Error ? error.message : error)}`,
              { youWrote: check },
            ),
          )
        }
        // A check lives inside a suite, so a change that adds or alters a top-level declaration wrote
        // something other than a check -- a stray brace in a step, most likely.
        // Adding a check rewrites the suite that holds it, and nothing else.
        const outOfScope = await requireOnly(before, after, [], [`test ${suite}`])
        if (outOfScope !== undefined) {
          return capture('proposeTest', { name, steps, suite }, refusal(outOfScope, { youWrote: check }))
        }
        return capture(
          'proposeTest',
          { name, steps, suite },
          {
            ...(await stage(`add the check "${name}"`, [{ after, before, path: file.path }])),
            reminder: 'Run the tests after applying: a new check that passes immediately may not be testing anything.',
          },
        )
      },
      inputSchema: objectSchema<{ name: string; steps: string[]; suite: string }>({
        name: TEXT('What the check is called, phrased as the behavior it pins.'),
        steps: LIST('The steps, one per entry, in order.'),
        suite: TEXT('The suite to add it to, from listTestFiles.'),
      }, ['name', 'steps', 'suite']),
    }),

    requestCodeChanges: tool({
      description:
        'Say that what was asked for cannot be done by adding scenarios and tests alone, and that the app itself would have to change. This does not change anything: it stops and asks the person. You have no tool that changes app code in this mode, and will not have one unless they agree.',
      execute: async ({ missing, reason }: { missing: string; reason: string }) => {
        requests.push({ missing, reason })
        return capture('requestCodeChanges', { missing, reason }, {
          asked: true,
          note:
            'The person has been asked. Stop here and let them answer; do not look for another way to make this change.',
        })
      },
      inputSchema: objectSchema<{ missing: string; reason: string }>({
        missing: TEXT('What the app would need that it does not have, named exactly.'),
        reason: TEXT('Why the scenario or test cannot be written without it.'),
      }, ['missing', 'reason']),
    }),
  }
}
