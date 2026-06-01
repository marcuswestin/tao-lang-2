set quiet := true

help:
  just --list

test:
  echo "Not implemented yet"

fmt:
  dprint fmt

check:
  dprint check

build:
  echo "Not implemented yet"

clean:
  echo "Not implemented yet"

fix: fmt

prep-commit: test fix check
