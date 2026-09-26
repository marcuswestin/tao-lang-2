#!/bin/sh
# Fixed host operation. Never accepts Docker flags, paths, images, or host mounts.
set -eu

mode=both
probe=0
qemu_guest_base=0
qemu_nix_filter=0
inspect_run=
case "$#" in
  0) ;;
  1) case "$1" in
       --probe) probe=1 ;;
       --qemu-guest-base) qemu_guest_base=1 ;;
       --qemu-compat) qemu_guest_base=1; qemu_nix_filter=1 ;;
       *) printf 'Expected --probe, --qemu-guest-base, or --qemu-compat.\n' >&2; exit 2 ;;
     esac ;;
  2) case "$1" in
       --mode) case "$2" in cold|cached|both) mode=$2 ;; *) printf 'Expected cold, cached, or both.\n' >&2; exit 2 ;; esac ;;
       --inspect-run)
         case "$2" in
           [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z-*) ;;
           *) printf 'Expected a contributor run ID: YYYYMMDDTHHMMSSZ-PID.\n' >&2; exit 2 ;;
         esac
         case "${2#*-}" in ''|*[!0-9]*) exit 2 ;; esac
         inspect_run=$2 ;;
       *) exit 2 ;;
     esac ;;
  *) printf 'Usage: contributor-linux-test [--probe | --qemu-guest-base | --qemu-compat | --mode cold|cached|both | --inspect-run YYYYMMDDTHHMMSSZ-PID]\n' >&2; exit 2 ;;
esac

root=$(git rev-parse --show-toplevel)
cd "$root"
environment=packages/cli/dev-cli/dev-cli-src/environment
run="$(date -u +%Y%m%dT%H%M%SZ)-$$"
output="$root/.artifacts/contributor-linux/$run"
mkdir -p "$output"
printf '%s\n' "$output" > "$root/.artifacts/contributor-linux/latest.txt"
printf 'Contributor Linux evidence: %s\n' "$output"
if [ -n "$inspect_run" ]; then
  printf 'run=%s\nstate=unknown\n' "$inspect_run" > "$output/inspection.txt"
fi

probe_host() {
  uname -m > "$output/host-architecture.txt"
  docker version > "$output/docker-version.txt" 2>&1
  docker info > "$output/docker-info.txt" 2>&1
  docker info --format '{{.Architecture}} {{.Driver}} {{json .DriverStatus}}' > "$output/docker-storage.txt" 2>&1
  printf '%s\n' \
    'disk_budget_bytes=32212254720' \
    'disk_hard_limit=enforcement-not-proven' \
    'Docker storage backend details are in docker-storage.txt; backend support alone does not prove a container quota.' \
    'Usage measurements are evidence only, not enforcement of the 30 GiB budget.' > "$output/disk-budget.txt"
  cat "$output/docker-storage.txt" "$output/disk-budget.txt"
}
probe_host
[ "$probe" -eq 0 ] || exit 0

# Explicit, process-local diagnostic for NixOS/nix#16184. Never alter Docker's
# emulator registration or apply the workaround to native amd64 acceptance.
if [ "$qemu_guest_base" -eq 1 ]; then
  case "$(cut -d ' ' -f 1 "$output/docker-storage.txt")" in
    aarch64|arm64) ;;
    *) printf 'The QEMU guest-base experiment requires an arm64 Docker daemon.\n' >&2; exit 2 ;;
  esac
fi

# Inspection never builds, starts, or removes resources. Successful empty listings prove
# absence; daemon errors leave state=unknown rather than silently claiming cleanup.
if [ -n "$inspect_run" ]; then
  docker image ls --all --filter "reference=tao-contributor-linux-base:$inspect_run" \
    --format '{{.ID}} {{.Repository}}:{{.Tag}}' > "$output/inspection-images.txt" 2> "$output/inspection-errors.log"
  docker container ls --all --filter "name=^/tao-contributor-linux-$inspect_run-(cold|tools|cached)$" \
    --format '{{.ID}} {{.Names}} {{.Status}} owner={{.Label "tao.owner"}} run={{.Label "tao.run"}}' \
    > "$output/inspection-containers.txt" 2>> "$output/inspection-errors.log"
  printf 'run=%s\nstate=complete\n' "$inspect_run" > "$output/inspection.txt"
  for kind in images containers; do
    if [ -s "$output/inspection-$kind.txt" ]; then
      cat "$output/inspection-$kind.txt"
    else
      printf 'No run-specific %s remain for %s.\n' "$kind" "$inspect_run"
    fi
  done
  printf 'Shared images and builder caches were not changed.\n'
  exit 0
