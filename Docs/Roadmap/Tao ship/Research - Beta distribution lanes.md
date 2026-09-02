# Research - Beta distribution lanes

Facts gathered from the open web on 2026-09-01 that bound `Plan - Beta distribution in one
command.md`. Sources are official Expo, Apple, and Google pages plus the `expo/eas-cli` changelog
and source; dates are the pages' own "last updated" stamps where shown. Re-verify before relying
on a number that has aged.

## One-command TestFlight already exists in the substrate

- `npx testflight` is a one-file wrapper: `npx eas-cli@latest build -p ios --submit` with all
  arguments forwarded. https://github.com/expo/testflight ; docs (2026-07-21):
  https://docs.expo.dev/build-reference/npx-testflight/
- `--submit` is an alias of `--auto-submit` since eas-cli 14.7.0 (2025-01-30).
  https://github.com/expo/eas-cli/blob/main/CHANGELOG.md
- `eas submit` registers the bundle identifier and creates the App Store Connect app record when
  missing (`ensureBundleIdExistsWithNameAsync`, `ensureAppExistsAsync`), creates an internal
  TestFlight group (14.6.0), and since 22.0.0 (2026-08-14) invites admin testers; opt out with
  `--no-auto-testflight-setup` or `EAS_NO_AUTO_TESTFLIGHT_SETUP`.
  https://github.com/expo/eas-cli/blob/main/packages/eas-cli/src/submit/ios/AppProduce.ts
- No macOS required; the build runs on EAS. `eas.json` is generated if absent; setting
  `submit.production.ios.ascAppId` enables non-interactive runs.
- Credentials: App Store Connect API key (EAS can create one) or Apple ID plus app-specific
  password; EAS manages the distribution certificate, provisioning profiles (12-month expiry), and
  push keys. https://docs.expo.dev/submit/ios/ ; https://docs.expo.dev/app-signing/app-credentials/
- Newer status commands: `eas submit:list/view/retry/cancel/status` (21.5.0), `eas
  testflight:feedback` and `eas testflight:crashes` (21.3.0).

## TestFlight rules

- Internal testers: up to 100 team members holding an App Store Connect role; no Beta App Review.
  https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers
- External testers: up to 10,000; the first build of a version needs Beta App Review; public links
  with an optional cap. https://www.developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers
- Builds are testable for 90 days; up to 100 shared builds; a tester may use up to 30 devices.
  https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview
- Processing has no published SLA; Expo's guide says 5–10 minutes, community reports 10–30.
  https://docs.expo.dev/submit/testflight/
- Apple Developer Program: US$99 per membership year.
  https://developer.apple.com/programs/whats-included/

## EAS internal distribution

- `"distribution": "internal"` yields a shareable install page and QR; unauthenticated access is
  on by default and can be disabled per project. https://docs.expo.dev/build/internal-distribution/
- iOS ad hoc: `eas device:create` sends a registration link that captures the UDID; a new device
  requires a rebuild or re-signing; Apple allows 100 devices per product family per membership
  year, and newly registered devices can take up to 72 hours to become installable.
  https://developer.apple.com/help/account/devices/devices-overview
- Android: an APK the tester sideloads; no registration.
- Artifacts are kept up to 90 days. https://expo.dev/security
- Workflows gained an `apple-device-registration-request` job in 2026.
  https://docs.expo.dev/eas/workflows/pre-packaged-jobs/

## iOS without a paid developer account: who needs what

- The tester never needs a developer account. TestFlight needs the TestFlight app and an
  invitation by email or public link; a public-link joiner appears as anonymous.
  https://testflight.apple.com/
- The free Apple ID personal team registers at most 3 devices and 10 app ids, each expiring after
  7 days, and lists TestFlight, App Store, and ad hoc distribution as paid-only; devices register
  only by cabling them to Xcode. https://developer.apple.com/support/compare-memberships/
- Tester-side sideloading (AltStore, SideStore, Sideloadly) still works on iOS 26 with the same
  7-day re-sign and 3-app cap on a free Apple ID, and needs a computer or a pairing setup; Apple
  describes free signing as personal on-device testing. TrollStore covers only iOS 14 to 17.
  https://faq.altstore.io/
- EU web distribution and alternative marketplaces still require the Developer Program and
  notarization; Apple's 2026-08-18 change, effective 2026-10-01, replaces the two-year and
  one-million-install gate with financial-standing criteria and a flat 5% commission. Brazil got
  the same model on 2026-06-18. https://developer.apple.com/support/web-distribution-eu ;
  https://developer.apple.com/support/apps-in-the-eu/
- The Enterprise Program is for organizations with 100 or more employees, internal apps only.
  https://developer.apple.com/programs/enterprise/
