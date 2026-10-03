/// <reference path="./markdown.d.ts" />
import { Errors, FS, Json, ProjectLocal, Text } from '@shared'
import taoCreate from '../skills/tao-create/SKILL.md' with { type: 'text' }
import taoData from '../skills/tao-data/SKILL.md' with { type: 'text' }
import taoDesign from '../skills/tao-design/SKILL.md' with { type: 'text' }
import flexboxMapping from '../skills/tao-layout/references/flexbox-mapping.md' with { type: 'text' }
import taoLayout from '../skills/tao-layout/SKILL.md' with { type: 'text' }
import taoNavigationActions from '../skills/tao-navigation-actions/SKILL.md' with { type: 'text' }
import taoProject from '../skills/tao-project/SKILL.md' with { type: 'text' }
import taoRunAndShip from '../skills/tao-run-and-ship/SKILL.md' with { type: 'text' }
import taoSyntax from '../skills/tao-syntax/SKILL.md' with { type: 'text' }
import taoTesting from '../skills/tao-testing/SKILL.md' with { type: 'text' }
import taoVisibility from '../skills/tao-visibility/SKILL.md' with { type: 'text' }

export const TAO_SKILLS_VERSION = '1.0.0'

export const taoSkillNames = [
  'tao-project',
  'tao-create',
  'tao-syntax',
  'tao-visibility',
  'tao-layout',
  'tao-design',
  'tao-data',
  'tao-navigation-actions',
  'tao-testing',
  'tao-run-and-ship',
] as const

export type TaoSkillName = typeof taoSkillNames[number]

export type InstallTaoSkillsResult = {
  paths: readonly string[]
  version: string
}

const bundledSkills: Record<TaoSkillName, string> = {
  'tao-project': taoProject,
  'tao-create': taoCreate,
  'tao-syntax': taoSyntax,
  'tao-visibility': taoVisibility,
  'tao-layout': taoLayout,
  'tao-design': taoDesign,
  'tao-data': taoData,
  'tao-navigation-actions': taoNavigationActions,
  'tao-testing': taoTesting,
  'tao-run-and-ship': taoRunAndShip,
}

/** Markdown imports embed the shipped guidance in a compiled Tao CLI. */
export async function installTaoSkills(projectRoot: string): Promise<InstallTaoSkillsResult> {
  await FS.mkdir(FS.resolvePath(projectRoot))
  const root = await FS.realPath(projectRoot)
  await ProjectLocal.prepare(root)
  const files = installedSkillFiles()
  for (const [relativePath, content] of Object.entries(files)) {
    await writeCommittedFile(FS.resolvePath(relativePath, root), root, content)
  }
  const lockPath = ProjectLocal.storeResolve('lock.jsonc', root)
  await FS.withFileMutationLock(lockPath, root, async () => {
    const current: unknown = await FS.isFile(lockPath)
      ? JSON.parse(Text.stripJsonc(await FS.readText(lockPath)))
      : { schemaVersion: 1 }
    if (!Json.isRecord(current) || current['schemaVersion'] !== 1) {
      Errors.throwUserInput(`Tao project lock at ${lockPath} must declare schemaVersion 1.`)
    }
    await writeStagedFile(
      lockPath,
      root,
      `${JSON.stringify({ ...current, skillsVersion: TAO_SKILLS_VERSION }, null, 2)}\n`,
    )
  }, { lockDirectory: ProjectLocal.cacheResolve('locks', root) })
  return { paths: [...Object.keys(files), '.tao/store/lock.jsonc'].sort(), version: TAO_SKILLS_VERSION }
}

/** The source root is used only by the executable Markdown proof. */
export const taoSkillsSourceRoot = FS.resolvePath('../skills', import.meta.dir)

function installedSkillFiles(): Record<string, string> {
  const files: Record<string, string> = {}
  for (const name of taoSkillNames) {
    const content = bundledSkills[name]
    files[`.agents/skills/${name}/SKILL.md`] = content
    files[`.claude/skills/${name}/SKILL.md`] = content
  }
  files['.agents/skills/tao-layout/references/flexbox-mapping.md'] = flexboxMapping
  files['.claude/skills/tao-layout/references/flexbox-mapping.md'] = flexboxMapping
  files['AGENTS.md'] = skillBody(taoProject)
  files['CLAUDE.md'] = '@AGENTS.md\n'
  return files
}

async function writeCommittedFile(path: string, projectRoot: string, content: string): Promise<void> {
  await FS.withFileMutationLock(path, projectRoot, async () => {
    await writeStagedFile(path, projectRoot, content)
  }, { lockDirectory: ProjectLocal.cacheResolve('locks', projectRoot) })
}

async function writeStagedFile(path: string, projectRoot: string, content: string): Promise<void> {
  const temporary = ProjectLocal.stagingPath(path, projectRoot)
  try {
    await FS.writeText(temporary, content)
    await FS.move(temporary, path)
  } finally {
    await FS.remove(temporary).catch(() => {})
  }
}

function skillBody(source: string): string {
  const match = /^---\n[\s\S]*?\n---\n(?<body>[\s\S]*)$/u.exec(source)
  const body = match?.groups?.['body']
  if (body === undefined) {
    Errors.throwUnexpected('The bundled tao-project skill has no valid frontmatter.')
  }
  const normalized = body.startsWith('\n') ? body.slice(1) : body
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}
