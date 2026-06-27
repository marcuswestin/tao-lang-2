app := "."

run:
    tao run {{app}}

dev:
    tao dev {{app}}

design:
    tao design preview {{app}}

create:
    tao create still-complete --template default --preview

preview:
    tao design preview {{app}}

design-check:
    tao design check {{app}}

design-init:
    tao design init {{app}}

design-theme-preset:
    tao design theme --preset calm-local {{app}}

design-theme-seed:
    tao design theme --seed "#2f6b4f" {{app}}

design-fix:
    tao design fix --safe {{app}}

compile:
    tao compile {{app}}

test:
    tao test {{app}}

test-watch:
    tao test {{app}} --watch

test-json:
    tao test {{app}} --json

test-grep:
    tao test {{app}} --grep "runtime"

test-fail-fast:
    tao test {{app}} --fail-fast

test-web:
    tao test {{app}} --runtime=web

test-ios:
    tao test {{app}} --runtime=ios

test-android:
    tao test {{app}} --runtime=android

test-headless:
    tao test {{app}} --headless

test-package:
    tao test @still/mvp-kit

publish:
    tao publish {{app}} --channel public

package:
    tao package publish {{app}} --package StillMVPKit

install:
    tao install @ro/still-mvp --app-id still-mvp-installed
