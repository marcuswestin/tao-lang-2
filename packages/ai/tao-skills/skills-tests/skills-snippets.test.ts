import { CLI, Errors, FS, Repo } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { TAO_SKILLS_VERSION, taoSkillNames, taoSkillsSourceRoot } from '../skills-src/tao-skills'

type TaoFence = {
  path?: string
  source: string
}

const fences = taoSkillNames.flatMap(name => {
  const path = FS.resolvePath(`${name}/SKILL.md`, taoSkillsSourceRoot)
  return taoFences(FS.readTextSync(path)).map((fence, index) => ({ ...fence, index, name }))
})

Describe('Tao skill snippets', () => {
  Test('keeps every skill concise and includes executable Tao examples', async () => {
    for (const name of taoSkillNames) {
      const source = FS.readTextSync(FS.resolvePath(`${name}/SKILL.md`, taoSkillsSourceRoot))
      Expect(source.split('\n').length - 1).toBeLessThanOrEqual(150)
    }
    const skillsManifest = await FS.readJson<{ version: string }>(
      Repo.resolvePath('packages/ai/tao-skills/package.json'),
    )
    Expect(skillsManifest.version).toBe(TAO_SKILLS_VERSION)
    Expect(fences.length).toBeGreaterThan(0)
  })

  for (const fence of fences) {
    Test(`${fence.name} Tao fence ${fence.index + 1} passes tao check`, async () => {
      const root = await mkTestDir('tao-skill-snippet-')
      try {
        const project = FS.resolvePath('Pantry', root)
        await FS.copyDirectory(Repo.resolvePath('Apps/Starters/Pantry'), project)
        const relativePath = fence.path ?? `SkillProof/${fence.name}-${fence.index + 1}.tao`
        Expect(safeTaoPath(relativePath)).toBe(true)
        await FS.writeText(FS.resolvePath(relativePath, project), fence.source)

        const result = await CLI.run(Repo.resolvePath('tao'), { args: ['check', project] })
        Expect(`${result.stdout}${result.stderr}`).toContain('0 noncanonical')
        if (result.exitCode !== 0) {
          Errors.throwUnexpected(`Tao skill example failed tao check:\n${result.stdout}${result.stderr}`)
        }
        Expect(result.exitCode).toBe(0)
      } finally {
        await FS.remove(root)
      }
    })
  }
})

function taoFences(markdown: string): TaoFence[] {
  const fences: TaoFence[] = []
  const pattern = /^```tao(?:[ \t]+(?<path>[^\n]+))?\n(?<source>[\s\S]*?)^```[ \t]*$/gmu
  for (const match of markdown.matchAll(pattern)) {
    const source = match.groups?.['source']
    if (source !== undefined) {
      fences.push({ path: match.groups?.['path']?.trim(), source })
    }
  }
  return fences
}

function safeTaoPath(path: string): boolean {
  return path.endsWith('.tao') && !path.startsWith('/') && !path.split('/').includes('..')
}
