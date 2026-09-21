export type StudioProjectChoice = Readonly<{
  appName: string
  label: string
  project: string
}>

export const StudioProjectContext = {
  choices(
    current: Readonly<{ appName: string; project: string }>,
    recent: readonly Readonly<{ appName: string; project: string }>[],
  ): readonly StudioProjectChoice[] {
    const projects = [current, ...recent].filter((candidate, index, all) =>
      all.findIndex(project => project.project === candidate.project) === index
    )
    const baseLabels = projects.map(project => studioProjectLabel(project.project, project.appName))
    return projects.map((project, index) => ({
      appName: project.appName,
      label: baseLabels.filter(label => label === baseLabels[index]).length > 1
        ? `${baseLabels[index]} — ${project.project}`
        : baseLabels[index]!,
      project: project.project,
    }))
  },
  label: studioProjectLabel,
} as const

function studioProjectLabel(projectPath: string, fallback: string): string {
  const segments = projectPath.split('/').filter(Boolean)
  const leaf = segments.at(-1)
  if (leaf === undefined) {
    return fallback
  }
  return /^\d+\s*-\s*/.test(leaf) ? segments.at(-2) ?? fallback : leaf
}
