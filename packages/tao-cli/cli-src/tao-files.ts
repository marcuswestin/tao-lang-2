import { Errors, FS } from '@shared'

type GitIgnoreRule = {
  anchored: boolean
  directoryOnly: boolean
  negated: boolean
  pattern: string
  regex: RegExp
}

type GitIgnoreMatcher = {
  ignores(path: string, isDirectory: boolean): boolean
}

/** findTaoFiles finds `.tao` files at or under `path`, honoring the nearest ancestor `.gitignore`. */
export async function findTaoFiles(path: string): Promise<string[]> {
  const root = FS.resolvePath(path)
  if (!await FS.exists(root)) {
    Errors.throwUserInput(`No file or directory found at ${root}`)
  }
  if (await FS.isFile(root)) {
    return FS.extname(root) === '.tao' ? [root] : []
  }

  const matcher = await createGitIgnoreMatcher(root)
  if (matcher.ignores(root, true)) {
    return []
  }
  const files: string[] = []
  await collectTaoFiles(root, matcher, files)
  return files.sort()
}

async function collectTaoFiles(directoryPath: string, matcher: GitIgnoreMatcher, files: string[]): Promise<void> {
  for (const name of await FS.listDir(directoryPath)) {
    if (name.startsWith('.')) {
      continue
    }
    const path = FS.resolvePath(name, { cwd: directoryPath })
    const isDirectory = await FS.isDirectory(path)
    if (matcher.ignores(path, isDirectory)) {
      continue
    }
    if (isDirectory) {
      await collectTaoFiles(path, matcher, files)
      continue
    }
    if (FS.extname(path) === '.tao') {
      files.push(path)
    }
  }
}

async function createGitIgnoreMatcher(root: string): Promise<GitIgnoreMatcher> {
  const gitIgnorePath = await nearestGitIgnorePath(root)
  if (!gitIgnorePath) {
    return { ignores: () => false }
  }
  const basePath = FS.dirname(gitIgnorePath)
  const rules = parseGitIgnore(await FS.readText(gitIgnorePath))
  return {
    ignores(path, isDirectory) {
      const relativePath = FS.relativePath(basePath, path)
      if (relativePath === '' || relativePath.startsWith('..')) {
        return false
      }
      let ignored = false
      for (const rule of rules) {
        if (ruleMatches(rule, relativePath, isDirectory)) {
          ignored = !rule.negated
        }
      }
      return ignored
    },
  }
}

async function nearestGitIgnorePath(path: string): Promise<string | undefined> {
  let directoryPath = await FS.isFile(path) ? FS.dirname(path) : path
  while (true) {
    const gitIgnorePath = FS.resolvePath('.gitignore', { cwd: directoryPath })
    if (await FS.isFile(gitIgnorePath)) {
      return gitIgnorePath
    }
    const parent = FS.dirname(directoryPath)
    if (parent === directoryPath) {
      return undefined
    }
    directoryPath = parent
  }
}

function parseGitIgnore(source: string): GitIgnoreRule[] {
  return source.split(/\r?\n/)
    .map(parseGitIgnoreLine)
    .filter(rule => rule !== undefined)
}

function parseGitIgnoreLine(line: string): GitIgnoreRule | undefined {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) {
    return undefined
  }
  const negated = trimmed.startsWith('!')
  const rawPattern = negated ? trimmed.slice(1) : trimmed
  const directoryOnly = rawPattern.endsWith('/')
  const withoutTrailingSlash = directoryOnly ? rawPattern.slice(0, -1) : rawPattern
  const anchored = withoutTrailingSlash.startsWith('/')
  const pattern = anchored ? withoutTrailingSlash.slice(1) : withoutTrailingSlash
  if (pattern === '') {
    return undefined
  }
  return { anchored, directoryOnly, negated, pattern, regex: gitIgnorePatternRegex(pattern, anchored) }
}

function ruleMatches(rule: GitIgnoreRule, relativePath: string, isDirectory: boolean): boolean {
  if (rule.directoryOnly && !isDirectory) {
    return false
  }
  return rule.regex.test(relativePath)
}

function gitIgnorePatternRegex(pattern: string, anchored: boolean): RegExp {
  const source = pattern.includes('/')
    ? `${anchored ? '^' : '(^|.*/)'}${globRegex(pattern)}(?:/.*)?$`
    : `(^|.*/)${globRegex(pattern)}(?:/.*)?$`
  return new RegExp(source)
}

function globRegex(pattern: string): string {
  let source = ''
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index]!
    if (char === '*') {
      if (pattern[index + 1] === '*') {
        source += '.*'
        index++
      } else {
        source += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    source += escapeRegExp(char)
  }
  return source
}

function escapeRegExp(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char
}
