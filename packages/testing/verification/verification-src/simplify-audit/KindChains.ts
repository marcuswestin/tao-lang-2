/** A KindChain is a run of `if`/`else if` branches that test the same discriminant against literals. */
export type KindChain = {
  discriminant: string
  length: number
  line: number
  path: string
}

const KIND_BRANCH_PATTERN = /^\s*(?:\}\s*)?(?:else\s+)?if\s*\(\s*(?:!)?([\w.$?]+)\.(kind|type|\$type)\s*[!=]==\s*['"]/

/**
 * kindChainsIn finds every chain of at least `minimum` consecutive branches on one discriminant.
 * A branch is `if (` or `} else if (` whose condition compares `<expr>.kind`, `.type`, or `.$type`
 * to a string literal; branches belong to one chain while they name the same expression, no more
 * than `gapLines` lines separate them, and no line between them is indented less than the first
 * branch, which is where its enclosing block ends and another function's guards would begin.
 */
export function kindChainsIn(path: string, source: string, minimum = 3, gapLines = 24): KindChain[] {
  const chains: KindChain[] = []
  let current: KindChain | undefined
  let lastLine = -Infinity
  let chainIndent = 0
  const closeCurrent = () => {
    if (current !== undefined && current.length >= minimum) {
      chains.push(current)
    }
  }
  source.split('\n').forEach((text, index) => {
    const match = KIND_BRANCH_PATTERN.exec(text)
    const indent = text.length - text.trimStart().length
    if (current !== undefined && text.trim() !== '' && indent < chainIndent) {
      closeCurrent()
      current = undefined
    }
    if (match === null) {
      return
    }
    const line = index + 1
    const discriminant = `${match[1]}.${match[2]}`
    if (current !== undefined && current.discriminant === discriminant && line - lastLine <= gapLines) {
      current.length += 1
    } else {
      closeCurrent()
      current = { discriminant, length: 1, line, path }
      chainIndent = indent
    }
    lastLine = line
  })
  closeCurrent()
  return chains
}
