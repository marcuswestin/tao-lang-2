/** Isolated native proofs expose projects and visibility, never a launcher executable or process selector. */
export function validStudioProofArgs(args: readonly string[]): boolean {
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) {
    return true
  }
  const seen = new Set<string>()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (seen.has(arg)) {
      return false
    }
    seen.add(arg)
    if (arg === '--show-studio') {
      continue
    }
    if (!['--project', '--app'].includes(arg)) {
      return false
    }
    const value = args[++index]
    if (value === undefined || value.length === 0 || value.startsWith('-')) {
      return false
    }
  }
  return true
}
