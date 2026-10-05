export const AssociatedMethodsValidationMessages = {
  owner: 'Associated methods must belong directly to a named type body.',
  family: 'Associated methods in this slice require a named text type.',
  placement: 'Associated method owners in this slice must be file-level types.',
  nativeMutable: 'Mutable native parameters cannot carry a capability in this slice.',
  unknown: (name: string) => `No associated method '${name}' belongs to this receiver.`,
  pending: (name: string) => `Associated method '${name}' has an unresolved callable contract.`,
  purity: (name: string) => `Associated method '${name}' requires a complete pure effect contract.`,
  failures: (name: string) => `Associated method '${name}' does not satisfy its declared failure bound.`,
  failureBound: "This callable bound supports only 'fails never'.",
  duplicateRequirement: (name: string) => `Capability method '${name}' is declared more than once.`,
  duplicateParameter: (name: string) => `Capability parameter '${name}' is declared more than once.`,
} as const
