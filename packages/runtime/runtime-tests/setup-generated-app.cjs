const { execFileSync } = require('node:child_process')
const nodePath = require('node:path')

// Jest loads globalSetup as plain CJS before @shared TS imports are safe.
module.exports = async () => {
  if (process.env.TAO_TEST_PLAN_PATHS) {
    return
  }
  const repoRoot = nodePath.resolve(__dirname, '../../..')
  const appPath = nodePath.resolve(repoRoot, 'Apps/Kitchen Sink/Kitchen Sink.tao')

  execFileSync(nodePath.resolve(repoRoot, 'tao'), ['compile', appPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}
