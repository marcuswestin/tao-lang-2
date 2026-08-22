import TR from '@runtime/TR'

/** StackNavKind is the back-stack navigator implementation. */
export const StackNavKind = () => TR.NavKind.Stack()

/** SlotNavKind is the replaceable detail-pane navigator implementation. */
export const SlotNavKind = () => TR.NavKind.Slot()

/** SelectionNavKind is the adaptive tabs-or-sidebar navigator implementation. */
export const SelectionNavKind = () => TR.NavKind.Selection()
