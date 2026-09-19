import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'

/**
 * The intake under `.github/` is read by GitHub, not by anything in this repository, so nothing else
 * notices when it drifts away from the commands and categories it points people at. These are the
 * two couplings that fail silently: a form that names a flag the CLI stopped accepting, and a
 * contact link whose category has no matching template filename.
 */

const ISSUE_TEMPLATES = ['could-not-build-it.yml', 'this-confused-me.yml']

/** The command every form and the contributing guide tells a reporter to run. */
const FINGERPRINT_COMMAND = './agent doctor --fingerprint'

async function githubFile(relativePath: string): Promise<string> {
  return await FS.readText(Repo.resolvePath(`.github/${relativePath}`))
}

Describe('feedback intake', () => {
  Test('asks every reporter for the fingerprint by a command the doctor still accepts', async () => {
    const templates = await Promise.all(ISSUE_TEMPLATES.map(async name => ({
      name,
      text: await githubFile(`ISSUE_TEMPLATE/${name}`),
    })))
    const contributing = await githubFile('CONTRIBUTING.md')
    const devCli = await FS.readText(Repo.resolvePath('packages/dev/dev-src/dev.ts'))

    for (const template of templates) {
      Expect(template.text).toContain(FINGERPRINT_COMMAND)
      // The fingerprint is an attachment, never a gate: a form that required it would turn a
      // report from somebody who never cloned this repository into no report at all.
      Expect(template.text.split('id: fingerprint')[1]).toContain('required: false')
    }
    Expect(contributing).toContain(FINGERPRINT_COMMAND)
    Expect(devCli).toContain("'--fingerprint'")
  })

  Test('routes the open-ended half of each framing to a discussion template that exists', async () => {
    const config = await githubFile('ISSUE_TEMPLATE/config.yml')
    const linkedCategories = [...config.matchAll(/discussions\/new\?category=([a-z0-9-]+)/g)].map(match => match[1])
    const templateFiles = await FS.listDir(Repo.resolvePath('.github/DISCUSSION_TEMPLATE'))

    // GitHub matches a discussion template to its category by filename alone; a link to a category
    // with no matching file silently opens an empty box and the framing is lost.
    Expect(linkedCategories.toSorted()).toEqual(['ideas', 'q-a'])
    Expect(templateFiles.toSorted()).toEqual(['ideas.yml', 'q-a.yml'])
    // Blank issues would route around both forms, which is the whole of the intake.
    Expect(config).toContain('blank_issues_enabled: false')
  })
})
