import TR from '@runtime/TR'

/** LocalProvider persists a full snapshot through the platform's local storage. */
export const LocalProvider = () => TR.DataProvider.Local()

/** MemoryProvider keeps a full snapshot in memory for previews and tests. */
export const MemoryProvider = () => TR.DataProvider.Memory()

/** HttpProvider serves query-driven remote reads; the configured Adapter owns every API mapping. */
export const HttpProvider = () => TR.DataProvider.Http()
