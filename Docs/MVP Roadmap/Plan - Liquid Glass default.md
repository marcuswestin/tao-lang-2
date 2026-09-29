# Plan - Liquid Glass default

## Default and scope

New apps import `@tao/nav` and `@tao/ui` without a style opt-in. Their native navigation and controls use the platform implementations. On iOS 26 with a compatible SDK, the system draws Liquid Glass for tabs, headers, sheets, and controls it owns. Tao uses the regular material only for its custom floating toggle bar; app content and authored design surfaces remain opaque or author styled. The native host follows system light and dark appearance so the app content and system chrome agree. A scenario appearance pin and a replayed frame keep their existing precedence.

## Fallbacks

- Earlier iOS and an unavailable glass API retain the same native navigation and controls, with the platform's earlier material. The custom toggle bar uses its filled portable material.
- Android uses native Material navigation and controls. Web and behavior tests use the basic navigation and control hosts. A missing native module falls back to the basic host without losing destinations.
- A Tao app can explicitly import `@tao/nav/basic` or `@tao/ui/basic` for custom styling. New apps keep the native imports.

## Accessibility

- System owned chrome inherits Reduce Transparency, Increase Contrast, Reduce Motion, text scaling, and VoiceOver behavior from the OS. Tao does not force a glass effect onto content.
- Tao's custom toggle bar uses regular glass where available. When Reduce Transparency is on, it draws an opaque, high contrast material, including on iOS where glass is otherwise available. The setting is observed while the app is open. Its Back, title, toolbar, and next-item semantics stay the same.
- Test both light and dark system appearance and a live Reduce Transparency change. Device visual and assistive technology acceptance remains separate from code tests.

## Acceptance

Create a fresh one-feature and two-feature app with the installed `tao create` path. Confirm both import native navigation and UI, the two-feature app requests automatic tabs, the iOS host follows system appearance, and the native runtime resolves system Dark as Dark. Exercise the glass and opaque custom-bar paths. A compatible iOS build and direct simulator observation may confirm the actual material for MVP visual acceptance, as accepted by the Developer on 2026-09-28. The appearance and accessibility settings still need to be exercised in the simulator before closing A18.

References: [Component kits](<../Roadmap/Component kits/Overview - Component kits.md>), [native navigation acceptance](<../Roadmap/Add navigation and routing MVP/Native navigation acceptance.md>), [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Expo glass effect](https://docs.expo.dev/versions/v55.0.0/sdk/glass-effect/).
