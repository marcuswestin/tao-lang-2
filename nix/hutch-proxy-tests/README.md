# Hutch HTTPS proxy regression checks

The Hutch Nix derivation compiles `client.zig` with its private patched Zig standard
library, then runs `node run.mjs /absolute/path/to/proxy-client` in `checkPhase`.
Only loopback sockets are opened. The harness checks TLS before HTTP, destination
certificate and hostname verification, pooled reuse, failed CONNECT without a
plaintext retry, and failed handshake cleanup. The client uses a debug allocator
and asserts that failed connections leave no pool entries.

`origin-cert.pem` and `origin-key.pem` are public test fixtures, never credentials
for a real service. The self-signed certificate is valid for `origin.test` and was
generated with OpenSSL using RSA 2048, SHA-256, a 36,500-day validity, the subject
`/CN=origin.test`, and extensions `subjectAltName=DNS:origin.test` and
`basicConstraints=critical,CA:TRUE`. Trust is installed only into the test client's
in-memory certificate bundle; neither system trust nor TLS settings are changed.
