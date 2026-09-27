FROM ubuntu:24.04 AS base

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
       curl ca-certificates xz-utils git tar coreutils util-linux \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