- Nothing at WWDC26 or in Apple's developer news through 2026-09-01 changes membership tiers or
  tester distribution. https://developer.apple.com/news/

## Expo Go: the zero-account lane, and its state

- The ownership rule of 2026-05-12 is scoped to "updates published to EAS Update" and applies to
  every Expo Go version; a tester who is a member of the developer's Expo organization can load
  the project. Free-plan organizations allow unlimited members; the Viewer role "can only view
  your projects through Expo Go". https://expo.dev/changelog/expo-go-loading-changes-may-2026 ;
  https://docs.expo.dev/accounts/account-types/ ; https://expo.dev/pricing
- Expo's own words on the App Store version (2026-05-04): "a version of Expo Go for SDK 55 is
  still waiting for approval on the Apple App Store … we cannot provide a timeline", and "Expo
  Go for SDK 54 will continue to be available on both the App Store and Play Store". The SDK 56
  and SDK 57 changelogs repeat that no timeline exists. Expo gives no cause; no page cites Apple
  review or a guideline. https://expo.dev/changelog/expo-go-and-app-store-may-2026 ;
  https://expo.dev/changelog/sdk-56 ; https://expo.dev/changelog/sdk-57 ;
  https://github.com/expo/expo/discussions/44036
- Store listings on 2026-09-01: App Store Expo Go 54.0.2 (2025-09-23); Google Play 54.0.8.
  https://apps.apple.com/us/app/expo-go/id982107779

## Expo Go: Expo's stated alternatives

- Expo's own recommendations for review and testing are store testing tracks, internal
  distribution, or development builds with EAS Update.
  https://expo.dev/changelog/expo-go-loading-changes-may-2026
- The App Store Expo Go is SDK 54; SDK 55 and later are not on the App Store and reach a physical
  iPhone only through `eas go`, which builds a private Expo Go to the developer's TestFlight team.
  https://expo.dev/changelog/expo-go-and-app-store-may-2026 ; https://expo.dev/changelog/sdk-57
- Expo positions Expo Go as an educational tool and development builds as the default for real
  apps. https://expo.dev/blog/expo-go-vs-development-builds

## Development builds and EAS Update

- A channel is baked into a build; a branch holds updates; by default they share a name; platform
  and runtime version must match exactly. https://docs.expo.dev/eas-update/how-it-works/
- `eas update --channel <name> --message "…"` publishes; release and preview builds pull on launch;
  development builds expose updates in the Extensions tab after an Expo login, or through the
  dashboard's Preview QR. https://docs.expo.dev/eas-update/getting-started/ ;
  https://docs.expo.dev/eas-update/expo-dev-client/
- `runtimeVersion: { policy: "fingerprint" }` derives the runtime version from `@expo/fingerprint`
  over dependencies, native code, native project files, and configuration; `.fingerprintignore`
  is honored. https://docs.expo.dev/eas-update/runtime-versions/ ;
  https://docs.expo.dev/versions/latest/sdk/fingerprint/

## EAS Workflows

- `.eas/workflows/*.yml`, run with `eas workflow:run`; the official "Deploy to production" example
  chains fingerprint, get-build, conditional build, submit, or update in one file.
  https://docs.expo.dev/eas/workflows/examples/deploy-to-production/
- Pre-packaged jobs include `build`, `submit`, `testflight` (internal and external groups,
  changelog, `submit_beta_review`), `update`, `update-rollout`, `fingerprint`, `get-build`,
  `maestro`, `require-approval`. https://docs.expo.dev/eas/workflows/pre-packaged-jobs/
- Free plan: 60 workflow minutes; paid plans are usage-based per minute by runner.
  https://expo.dev/pricing

## Pricing and local builds

- Free: 15 Android and 15 iOS builds per calendar month, low-priority queue, one concurrent build,
  45-minute timeout, 1,000 update MAUs; no overage, quota resets on the first.
  https://expo.dev/pricing ; https://docs.expo.dev/billing/plans/ ; https://docs.expo.dev/billing/faq/
- Starter US$19/month with US$45 build credit then per build (iOS medium US$2, large US$4; Android
  US$1/US$2); Production US$199/month; updates US$0.005 per MAU over the included tier.
- `eas build --local` builds one platform on the developer's machine with Node, fastlane,
  CocoaPods, and Xcode; no caching, no EAS secrets; Expo names it as the way to keep building past
  an exhausted quota. https://docs.expo.dev/build-reference/local-builds/

## Android developer verification

- Timeline: system service from June 2026, limited-distribution accounts and the Android
  Developer Console API globally in August 2026, regional deadline 2026-09-30 in Brazil,
  Indonesia, Singapore, and Thailand for participating stores, global rollout for all certified
  devices in 2027. https://android-developers.googleblog.com/2026/06/android-developer-verification.html ;
  https://developer.android.com/developer-verification
