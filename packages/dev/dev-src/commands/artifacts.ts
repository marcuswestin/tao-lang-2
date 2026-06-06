/** formatArtifactRunId creates a low-collision sortable artifact run id. */
export function formatArtifactRunId(date = new Date()): string {
  return `${formatArtifactTimestamp(date)}-${randomArtifactSuffix()}`
}

function formatArtifactTimestamp(date: Date): string {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
    '.',
    date.getMilliseconds().toString().padStart(3, '0'),
  ].join('')
}

function pad(value: number): string {
  return value.toString().padStart(2, '0')
}

function randomArtifactSuffix(): string {
  return Math.random().toString(36).slice(2, 8)
}