fi

started=$(date +%s)
base="tao-contributor-linux-base:$run"
container=
base_owned=0
remove_container() {
  [ -n "$container" ] || return 0
  if ownership=$(docker inspect --format '{{ index .Config.Labels "tao.owner" }} {{ index .Config.Labels "tao.run" }}' "$container" 2>> "$output/cleanup.log"); then
    if [ "$ownership" != "contributor-linux-test $run" ]; then
      printf 'Refusing to remove container with different ownership: %s\n' "$container" >&2
      return 1
    fi
    docker rm --force "$container" >> "$output/cleanup.log" 2>&1 || return $?
  else
    # An inspect error can mean a disconnected daemon. Only a successful exact-name
    # listing establishes absence; never treat an arbitrary client error as gone.
    remaining=$(docker container ls --all --filter "name=^/$container$" --format '{{.Names}}' 2>> "$output/cleanup.log") || return 1
    [ -z "$remaining" ] || return 1
  fi
  container=
}

# POSIX pipelines return tee's status. Keep the producer's status separately and
# run the pipeline in the foreground so output streams without losing failures.
stream_log() (
  stream_file=$1
  stream_label=$2
  shift 2
  stream_started=$(date +%s)
  printf 'Contributor Linux: %s started; log: %s\n' "$stream_label" "$stream_file"
  stream_result=0
  (
    producer_result=0
    "$@" 2>&1 || producer_result=$?
    printf '%s\n' "$producer_result" > "$stream_file.exit-code"
  ) | tee "$stream_file" || stream_result=$?
  producer_result=1
  read -r producer_result < "$stream_file.exit-code" || producer_result=1
  [ "$producer_result" -eq 0 ] || stream_result=$producer_result
  printf 'Contributor Linux: %s finished (exit %s, %ss); log: %s\n' \
    "$stream_label" "$stream_result" "$(($(date +%s) - stream_started))" "$stream_file"
  exit "$stream_result"
)

cleanup() {
  status=$?
  trap - EXIT
  if [ -n "$container" ]; then
    remove_container || status=1
  fi
  if [ "$base_owned" -eq 1 ]; then
    docker image rm "$base" >> "$output/cleanup.log" 2>&1 || status=1
  fi
  printf 'exit_code=%s\nwall_seconds=%s\n' "$status" "$(($(date +%s) - started))" >> "$output/result.txt"
  printf 'Contributor Linux exit %s; evidence: %s\n' "$status" "$output"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

git rev-parse HEAD > "$output/source-commit.txt"
git status --porcelain > "$output/host-dirty-state.txt"
git archive --format=tar HEAD > "$output/checkout.tar"
mkdir "$output/context"
# Extract only Dockerfile for the base build. No working-tree content or credentials enter it.
git show "HEAD:$environment/Dockerfile" > "$output/context/Dockerfile"
git archive --format=tar HEAD bootstrap-tao-dev-env devenv.lock "$environment" > "$output/tools.tar"
printf '%s\n' \
  'platform=linux/amd64' 'guest_cpus=4' 'guest_memory_bytes=17179869184' \
  'guest_memory_swap_bytes=17179869184' 'guest_timeout_seconds=7200' \
  'base_image_build_cpu_memory_limits=not-enforced' \
  'host_only_native_ui_lanes=unrun' \
  'source=git archive HEAD; uncommitted changes excluded' > "$output/resources.txt"
case "$(cut -d ' ' -f 1 "$output/docker-storage.txt")" in
  x86_64|amd64) printf 'daemon_emulation=not-required\n' ;;
  aarch64|arm64) printf 'daemon_emulation=required-for-linux-amd64; implementation-runtime-dependent\n' ;;
  *) printf 'daemon_emulation=unknown; inspect docker-storage.txt\n' ;;
