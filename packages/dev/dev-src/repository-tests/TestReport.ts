import { FS } from '@shared'
import type { TestObservation } from './TestLedger'

export type NativeTestReport = {
  format: 'bun-junit' | 'jest-json'
  path: string
  suite: string
}

/** read converts a suite's native reporter file into runner-neutral per-test observations. */
async function read(report: NativeTestReport, repositoryRoot: string): Promise<TestObservation[] | undefined> {
  try {
    const source = await FS.readText(report.path)
    return report.format === 'bun-junit'
      ? parseBunJunit(source, report.suite, repositoryRoot)
      : parseJestJson(source, report.suite, repositoryRoot)
  } catch {
    // A process that failed before its reporter initialized has no per-test facts to add.
    return undefined
  }
}

function parseBunJunit(source: string, suite: string, repositoryRoot?: string): TestObservation[] {
  const observations: TestObservation[] = []
  for (const match of source.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attributes = xmlAttributes(match[1] ?? '')
    const file = normalizeFile(attributes.get('file') ?? '', repositoryRoot)
    const title = attributes.get('name') ?? '(unnamed test)'
    const describePath = attributes.get('classname') ?? ''
    const body = match[2] ?? ''
    observations.push({
      durationMs: secondsToMilliseconds(attributes.get('time')),
      file,
      name: [describePath, title].filter(Boolean).join(' > '),
      outcome: /<(?:failure|error)\b/.test(body) ? 'failed' : /<skipped\b/.test(body) ? 'skipped' : 'passed',
      suite,
    })
  }
  return observations.filter(observation => observation.file.length > 0)
}

type JestAssertion = {
  ancestorTitles?: unknown
  duration?: unknown
  fullName?: unknown
  status?: unknown
  title?: unknown
}

type JestFileResult = { assertionResults?: unknown; name?: unknown }

function parseJestJson(source: string, suite: string, repositoryRoot: string): TestObservation[] {
  const value = JSON.parse(source) as { testResults?: unknown }
  if (!Array.isArray(value.testResults)) {
    return []
  }
  const observations: TestObservation[] = []
  for (const rawFile of value.testResults) {
    const fileResult = rawFile as JestFileResult
    if (typeof fileResult.name !== 'string' || !Array.isArray(fileResult.assertionResults)) {
      continue
    }
    const file = normalizeFile(fileResult.name, repositoryRoot)
    for (const rawAssertion of fileResult.assertionResults) {
      const assertion = rawAssertion as JestAssertion
      const status = assertion.status
      if (typeof assertion.title !== 'string' || typeof status !== 'string') {
        continue
      }
      const ancestors = Array.isArray(assertion.ancestorTitles)
        ? assertion.ancestorTitles.filter((title): title is string => typeof title === 'string')
        : []
      observations.push({
        durationMs: typeof assertion.duration === 'number' ? assertion.duration : undefined,
        file,
        name: typeof assertion.fullName === 'string'
          ? assertion.fullName
          : [...ancestors, assertion.title].join(' > '),
        outcome: status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'skipped',
        suite,
      })
    }
  }
  return observations
}

function xmlAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>()
  for (const match of source.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    const name = match[1]
    const value = match[2]
    if (name !== undefined && value !== undefined) {
      attributes.set(name, decodeXml(value))
    }
  }
  return attributes
}

function decodeXml(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function secondsToMilliseconds(value: string | undefined): number | undefined {
  const seconds = Number(value)
  return Number.isFinite(seconds) ? seconds * 1_000 : undefined
}

function normalizeFile(file: string, repositoryRoot?: string): string {
  const normalized = FS.slashPath(file).replace(/^\.\//, '')
  if (repositoryRoot === undefined || normalized.length === 0) {
    return normalized
  }
  const absolute = FS.resolvePath(normalized, repositoryRoot)
  return FS.pathIsWithin(absolute, repositoryRoot)
    ? FS.slashPath(FS.relativePath(repositoryRoot, absolute))
    : normalized
}

/** TestReport owns the two controlled native reporter formats used by the test lane. */
export const TestReport = { parseBunJunit, parseJestJson, read } as const
