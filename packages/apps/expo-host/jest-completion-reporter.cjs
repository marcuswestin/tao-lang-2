const fs = require('node:fs')
const path = require('node:path')

// Loader-constrained Jest reporters cannot import the shared TypeScript modules. Keep the marker
// in step with tao-cli/test-runner-lifecycle.ts. Unlike a summary, this means every suite finished.
module.exports = class CompletionReporter {
  onRunComplete(_contexts, results) {
    // Jest appends its summary reporter after configured reporters and settles `success` after
    // their callbacks. Defer one turn so the drain starts after the original summary was delivered.
    setImmediate(() => {
      const resources = new Set(process.getActiveResourcesInfo())
      const directory = process.env.TAO_TEST_RESOURCE_DIRECTORY
      if (directory !== undefined) {
        try {
          for (const name of fs.readdirSync(directory)) {
            if (/^worker-\d+\.json$/.test(name)) {
              for (const kind of JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'))) {
                resources.add(kind)
              }
            }
          }
        } catch (error) {
          process.stderr.write(`Jest resource snapshot could not be read: ${error.message}\n`)
        }
      }
      const failed = results.success === false || results.numFailedTests > 0 || results.numFailedTestSuites > 0
        || results.wasInterrupted || results.snapshot?.failure
      process.stderr.write(
        `Tao test runner completed (exit ${failed ? 1 : 0}); resource kinds: ${[...resources].sort().join(', ')}\n`,
      )
    })
  }
}
