/** RendererSlotsValidationMessages describes renderer slot contract diagnostics. */
export const RendererSlotsValidationMessages = {
  declarationPlacement: 'A render slot must be declared directly in a view body.',
  duplicateDeclaration: (name: string) => `Render slot '${name}' is declared more than once in this view.`,
  duplicateParameter: (name: string) => `Render slot parameter '${name}' is declared more than once.`,
  /** Retained for source-test compatibility; placement multiplicity is no longer diagnosed. */
  renderSlotPlacementCount: (name: string) =>
    `View render slot '${name}' must be placed exactly once in its render tree.`,
  referencePlacement: 'A bare render slot reference is only available in its owning view render tree.',
  fillPlacement: 'A render slot fill must be a direct child of an invocation of its owning view.',
  duplicateFill: (name: string) => `Render slot '${name}' is filled more than once at this call site.`,
  absentBody: (name: string) => `Render slot '${name}' requires a renderer, an inline body, or 'empty' after ':'.`,
  argumentDuplicateParameterType: (name: string) =>
    `Renderer slot placement has multiple parameters of type '${name}' that cannot be distinguished.`,
  argumentDuplicateType: (name: string) =>
    `Renderer slot placement has multiple arguments of type '${name}' that cannot be distinguished.`,
  argumentUnknownName: (name: string) => `Renderer slot placement has no parameter named '${name}'.`,
  argumentDuplicateName: (name: string) => `Renderer slot placement supplies parameter '${name}' more than once.`,
  argumentNamedType: (name: string) => `Renderer slot argument '${name}' has an incompatible type.`,
  argumentAmbiguous: 'Renderer slot argument could bind to more than one parameter.',
  argumentUnmatched: 'Renderer slot argument does not match a parameter.',
  argumentMissing: (name: string) => `Renderer slot placement is missing required parameter '${name}'.`,
  rendererDuplicateInput: (name: string) =>
    `Renderer has multiple inputs for slot role '${name}' that cannot be distinguished.`,
  rendererUnknownRole: (name: string) => `Renderer has no input matching slot role '${name}'.`,
  rendererDuplicateRole: (name: string) => `Renderer supplies slot role '${name}' more than once.`,
  rendererRoleType: (name: string) => `Renderer input for slot role '${name}' has an incompatible type.`,
  rendererAmbiguous: 'Renderer inputs do not correspond unambiguously to the render slot contract.',
  rendererUnmatched: 'Renderer has an input that does not match the render slot contract.',
  rendererMissing: (name: string) => `Renderer is missing required slot input '${name}'.`,
  rendererRequiresInput: (name: string) =>
    `Renderer requires input '${name}', but the render slot contract does not provide it.`,
  rendererInputDomain: (name: string) =>
    `Renderer input '${name}' accepts a narrower type than its render slot contract.`,
  rendererOmission: (name: string) =>
    `Renderer input '${name}' is required, but its render slot contract allows omission.`,
  rendererStorage: (name: string) => `Renderer input '${name}' is writable, but its render slot contract is readonly.`,
  rendererWriteDomain: (name: string) =>
    `Renderer input '${name}' can write values outside its render slot contract domain.`,
  rendererFailureBound: 'Renderer does not satisfy the render slot failure contract.',
  inlineInputs: (name: string) =>
    `Inline content for render slot '${name}' takes no inputs, but its contract declares typed inputs.`,
  inlineInputCount: (name: string, available: number) =>
    `Inline renderer for slot '${name}' accepts at most ${available} input names.`,
  duplicateInlineInput: (name: string) => `Inline renderer input '${name}' is declared more than once.`,
} as const
