import { FS } from '@shared'
import { Describe, Expect, mkTestDir, Test } from '@shared/test'
import { offerMissingInstalls } from '../cli-src/install-offer'

Describe('install offer before a project command', () => {
  Test('asks once per project with uninstalled pins and installs only on approval', async () => {
    const root = await mkTestDir('tao-install-offer-')
    try {
      const project = FS.resolvePath('Pinned', root)
      await FS.writeJson(FS.resolvePath('.tao/store/lock.jsonc', project), {
        schemaVersion: 1,
        installs: {
          environments: {
            '.': { projectRoot: '.', npm: { util: { name: 'date-fns', requested: '^4.0.0', version: '4.1.0' } } },
          },
        },
      })
      await FS.writeText(FS.resolvePath('App.tao', project), '')
      const questions: string[] = []
      const installed: string[] = []
      const offer = (interactive: boolean, approve: boolean) =>
        offerMissingInstalls([FS.resolvePath('App.tao', project), project], {
          interactive,
          confirmInstall: async question => {
            questions.push(question)
            return approve
          },
          install: async projectRoot => {
            installed.push(projectRoot)
          },
        })

      await offer(false, true)
      Expect({ questions, installed }).toEqual({ questions: [], installed: [] })

      await offer(true, false)
      Expect(questions).toHaveLength(1)
      Expect(questions[0]).toContain('(util)')
      Expect(installed).toEqual([])

      await offer(true, true)
      Expect(installed).toEqual([await FS.realPath(project)])

      await FS.writeJson(FS.resolvePath('node_modules/util/package.json', project), { version: '4.1.0' })
      await offer(true, true)
      Expect(questions).toHaveLength(2)
    } finally {
      await FS.remove(root)
    }
  })
})
