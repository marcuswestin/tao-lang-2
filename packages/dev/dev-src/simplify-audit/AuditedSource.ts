const SOURCE_EXTENSIONS = ['.ts', '.tsx']
const TEST_PATH_PATTERN =
  /\.test\.|\.jest-test\.|-tests\/|\/test-|\/testing\/|\/studio-smoke\/|^packages\/e2e-testing\//

/** isAuditedSource is true for package TypeScript that is neither test code nor a declaration file. */
export function isAuditedSource(path: string): boolean {
  return path.startsWith('packages/')
    && SOURCE_EXTENSIONS.some(extension => path.endsWith(extension))
    && !path.endsWith('.d.ts')
    && !TEST_PATH_PATTERN.test(path)
}
