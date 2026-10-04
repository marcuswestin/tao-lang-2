# Checked conversion examples and inference evidence

S60 discussion input, updated by S61 on 2026-10-04. These are prospective examples, not current
parser/runtime contracts. Authored explicit as conversions may fail; static factories use static func.
Named library types and their policies below are illustrative, not new core-type selections.

## Conversion forcing cases

Starred cases are strong candidates for fallible as: a declared unary conversion checks or transforms
representation into one specified target domain, with no contextual I/O. Every conversion requires
authorization; merely sharing primitive storage does not authorize a sibling/downward conversion.

| #  | Example                       | Possible failure                                    | Recommendation                                                                                          |
| -- | ----------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1  | `AdminID as UserID`           | None for declared ancestry                          | Ordinary widening; no new permission proof                                                              |
| 2  | `GivenName as Name`           | None for declared ancestry                          | Ordinary widening                                                                                       |
| 3  | `UUID as text`                | None if public representation projection is allowed | Representation access, not secret/opaque extraction                                                     |
| 4  | `(2 Seconds).Minutes()`       | None for an in-range view change                    | Existing typed unit-view operation, no raw-number extraction                                            |
| 5  | `Input as UUID`               | InvalidFormat                                       | Star: UUID syntax/representation validation                                                             |
| 6  | `Input as AbsoluteURL`        | InvalidFormat/ConstraintViolation                   | Star: syntax and declared scheme constraints; not network reachability                                  |
| 7  | `Input as EmailAddress`       | InvalidFormat/ConstraintViolation                   | Star: declared syntax policy; not deliverability/ownership proof                                        |
| 8  | `ColorText as Color`          | InvalidFormat/OutOfRange                            | Star: a declared color syntax and channel ranges                                                        |
| 9  | `Payload as UTF8Text`         | InvalidEncoding                                     | Star: bytes must form valid UTF-8 under the declared decoding policy                                    |
| 10 | `Names as NonEmptyNames`      | ConstraintViolation: empty                          | Star: present list refinement; do not conflate empty and none                                           |
| 11 | `Names as UniqueNames`        | ConstraintViolation: duplicates                     | Star: validate uniqueness; do not silently remove duplicates                                            |
| 12 | `Amount as NonNegativeAmount` | ConstraintViolation: negative                       | Star: checked scalar refinement                                                                         |
| 13 | `Value as Int32`              | Fractional input/OutOfRange                         | Star: checked native/IO integer representation; no implicit truncation                                  |
| 14 | `Value as ExactFloat32`       | OutOfRange/PrecisionLoss                            | Star: target explicitly promises exact finite binary32 representation                                   |
| 15 | `Amount as USDCents`          | PrecisionLoss/OutOfRange                            | Star: declared exact decimal-money representation; reject sub-cent rounding unless separately requested |
| 16 | `EUR as USD`                  | Needs exchange rate, policy and possibly I/O        | Prefer `ConvertMoney(EUR, Rate)`; no ambient hidden rate lookup                                         |
| 17 | `ProductID as Product`        | NotFound/permission/network                         | Prefer `do GetProduct(ProductID)`; this is provider acquisition                                         |
| 18 | `Compressed as DecodedBytes`  | InvalidEncoding/unsupported format/resource bounds  | Prefer `Decompress(Compressed, Limits)` when decoding needs explicit resource policies                  |

Rows 5–15 demonstrate that failure is not restricted to floating-point edge cases. Dataset adapters
remain the default owner of serialization/deserialization; these app-level operations are useful for
local input, native interoperability and explicitly requested refinements. They do not require apps
to implement their own wire codecs. Money representation/rounding must be declared; binary64 alone
does not provide exact decimal money, and a unit-view change is not necessarily a data rescaling.

S61 selects a shared ConversionFailure family covering format, encoding, range, precision and
constraint failures. InvalidFormat, InvalidEncoding, OutOfRange, PrecisionLoss and ConstraintViolation
remain illustrative leaf spellings, as do SourceType, TargetType, Reason, safe Message and relevant
Path/bounds metadata fields. Preserve domain-specific failures and
original causes rather than wrapping every operation into an uninformative generic conversion error.

Tao's selected finite numeric representation means NaN and infinity are not ordinary numeric values
applications must branch on. Reject them at foreign numeric ingress or numeric result validation.
Overflow, nonfinite results and inexact representation may be common numeric reason categories;
invalid input formats, list constraints and decoding remain separate needs. Rounding, clamping and
truncation should be explicitly requested policy/operations rather than silent successful checks.

