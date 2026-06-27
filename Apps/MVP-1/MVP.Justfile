app := "."

run:
    tao run {{app}}

dev:
    tao dev {{app}}

design:
    tao design preview {{app}}

design-check:
    tao design check {{app}}

compile:
    tao compile {{app}}

test:
    tao test {{app}}

test-watch:
    tao test {{app}} --watch

test-json:
    tao test {{app}} --json

publish:
    tao publish {{app}} --channel public

package:
    tao package publish {{app}} --package StillMVPKit

install:
    tao install @ro/still-mvp --app-id still-mvp-installed