esac >> "$output/resources.txt"
printf 'qemu_guest_base_experiment=%s\n' "$qemu_guest_base" >> "$output/resources.txt"
printf 'qemu_nix_filter_disabled=%s\n' "$qemu_nix_filter" >> "$output/resources.txt"
base_owned=1
stream_log "$output/base-build.log" base-build docker build --platform linux/amd64 --target base --tag "$base" "$output/context"
docker image inspect "$base" > "$output/base-image.json"
docker image inspect --format '{{.Id}}' "$base" > "$output/base-identity.txt"
# Hash exact tool inputs and the base identity; never retain a dependency install or host profile.
git ls-tree HEAD bootstrap-tao-dev-env devenv.lock "$environment" > "$output/cache-inputs"
cat "$output/base-identity.txt" >> "$output/cache-inputs"
printf 'qemu_guest_base_experiment=%s\n' "$qemu_guest_base" >> "$output/cache-inputs"
printf 'qemu_nix_filter_disabled=%s\n' "$qemu_nix_filter" >> "$output/cache-inputs"
cache_key=$(git hash-object "$output/cache-inputs")
cache="tao-contributor-linux-tools:$cache_key"
rm "$output/cache-inputs"
printf 'owner=contributor-linux-test\nimage=%s\ncleanup=remove this exact image tag when no contributor run uses it\nshared_base_and_builder_cache=retained; never pruned by this runner\n' "$cache" > "$output/cache-ownership.txt"

run_guest() {
  [ -z "$container" ] || return 1
  guest_mode=$1
  guest_image=$2
  archive=$3
  guest_container="tao-contributor-linux-$run-$guest_mode"
  guest_output="$output/$guest_mode"
  mkdir "$guest_output"
  began=$(date +%s)
  printf 'state=running\n' > "$guest_output/result.txt"
  printf 'Contributor Linux: %s provisioning; logs: %s\n' "$guest_mode" "$guest_output"
  guest_result=0
  # Keep the intended identity before contacting Docker: a client can fail after
  # the daemon has created it. Cleanup still checks both ownership labels.
  container=$guest_container
  set -- "$guest_mode"
  if [ "$qemu_nix_filter" -eq 1 ]; then
    set -- "$@" --qemu-compat
  elif [ "$qemu_guest_base" -eq 1 ]; then
    set -- "$@" --qemu-guest-base
  fi
  if docker create --name "$guest_container" --platform linux/amd64 --cpus 4 --memory 16g --memory-swap 16g \
    --label tao.owner=contributor-linux-test --label "tao.run=$run" \
    "$guest_image" /bin/sh -c \
    'tar -xf /tmp/checkout.tar -C /workspace && rm /tmp/checkout.tar && exec /usr/bin/timeout --signal=TERM --kill-after=30s 7200 /bin/sh /workspace/packages/cli/dev-cli/dev-cli-src/environment/guest-smoke.sh "$@"' \
    contributor-linux "$@" > "$guest_output/container-id.txt"; then
    if docker cp "$archive" "$container:/tmp/checkout.tar"; then
      stream_log "$guest_output/console.log" "$guest_mode" docker start --attach "$container" || guest_result=$?
    else
      guest_result=$?
    fi
    docker inspect --size "$container" > "$guest_output/container.json" || guest_result=$?
    docker cp "$container:/workspace/.artifacts/contributor-linux/guest-$guest_mode" "$guest_output/guest" \
      > "$guest_output/collect.log" 2>&1 || guest_result=$?
    if [ "$guest_mode" = tools ] && [ "$guest_result" -eq 0 ]; then
      docker commit "$container" "$cache" > "$guest_output/image-id.txt" || guest_result=$?
    fi
  else
    guest_result=$?
  fi
  remove_container || guest_result=$?
  printf 'state=complete\nexit_code=%s\nwall_seconds=%s\n' "$guest_result" "$(($(date +%s) - began))" > "$guest_output/result.txt"
  printf 'Contributor Linux: %s complete (exit %s); logs: %s\n' "$guest_mode" "$guest_result" "$guest_output"
  return "$guest_result"
}

result=0
if [ "$mode" = cold ] || [ "$mode" = both ]; then
  run_guest cold "$base" "$output/checkout.tar" || result=1
fi
if [ "$mode" = cached ] || [ "$mode" = both ]; then
  if ! docker image inspect "$cache" > "$output/cache-image.json" 2>/dev/null; then
    if run_guest tools "$base" "$output/tools.tar"; then
      docker image inspect "$cache" > "$output/cache-image.json"
    else
      printf 'Cached smoke unrun: tool image provisioning failed.\n' >&2
      exit 1
    fi
  fi
  run_guest cached "$cache" "$output/checkout.tar" || result=1
fi
exit "$result"
