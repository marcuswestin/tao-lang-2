import { TestLedger, type TestObservation, type ToleratedFlake } from './TestLedger'

/**
 * A test the ledger has watched flip outcome without its file changing is, by this repository's own
 * definition, a flake. Demoting one by hand is a judgment nobody makes in the middle of a red lane,
 * so the lane makes it: a node whose *only* failures are tests with that recorded history stops
 * failing the lane by itself.
 *
 * Three properties keep that from becoming a way for a real regression to hide.
 *
 * - It is never silent. Every demoted test is named in the summary with the evidence that demoted
 *   it, and a lane that passed only because of one says so in its verdict line. A tolerated failure
 *   costs a reader exactly as much attention as a red one; what it no longer costs is the lane.
 * - It is never partial cover. One failure the ledger cannot vouch for and the node fails as it
 *   always did, with every failure it had. Tolerance is all of a node's failures or none of them,
 *   because "these two failures are flakes and that one is real" is a claim about a process whose
 *   tests share state, and nothing here can make it.
 * - It is never about a whole process. A node that timed out, crashed, or could not produce a report
 *   has no per-test verdict to tolerate; `TestRunner` synthesizes a stand-in observation for exactly
 *   that case, and a stand-in is refused here by name. Tolerating one would mean tolerating a hung
 *   suite, which is the failure that most needs to stop a lane.
 *
 * `TestLedger.tolerated` owns how much history earns tolerance and what takes it away; this module
 * owns only which of a finished run's nodes that history covers.
 */

/**
 * The observation names `TestRunner` synthesizes when a node failed without reporting per-test
 * results: one stands for a whole process, the other for the whole Tao behavior corpus. Neither is
 * a test, so neither is demotable however often it has flipped.
 */
/**
 * The name a whole-process failure is recorded under. It is exported because the runner writes it
 * and this module refuses to demote it, and the two agreeing is the whole of the rule: a process
 * that crashed or timed out named no test, so nothing about it can have earned tolerance. Spelling
 * it twice would let a rename quietly make every whole-process failure demotable.
 */
const PROCESS_STAND_IN_NAME = 'suite process'
const TAO_APPS_FILE = 'Apps'

/** DemotedTest is one test a node failed on that the lane declined to fail on, and why. */
export type DemotedTest = ToleratedFlake & {
  /** The node whose failure this test caused. */
  node: string
  /** The suite that node reports under. */
  nodeSuite: string
}

/** ToleranceReport is what one run's demotion decided: which nodes, and on which tests' evidence. */
export type ToleranceReport = {
  demoted: readonly DemotedTest[]
  /** Node names whose every failure was demoted, so the summary reports them as passed. */
  nodes: ReadonlySet<string>
}

/** ToleranceNode is the little of a finished test node this decision reads. */
export type ToleranceNode = {
  name: string
  status: string
  suite: string
  testObservations?: readonly TestObservation[]
}

const EMPTY: ToleranceReport = { demoted: [], nodes: new Set() }

/** empty is the report of a run that demoted nothing, for a lane with no test nodes at all. */
function empty(): ToleranceReport {
  return EMPTY
}

/**
 * apply decides, for each failed test node, whether the ledger accounts for every failure in it.
 * It is pure: it reads the finished states and the ledger's verdicts and returns what it found,
 * leaving `buildSummary` the one place that turns that into a status.
 */
function apply(nodes: readonly ToleranceNode[], tolerated: readonly ToleratedFlake[]): ToleranceReport {
  if (tolerated.length === 0) {
    return EMPTY
  }
  const byId = new Map(tolerated.map(flake => [flake.id, flake]))
  const demoted: DemotedTest[] = []
  const demotedNodes = new Set<string>()
  for (const node of nodes) {
    if (node.status !== 'failed') {
      continue
    }
    const failures = (node.testObservations ?? []).filter(observation => observation.outcome === 'failed')
    if (failures.length === 0 || failures.some(isProcessStandIn)) {
      continue
    }
    const covered = failures.map(failure => byId.get(TestLedger.testId(failure)))
    if (covered.some(flake => flake === undefined)) {
      continue
    }
    demotedNodes.add(node.name)
    for (const flake of covered) {
      demoted.push({ ...flake!, node: node.name, nodeSuite: node.suite })
    }
  }
  return { demoted, nodes: demotedNodes }
}

function isProcessStandIn(observation: TestObservation): boolean {
  return observation.name === PROCESS_STAND_IN_NAME || observation.file === TAO_APPS_FILE
}

/** FlakeTolerance owns which of a finished run's failures the recorded flake history accounts for. */
export const FlakeTolerance = { apply, empty, PROCESS_STAND_IN_NAME } as const
