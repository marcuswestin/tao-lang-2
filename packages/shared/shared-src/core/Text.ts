/** stripIndent removes shared leading indentation from a multiline string. */
export function stripIndent(text: string): string {
  const lines = trimOuterBlankLines(text.replace(/\r\n/g, '\n').split('\n'))
  const sharedIndent = commonSharedIndent(lines)

  return lines.map(line => line.startsWith(sharedIndent) ? line.slice(sharedIndent.length) : line).join('\n')
}

/** IndentLinesOptions declares which lines should not receive indentation. */
type IndentLinesOptions = {
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

/** stripAnsi removes ANSI CSI escape sequences (colors, cursor, and erase controls) from terminal output. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

/** escapeRegExp escapes regular-expression metacharacters in literal text. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** stripJsonc removes the comments and trailing commas JSONC allows and JSON.parse rejects. */
export function stripJsonc(source: string): string {
  let output = ''
  let index = 0
  let inString = false
  while (index < source.length) {
    const character = source[index]!
    if (inString) {
      output += character
      if (character === '\\') {
        output += source[index + 1] ?? ''
        index += 2
        continue
      }
      inString = character !== '"'
      index += 1
      continue
    }
    if (character === '"') {
      inString = true
      output += character
      index += 1
      continue
    }
    if (character === '/' && source[index + 1] === '/') {
      const lineEnd = source.indexOf('\n', index)
      index = lineEnd === -1 ? source.length : lineEnd
      continue
    }
    if (character === '/' && source[index + 1] === '*') {
      const blockEnd = source.indexOf('*/', index + 2)
      if (blockEnd === -1) {
        // Preserve the invalid token so JSON.parse rejects an unterminated comment rather than
        // accepting the valid prefix this helper happened to finish before it.
        output += source.slice(index)
        break
      }
      index = blockEnd + 2
      continue
    }
    if (character === '}' || character === ']') {
      // A trailing comma is only visible once comments between it and the bracket are gone.
      output = output.replace(/,\s*$/, '')
    }
    output += character
    index += 1
  }
  return output
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
