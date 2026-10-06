export const AssociatedMethodsValidationMessages = {
  converterOwner: 'Converters must belong directly to a named source or target type body.',
  converterAttachment: 'A converter must be attached to its declared source or target type.',
  converterNever: "A converter's 'fails never' bound cannot include other failure cases.",
  converterReturn: 'A converter must end with a return producing its target type.',
  converterResult: (expected: string, actual: string) =>
    `Converter returns ${expected}, but a return produces ${actual}.`,
  converterPurity: 'A converter requires a complete pure effect contract.',
  converterFailures: 'A converter does not satisfy its declared failure bound.',
  converterMissing: (source: string, target: string) => `No declared converter converts ${source} to ${target}.`,
  converterAmbiguous: (source: string, target: string) =>
    `Multiple equally applicable converters convert ${source} to ${target}.`,
  owner: 'Associated methods must belong directly to a named type body.',
  receiverOwner: (name: string, owner: string) => `Associated receiver '${name}' must match its owner '${owner}'.`,
  entityReceiverRequired: (owner: string) => `An entity associated function must declare receiver '${owner}'.`,
  entityReceiverShadow: (name: string) => `Entity receiver alias '${name}' cannot be shadowed by a parameter.`,
  family: 'Associated methods require a concrete text, numeric, item, or entity owner.',
  placement: 'Associated method owners in this slice must be file-level types.',
  nativeMutable: 'Mutable native parameters cannot carry a capability in this slice.',
  unknown: (name: string) => `No associated method '${name}' belongs to this receiver.`,
  pending: (name: string) => `Associated method '${name}' has an unresolved callable contract.`,
  purity: (name: string) => `Associated method '${name}' requires a complete pure effect contract.`,
  failures: (name: string) => `Associated method '${name}' does not satisfy its declared failure bound.`,
  duplicateImplementation: (owner: string, name: string) =>
    `Associated method '${name}' is declared more than once on '${owner}'.`,
  duplicateActionImplementation: (owner: string, name: string) =>
    `Associated action '${name}' is declared more than once on '${owner}'.`,
  failureBound: "'fails never' cannot be combined with named failures.",
  duplicateRequirement: (name: string) => `Capability method '${name}' is declared more than once.`,
  duplicateParameter: (name: string) => `Capability parameter '${name}' is declared more than once.`,
} as const
