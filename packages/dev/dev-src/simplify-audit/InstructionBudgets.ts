/** INSTRUCTION_BUDGETS are the line budgets the `simplify-repo` skill sets for instruction files. */
const INSTRUCTION_BUDGETS = { rootAgents: 60, skill: 80 } as const

/** instructionLineCount counts a file's lines the way the budgets and the audit both mean them. */
export function instructionLineCount(source: string): number {
  return source === '' ? 0 : source.trimEnd().split('\n').length
}

/** instructionBudget is the line budget for an instruction file, or undefined when it has none. */
export function instructionBudget(path: string): number | undefined {
  if (path === 'AGENTS.md') {
    return INSTRUCTION_BUDGETS.rootAgents
  }
  return path.startsWith('agents/skills/') && path.endsWith('/SKILL.md') ? INSTRUCTION_BUDGETS.skill : undefined
}
