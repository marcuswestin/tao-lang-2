import { runWithCommands } from './commands/commands'

const invocationCwd = process.env['TAO_AGENT_CWD'] ?? process.cwd()
const repoRoot = process.env['TAO_REPO_ROOT'] ?? process.cwd()

await runWithCommands(commands => {
  commands.name('dev')

  commands
    .command('compile-app <appPath>')
    .description('Compile a Tao app into the local runtime package.')
    .action(async (appPath: string) => {
      await generateParser()
      const { Runtime } = await import('@tao/runtime')
      const compiled = await Runtime.compileApp(appPath, { sourceBaseDir: invocationCwd })
      console.info(`Compiled ${compiled.sourcePath} -> ${compiled.outputPath}`)
    })
})

async function generateParser(): Promise<void> {
  const parser = Bun.spawn(['bunx', 'langium-cli', 'generate'], {
    cwd: `${repoRoot}/packages/parser`,
    stderr: 'inherit',
    stdout: 'inherit',
  })
  const exitCode = await parser.exited
  if (exitCode !== 0) {
    throw new Error(`Parser generation failed with exit code ${exitCode}.`)
  }
}
