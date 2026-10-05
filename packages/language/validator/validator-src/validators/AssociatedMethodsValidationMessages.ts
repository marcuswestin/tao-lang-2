export const AssociatedMethodsValidationMessages = {
  owner: 'Associated methods must belong directly to a named type body.',
  family: 'Associated methods in this slice require a named text type.',
  failureBound: "This callable bound supports only 'fails never'.",
  duplicateRequirement: (name: string) => `Capability method '${name}' is declared more than once.`,
  duplicateParameter: (name: string) => `Capability parameter '${name}' is declared more than once.`,
} as const
