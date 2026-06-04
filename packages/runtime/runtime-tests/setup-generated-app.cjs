const { execFileSync } = require('node:child_process')
const { resolve } = require('node:path')

module.exports = async () => {
  const repoRoot = resolve(__dirname, '../../..')
  const appPath = resolve(repoRoot, 'Apps/Kitchen Sink/Kitchen Sink.tao')

  execFileSync(resolve(repoRoot, 'dev'), ['compile-app', appPath], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
}