## Whole-app and per-value failure inference

S61 accepts this precision direction but defers automatic proven capability-instance/call-site and
whole-program refinement to [post-MVP](<../Capability failure refinement.md>). Ordinary body/callee
inference remains selected. Future approach: carry failure summaries with concrete methods/callable values,
including through structural capabilities. Instantiate summaries at call sites and use conservative
reachable-target sets; iterate recursive call components to a fixed point. Preserve unknown if any
reachable target is unknown. Removing handled effects and proven unreachable alternatives can
reduce the upper bound. Bodyless can omission remains an open published contract, even if a
particular compiled call has a provably smaller concrete effect set.

For `Label(Value Display) { return Value.ToText() }`, a known PlainTitle implementation can yield
fails never, a known decoded-text implementation can yield InvalidEncoding, and a runtime choice
can yield the union. This is a per-call specialization, not rewriting Display globally based on the
first implementation encountered. Follow mutable captures/aliases across their lifetime; a value
snapshot or one observed runtime branch is not proof of all future targets or inputs.

All source-visible implementations are not automatically a closed world. Foreign callbacks,
separately compiled consumers, provider-supplied values, dynamic registration and open extension
points need trusted contracts or conservative unknown. Exact semantic enumeration of every failure
that will actually happen is generally not decidable. Finite, sound upper bounds over proven closed
targets and hidden effect-polymorphic summaries are useful without promising the complete A27 proof.
The current EffectOutcomesValidator only warns on root declared effects; it does not implement this
interprocedural capability analysis or the proposed mandatory coverage guarantee.

Primary-source evidence:

- [Koka polymorphic effects](https://koka-lang.github.io/koka/doc/book.html#sec-polymorphic-effects)
  carries callback effects through map and combines callback effects by union. This supports the
  shape of effect-polymorphic inference; it does not claim exact exception-payload enumeration.
- [Clang LTO visibility](https://clang.llvm.org/docs/LTOVisibility.html) explains why whole-program
  devirtualization requires the entire hierarchy to be visible. This is evidence for knowledge
  boundaries, not a claim that Clang infers failure-case sets.
- [Rust TryFrom](https://doc.rust-lang.org/std/convert/trait.TryFrom.html) uses typed conversion
  errors for cases such as integer narrowing; [From](https://doc.rust-lang.org/std/convert/trait.From.html)
  describes infallible conversions. [Numeric casts](https://doc.rust-lang.org/reference/expressions/operator-expr.html#numeric-cast)
  illustrate truncation, saturation and rounding policies that checked Tao conversion should not
  silently copy. These precedents support checked conversion as a concept, not selection of Tao as.
- [Swift failable initializers](https://raw.githubusercontent.com/swiftlang/swift-book/main/TSPL.docc/LanguageGuide/Initialization.md)
  and exact numeric initialization provide another construction-oriented alternative to fallible as.

## Shared app guard and static-factory examples

Selected app-wide unknown/known fallback, prospective generalized routing:

```tao
app LibraryApp {
   view Screen
   guard { error Problem -> "{Problem.Message}" }
}
action Save() {
   do Upload()
   do Index()
}
view Screen {
   render Button("Save") { on press -> do Save() }
}
```

The owned app guard supplies presentation coverage once. Upload failure aborts Save, runs joined
cleanup and skips Index; presentation does not resume at the failed call. Action/receipt notices
preserve healthy content; unavailable reads use inline replacement under the selected direction.
Owned async roots and later receipts need explicit runtime ownership/routing, not lexical resumption.
Local then handlers remain for special recovery. Unexpected faults/termination are distinct from
modeled failure coverage. This integration remains design, not an implementation claim.

Static factory prototypes (bodies omitted):

```tao
type UUID is text with {
   static func UUID.Parse(Input text) { ... }
}
type Matrix is MatrixData with {
   static func Matrix.Identity(Size) { ... }
}
type Image is ImageData with {
   static func Image.FromRGBA(Pixels, Width, Height) { ... }
}
```

Each creates the first value without a receiver instance. Global ParseUUID/IdentityMatrix/ImageFromRGBA
functions can express the same behavior; a static facility provides grouping/discoverability, not
otherwise impossible computation. Generated unit/JS factories are already compiler-owned; authored
factory syntax is a separate decision. Type-versus-value name shadowing and inherited static return
types require explicit resolution/prototypes before claiming a coherent static method facility.