- Google's FAQ: sideloaded and third-party-store apps are not yet affected in September 2026;
  its limited-distribution guide says unregistered packages "will no longer be installable on
  certified Android devices" in the four countries. The two pages disagree on direct APK installs.
  https://developer.android.com/developer-verification/guides/faq ;
  https://developer.android.com/developer-verification/guides/limited-distribution
- Accounts: a free limited-distribution account shares with up to 20 explicitly authorized
  devices and needs no government id; the full-distribution account costs US$25. An advanced
  flow lets a user allow unverified developers after a 24-hour wait; ADB installs are exempt.
  https://android-developers.googleblog.com/2026/03/android-developer-verification.html
- Firebase App Distribution is alive and free in 2026; its iOS lane is ad hoc and needs the paid
  Apple program. https://firebase.google.com/docs/app-distribution

## Android stores

- Google Play Console: US$25 once, identity verification, device verification for personal
  accounts. https://support.google.com/googleplay/android-developer/answer/6112435
- Internal testing: up to 100 testers, available within minutes, not subject to standard review.
  https://support.google.com/googleplay/android-developer/answer/9845334
- Personal accounts created after 2023-11-13 need a closed test with 12 testers for 14 days before
  production access; this gates production, not internal testing.
  https://support.google.com/googleplay/android-developer/answer/14151465
- `eas submit --platform android` needs a Google service account key and lands on the internal
  track by default. https://docs.expo.dev/submit/android/

## Apple's rules for a developer preview app

- Guideline 2.5.2 forbids apps that "download, install, or execute code which introduces or
  changes features or functionality", with an exception for educational apps whose source is
  "completely viewable and editable by the user". Guideline 4.7 admits "HTML5 and JavaScript
  mini apps" that may not "extend or expose native platform APIs". The program license
  agreement's 3.3.1(B) permits interpreted code run by WebKit or JavaScriptCore that does not
  change the app's primary purpose. https://developer.apple.com/app-store/review/guidelines/
- March 2026 enforcement: Apple blocked updates for Replit and Vibecode (2.5.2 and 3.3.1(B))
  and removed Anything ("Gatekeeping"), saying a user could "build a harmful app, sideload it on
  their phone, and then claim that it passed Apple's App Review process". Replit returned in May
  2026 by previewing in the browser; Vibecode repositioned as a website builder; Anything was
  removed again for marketing itself as an app maker.
  https://www.macrumors.com/2026/03/18/apple-blocks-updates-for-vibe-coding-apps/ ;
  https://www.macrumors.com/2026/03/30/apple-pulls-vibe-coding-app/ ;
  https://techcrunch.com/2026/04/14/how-vibe-coding-app-anything-is-rebuilding-after-getting-booted-from-the-app-store-twice/
- On the App Store on 2026-09-01: Expo Go, Thunkable Live (updated 2026-08-31), Draftbit Preview,
  Bravo Vision, Codea, Swift Playgrounds, Pythonista, Scriptable, Replit. All the preview
  companions require the owner's account. Play, a drag-and-drop SwiftUI design tool on iPhone,
  won a 2025 Apple Design Award and was acquired by Apple in June 2026.
  https://apps.apple.com/us/app/thunkable-live/id1223262700 ;
  https://apps.apple.com/us/app/draftbit-preview/id1605807667 ;
  https://www.macrumors.com/2026/06/29/apple-acquires-award-winning-app-play/

## Adjacent tools

- Expo Launch: browser flow from a public GitHub repository to TestFlight and EAS Hosting, no
  terminal; private repositories unsupported. https://expo.dev/blog/introducing-expo-launch
- Expo Orbit: desktop installer for EAS builds and updates onto simulators and devices.
  https://docs.expo.dev/build/orbit/
- `eas build:run --latest` runs simulator and emulator builds from the CLI.
  https://docs.expo.dev/build-reference/simulators/
- EAS Hosting: `expo export --platform web` then `eas deploy` for a preview URL.
  https://docs.expo.dev/eas/hosting/introduction/

## Not verified

- Why Expo Go's SDK 55 and later builds are waiting on Apple: no statement from either company.
- Whether Expo Go's ownership check also gates a tunnelled development server; the changelog
  scopes it to EAS Update.
- Whether direct APK installs in Google's four pilot countries stop on 2026-09-30.

- App Store Connect record creation by `eas submit` is verified from eas-cli source, not from a
  prose docs page.
- TestFlight processing times are community-reported.
- "Local builds do not count against the plan" is implied by Expo's billing FAQ wording, not
  stated verbatim.
