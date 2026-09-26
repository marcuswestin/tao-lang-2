import TR from '@tao/runtime'

/** Fixture observer over the same live catalog the visible Tao query renders. */
export function VerifyRows(message: string, quantity: number, marked: boolean, count: number): void {
  const rows = TR.Data.interactionCandidates('AgentCommandEntry') as readonly {
    Message: string
    Quantity: number
    Marked: boolean
  }[]
  if (
    rows.length !== count
    || rows.some(row => row.Message !== message || row.Quantity !== quantity || row.Marked !== marked)
  ) {
    TR.Errors.failHost(`Expected ${count} saved matching entries; found ${rows.length} entries.`)
  }
}
