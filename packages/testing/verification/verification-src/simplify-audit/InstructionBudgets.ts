/**
 * The budgets the `simplify-repo` skill sets for instruction files, in characters rather than lines.
 *
 * A line budget caps bullets, not cost. These files are written as long paragraph bullets, so the way
 * back under a line budget is to lengthen a bullet that is already there — which is what happened on
 * 2026-09-21, when AGENTS.md hit 61 lines and was brought back to 60 by folding one bullet into
 * another, leaving the file the same size. The spread across the skills says the same thing without
 * anyone gaming it: `delegation/SKILL.md` and `verification-lanes/SKILL.md` both sit at the 80-line
 * budget, and the first carries 11,594 characters against the second's 5,894. Characters are what an
 * agent actually pays to carry, so they are what the budget counts.
 *
 * Each number holds its file's current size with a little headroom rather than demanding a trim:
 * the change is the unit, and whether these files should also be smaller is a separate judgment
 * with its own evidence. `packages/AGENTS.md` had no budget at all until now. The root budget was raised
 * on 2026-09-22 by ten of that file's average sentences (126 characters each), from 11,500.
 */
const INSTRUCTION_BUDGETS = { packageAgents: 6_000, rootAgents: 12_760, skill: 12_000 } as const

/** instructionLineCount counts a file's lines the way the audit means them. */
export function instructionLineCount(source: string): number {
  return source === '' ? 0 : source.trimEnd().split('\n').length
}

/** instructionCharacterCount counts what an agent carries: the file's text, without trailing blanks. */
export function instructionCharacterCount(source: string): number {
  return source.trimEnd().length
}

/** instructionBudget is the character budget for an instruction file, or undefined when it has none. */
export function instructionBudget(path: string): number | undefined {
  if (path === 'AGENTS.md') {
    return INSTRUCTION_BUDGETS.rootAgents
  }
  if (path.endsWith('/AGENTS.md')) {
    return INSTRUCTION_BUDGETS.packageAgents
  }
  return path.startsWith('agents/skills/') && path.endsWith('/SKILL.md') ? INSTRUCTION_BUDGETS.skill : undefined
}
