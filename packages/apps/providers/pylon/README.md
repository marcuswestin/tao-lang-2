# Pylon backend deployment

`tao pylon generate` writes a backend manifest whose `auth.trustedOrigins` is empty. Configure the deployed backend's trusted browser origin before starting a non-development server, for example with `PYLON_CORS_ORIGIN=https://app.example.com`. Set the actual application origin for that deployment; do not copy the example value. Pylon also accepts `PYLON_TRUSTED_ORIGINS` for a shared CORS, CSRF, and OAuth origin allowlist, or separate `PYLON_CSRF_ORIGINS` where needed. Loopback development origins are trusted by Pylon automatically.

The generated `functions/taoCommit.ts` and `functions/taoEnsureAccount.ts` import `@pylonsync/functions`; install the pinned `0.20.0` package in the generated backend project before building or deploying it.
