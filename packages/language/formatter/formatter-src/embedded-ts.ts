import { type ContextFormatter, createContext } from '@dprint/formatter'
import * as DprintTypescript from '@dprint/typescript'
import { FS } from '@shared'

/** EmbeddedTsFormatter formats Tao inject bodies with the repo TypeScript formatter. */
export type EmbeddedTsFormatter = ContextFormatter

let embeddedTsFormatterPromise: Promise<EmbeddedTsFormatter> | undefined

/** ensureEmbeddedTsFormatter returns the cached dprint TypeScript formatter, creating it on first use. */
export function ensureEmbeddedTsFormatter(): Promise<EmbeddedTsFormatter> {
  embeddedTsFormatterPromise ??= createEmbeddedTsFormatter().catch(error => {
    embeddedTsFormatterPromise = undefined
    throw error
  })
  return embeddedTsFormatterPromise
}

/** formatEmbeddedTs formats one inject fence body, returning null when the embedded code cannot be formatted. */
export function formatEmbeddedTs(
  code: string,
  opts: { baseIndent: string; tabSize: number },
  formatter: EmbeddedTsFormatter,
): string | null {
  if (code.trim() === '') {
    return ''
  }

  const normalizedCode = dedentSharedIndent(code)
  let formatted: string
  try {
    formatted = formatter.formatText({
      filePath: 'tao-inject.tsx',
      fileText: `async function __taoInject__() {\n${normalizedCode}\n}\n`,
    })
  } catch {
    return null
  }

  const bodyLines = trimOuterBlankLines(
    trimFinalNewlines(formatted)
      .split('\n')
      .slice(1, -1)
      .map(line => line.startsWith('  ') ? line.slice(2) : line),
  )
  const bodyIndent = `${opts.baseIndent}${' '.repeat(opts.tabSize)}`
  return bodyLines.map(line => line.trim() === '' ? '' : `${bodyIndent}${line}`).join('\n')
}

async function createEmbeddedTsFormatter(): Promise<EmbeddedTsFormatter> {
  const context = createContext({
    indentWidth: 2,
    useTabs: false,
    lineWidth: 120,
  })
  return context.addPlugin(await FS.readFile(DprintTypescript.getPath()), {
    semiColons: 'asi',
    quoteStyle: 'preferSingle',
    trailingCommas: 'onlyMultiLine',
    preferHanging: false,
    singleBodyPosition: 'nextLine',
    'arguments.preferHanging': 'never',
    'arrayExpression.preferHanging': 'never',
    'memberExpression.linePerExpression': false,
    bracePosition: 'sameLineUnlessHanging',
    preferSingleLine: false,
    'jsx.quoteStyle': 'preferDouble',
  })
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]!.trim() === '') {
    start++
  }
  while (end > start && lines[end - 1]!.trim() === '') {
    end--
  }
  return lines.slice(start, end)
}

function dedentSharedIndent(code: string): string {
  const lines = code.split('\n')
  const contentLines = lines.filter(line => line.trim() !== '')
  if (contentLines.length === 0) {
    return code
  }
  const sharedIndentLength = Math.min(...contentLines.map(line => line.length - line.trimStart().length))
  return lines.map(line => line.trim() === '' ? '' : line.slice(sharedIndentLength)).join('\n')
}

function trimFinalNewlines(text: string): string {
  return text.replace(/\n+$/g, '')
}
