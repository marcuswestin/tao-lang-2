/** Pure test-control entry; importing it does not load or install the native runtime adapter. */
export {
  createHostTestEnvironment,
  type HostTestClock,
  HostTestControlError,
} from './HostTestEnvironment'
