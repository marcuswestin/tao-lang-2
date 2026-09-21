import { declareTaoJourneys } from './tao-journey-harness'

// The whole-manifest entrypoint, which a bare `jest --config jest.tao-test.config.cjs` run reaches.
// `tao test` does not come this way: it generates one entrypoint per Tao test file into its run
// root so Jest's worker pool has files to distribute, and those entrypoints name their own file.
declareTaoJourneys()
