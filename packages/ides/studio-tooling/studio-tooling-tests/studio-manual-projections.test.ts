import { Errors, FS } from '@shared'
import { Describe, Expect, mkTestDir, Test, withCapturedOutput } from '@shared/test'
import type { StudioDevOptions } from '../studio-tooling-src/StudioDev'
import { StudioManualChecks } from '../studio-tooling-src/StudioManualChecks'
import { StudioNativeTestRun } from '../studio-tooling-src/StudioNativeTestRun'

async function withProjects(
  run: (
    root: string,
    projects: Awaited<ReturnType<typeof StudioNativeTestRun.project>>[],
    project: typeof StudioNativeTestRun.project,
  ) => Promise<void>,
) {
  const root = await mkTestDir('tao-manual-projections-')
  const projects: Awaited<ReturnType<typeof StudioNativeTestRun.project>>[] = []
  const project: typeof StudioNativeTestRun.project = async (...args) => {
    const target = await StudioNativeTestRun.project(...args)
    projects.push(target)
    return target
  }
  try {
    await withCapturedOutput(() => run(root, projects, project))
  } finally {
    for (const target of projects) {
      await FS.remove(target.projectRoot)
    }
    await FS.remove(root)
  }
}

Describe('Studio manual project projections', () => {
  Test(
    'prepares two distinct keyboard projects, prints the chooser path, and records both under one isolated run',
    async () => {
      await withProjects(async (root, projects, project) => {
        const output: string[] = []
        const launches: StudioDevOptions[] = []
        let invocationRoot = ''
        const result = await StudioManualChecks.run({ artifactRoot: root, showStudio: true }, {
          isInteractive: () => true,
          project,
          runStudio: async options => {
            launches.push(options)
            invocationRoot = FS.dirname(options.nativeArtifactRoot!)
            Expect(projects).toHaveLength(2)
            Expect(projects[0]!.projectRoot).not.toBe(projects[1]!.projectRoot)
            for (const target of projects) {
              Expect(await FS.readText(FS.resolvePath('KeyboardNavigation.tao', target.projectRoot)))
                .toContain('KeyboardNavigationAcceptance')
            }
            Expect(await FS.readJson(FS.resolvePath('external-directories.json', invocationRoot))).toMatchObject({
              owner: invocationRoot,
              path: projects[0]!.projectRoot,
              state: 'owned',
            })
            const secondRoot = FS.resolvePath('open-project', invocationRoot)
            Expect(await FS.readJson(FS.resolvePath('external-directories.json', secondRoot))).toMatchObject({
              owner: secondRoot,
              path: projects[1]!.projectRoot,
              state: 'owned',
            })
            options.onCleanup?.({ resourcesStopped: true })
            return 130
          },
          writeLine: line => output.push(line),
        })
        Expect(result).toBe(0)
        Expect(launches).toHaveLength(1)
        Expect(launches[0]).toMatchObject({
          appName: 'KeyboardNavigationAcceptance',
          devDataRoot: FS.resolvePath('dev-data', invocationRoot),
          launchRecordsRoot: FS.resolvePath('launch-records', invocationRoot),
          nativeArtifactRoot: FS.resolvePath('electrobun', invocationRoot),
          nativeHostCommand: 'studio-manual-checks',
          nativeShowStudio: true,
          projectRoot: projects[0]!.projectRoot,
          userStateRoot: FS.resolvePath('user-state', invocationRoot),
        })
        Expect(output).toContain(`Initial project: ${projects[0]!.projectRoot}`)
        Expect(output).toContain(
          `For File > Open Project…, choose this disposable project: ${projects[1]!.projectRoot}`,
        )
        Expect(await FS.readJson(FS.resolvePath('manual-checks.json', invocationRoot))).toMatchObject({
          launchExitCode: 130,
          openProjectRoot: projects[1]!.projectRoot,
          projectRoot: projects[0]!.projectRoot,
          status: 'launched',
        })
        for (const [index, target] of projects.entries()) {
          Expect(await FS.exists(target.projectRoot)).toBe(false)
          const ledgerRoot = index === 0 ? invocationRoot : FS.resolvePath('open-project', invocationRoot)
          Expect(await FS.readJson(FS.resolvePath('external-directories.json', ledgerRoot))).toMatchObject({
            path: target.projectRoot,
            state: 'removed',
          })
        }
      })
    },
  )

  for (const resourcesStopped of [false, undefined]) {
    Test(
      `retains both projects when resource shutdown is ${resourcesStopped === false ? 'failed' : 'unproved'}`,
      async () => {
        await withProjects(async (root, projects, project) => {
          let invocationRoot = ''
          await Expect(StudioManualChecks.run({ artifactRoot: root, showStudio: true }, {
            isInteractive: () => true,
            project,
            runStudio: async options => {
              invocationRoot = FS.dirname(options.nativeArtifactRoot!)
              if (resourcesStopped !== undefined) {
                options.onCleanup?.({ resourcesStopped })
              }
              Errors.throwHostEnvironment('The native launch failed.')
            },
            writeLine: () => {},
          })).rejects.toThrow('The native launch failed.')
          Expect(projects).toHaveLength(2)
          for (const [index, target] of projects.entries()) {
            Expect(await FS.exists(target.projectRoot)).toBe(true)
            const ledgerRoot = index === 0 ? invocationRoot : FS.resolvePath('open-project', invocationRoot)
            Expect(await FS.readJson(FS.resolvePath('external-directories.json', ledgerRoot))).toMatchObject({
              path: target.projectRoot,
              state: 'retained',
            })
          }
        })
      },
    )
  }

  Test('cleans the first owned projection if preparing the second fails before launch', async () => {
    await withProjects(async (root, projects, project) => {
      let launches = 0
      await Expect(StudioManualChecks.run({ artifactRoot: root, showStudio: true }, {
        isInteractive: () => true,
        project: async (...args) => {
          if (projects.length === 1) {
            Errors.throwHostEnvironment('The second projection could not be prepared.')
          }
          return await project(...args)
        },
        runStudio: async () => {
          launches++
          return 0
        },
        writeLine: () => {},
      })).rejects.toThrow('The second projection could not be prepared.')
      Expect(launches).toBe(0)
      Expect(projects).toHaveLength(1)
      Expect(await FS.exists(projects[0]!.projectRoot)).toBe(false)
    })
  })

  Test('attempts the second cleanup even if the first cleanup fails', async () => {
    await withProjects(async (root, projects, project) => {
      await Expect(StudioManualChecks.run({ artifactRoot: root, showStudio: true }, {
        isInteractive: () => true,
        project: async (...args) => {
          const target = await project(...args)
          return projects.length === 1
            ? { ...target, cleanup: async () => Errors.throwHostEnvironment('The first cleanup failed.') }
            : target
        },
        runStudio: async options => {
          options.onCleanup?.({ resourcesStopped: true })
          return 0
        },
        writeLine: () => {},
      })).rejects.toThrow('The first cleanup failed.')
      Expect(projects).toHaveLength(2)
      Expect(await FS.exists(projects[0]!.projectRoot)).toBe(true)
      Expect(await FS.exists(projects[1]!.projectRoot)).toBe(false)
    })
  })

  Test('borrows an explicit primary project while the chooser project remains disposable', async () => {
    await withProjects(async (root, projects, project) => {
      const borrowed = FS.resolvePath('borrowed', root)
      await FS.writeText(FS.resolvePath('keep.txt', borrowed), 'user-owned source')
      const argumentsSeen: Parameters<typeof project>[0][] = []
      await StudioManualChecks.run(
        { appName: 'Borrowed', artifactRoot: root, projectRoot: borrowed, showStudio: true },
        {
          isInteractive: () => true,
          project: async (...args) => {
            argumentsSeen.push(args[0])
            return await project(...args)
          },
          runStudio: async options => {
            Expect(options.projectRoot).toBe(borrowed)
            options.onCleanup?.({ resourcesStopped: true })
            return 0
          },
          writeLine: () => {},
        },
      )
      Expect(argumentsSeen[0]).toMatchObject({ appName: 'Borrowed', projectRoot: borrowed })
      Expect(argumentsSeen[1]).toEqual({})
      Expect(projects).toHaveLength(2)
      Expect(projects[1]!.projectRoot).not.toBe(borrowed)
      Expect(await FS.readText(FS.resolvePath('keep.txt', borrowed))).toBe('user-owned source')
      Expect(await FS.exists(projects[1]!.projectRoot)).toBe(false)
    })
  })
})
