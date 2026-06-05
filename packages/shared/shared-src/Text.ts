/** stripIndent removes shared leading indentation from a multiline string. */
export function stripIndent(text: string): string {
  const lines = trimOuterBlankLines(text.replace(/\r\n/g, '\n').split('\n'))
  const sharedIndent = commonSharedIndent(lines)

  return lines.map(line => line.startsWith(sharedIndent) ? line.slice(sharedIndent.length) : line).join('\n')
}

/** IndentLinesOptions declares which lines should not receive indentation. */
export type IndentLinesOptions = {
  skipFirstLine?: boolean
  skipBlankLines?: boolean
}

/** indentLines prefixes selected lines with spaces. */
export function indentLines(text: string, spaces: number, options: IndentLinesOptions = {}): string {
  const prefix = ' '.repeat(spaces)
  return text
    .split('\n')
    .map((line, index) => shouldIndentLine(line, index, options) ? `${prefix}${line}` : line)
    .join('\n')
}

/** escapeRegExp escapes regular-expression metacharacters in literal text. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function shouldIndentLine(line: string, index: number, options: IndentLinesOptions): boolean {
  return !(options.skipFirstLine === true && index === 0) && !(options.skipBlankLines === true && line.length === 0)
}

function trimOuterBlankLines(lines: string[]): string[] {
  let start = 0
  let end = lines.length

  while (start < end && lines[start]?.trim() === '') {
    start += 1
  }
  while (end > start && lines[end - 1]?.trim() === '') {
    end -= 1
  }
  return lines.slice(start, end)
}

function commonSharedIndent(lines: readonly string[]): string {
  const indents = lines
    .filter(line => line.trim().length > 0)
    .map(line => line.match(/^[ \t]*/)?.[0] ?? '')

  return indents.length === 0 ? '' : indents.reduce(commonPrefix)
}

function commonPrefix(left: string, right: string): string {
  let index = 0
  while (index < left.length && index < right.length && left[index] === right[index]) {
    index += 1
  }
  return left.slice(0, index)
}
