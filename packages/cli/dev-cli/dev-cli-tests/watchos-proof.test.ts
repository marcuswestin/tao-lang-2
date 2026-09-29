import { type CLI } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runWatchProofBuild } from '../dev-cli-src/watchos/WatchProof'

const developerDir = '/Applications/Xcode-27.app/Contents/Developer'
const options = { project: '/output/TaoWatch.xcodeproj', root: '/output' }

Describe('watchOS proof Xcode selection', () => {
  Test('forwards a validated developer directory only to the xcodebuild child', async () => {
    const calls: { command: string; spec: CLI.CommandSpec }[] = []
    const files = {
      isDirectory: async () => true,
      isFile: async () => true,
      realPath: async () => developerDir,
    }
    const run = async (command: string, spec: CLI.CommandSpec) => {
      calls.push({ command, spec })
    }

    await runWatchProofBuild({ ...options, developerDir, device: 'watch-uuid' }, { files, run })

    Expect(calls).toHaveLength(1)
    Expect(calls[0]?.command).toBe('xcodebuild')
    Expect(calls[0]?.spec.env?.['DEVELOPER_DIR']).toBe(developerDir)
    Expect(calls[0]?.spec.args).toContain('platform=watchOS Simulator,id=watch-uuid')
    Expect(calls[0]?.spec.args).toContain('test')
  })

  Test('keeps default Xcode selection when no directory is provided', async () => {
    const calls: CLI.CommandSpec[] = []
    await runWatchProofBuild(options, {
      run: async (_command, spec) => {
        calls.push(spec)
      },
    })
    Expect(calls).toHaveLength(1)
    Expect(calls[0]?.env).toBeUndefined()
    Expect(calls[0]?.args).toContain('build-for-testing')
  })

  Test('rejects malformed and incomplete developer directories before starting Xcode', async () => {
    const calls: string[] = []
    const run = async (command: string) => {
      calls.push(command)
    }
    await Expect(runWatchProofBuild({ ...options, developerDir: 'Xcode.app/Contents/Developer' }, { run }))
      .rejects.toThrow('--developer-dir must be an absolute Xcode .app/Contents/Developer directory.')
    await Expect(runWatchProofBuild({ ...options, developerDir }, {
      files: {
        isDirectory: async () => true,
        isFile: async () => false,
        realPath: async () => developerDir,
      },
      run,
    })).rejects.toThrow('The selected Xcode Developer directory is missing or incomplete')
    Expect(calls).toHaveLength(0)
  })
})
