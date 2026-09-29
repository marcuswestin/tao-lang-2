import { Expect, Test } from '@shared/test'
import { type SketchSnapCheckpoint, StudioCheckpointLedger } from '../studio-src/session/StudioCheckpointLedger'
import { StudioSourceActionConflictError } from '../studio-src/session/StudioSourceConflicts'

const projectRoot = '/project'

function snap(id: string, path: string): SketchSnapCheckpoint {
  return {
    afterCatalogRevision: 1,
    afterContent: 'after',
    afterSourceVersion: 'after',
    beforeContent: 'before',
    beforeSourceVersion: 'before',
    id,
    path: `${projectRoot}/${path}`,
    status: 'committed',
    undoAction: { id: 'sketch', kind: 'delete-sketch' },
  }
}

Test('undoes the latest checkpoint of a file past later edits to other files', () => {
  const ledger = new StudioCheckpointLedger(projectRoot, () => {})
  const first = snap('first', 'A.tao')
  const second = snap('second', 'A.tao')
  const elsewhere = snap('elsewhere', 'B.tao')
  ledger.recordSketchSnap(first)
  ledger.recordSketchSnap(second)
  ledger.recordSketchSnap(elsewhere)

  let refusal: unknown
  try {
    ledger.sketchSnapUndoTarget('first')
  } catch (error) {
    refusal = error
  }
  Expect(refusal).toBeInstanceOf(StudioSourceActionConflictError)
  Expect(refusal).toMatchObject({ code: 'stale-source', details: { checkpointId: 'first', path: 'A.tao' } })
  Expect(ledger.sketchSnapUndoTarget('second')).toBe(second)
  ledger.markUndone(second)
  Expect(ledger.sketchSnapUndoTarget('first')).toBe(first)
  Expect(ledger.sketchSnapUndoTarget('elsewhere')).toBe(elsewhere)
  Expect(() => ledger.sketchSnapUndoTarget('second')).toThrow('Studio Snap checkpoint is not undoable: second')
})
