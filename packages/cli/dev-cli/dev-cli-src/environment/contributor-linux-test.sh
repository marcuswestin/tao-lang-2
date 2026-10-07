#!/bin/sh
# Fixed host operation. Never accepts Docker flags, paths, images, or host mounts.
set -eu

mode=both
platform=linux/amd64
image_arch=amd64
probe=0
qemu_guest_base=0
qemu_nix_filter=0
inspect_run=
recover_run=
case "$#" in
  0) ;;
  1) case "$1" in
       --probe) probe=1 ;;
       --native-arm64) platform=linux/arm64; image_arch=arm64 ;;
       --qemu-guest-base) qemu_guest_base=1 ;;
       --qemu-compat) qemu_guest_base=1; qemu_nix_filter=1 ;;
       *) printf 'Expected --probe, --native-arm64, --qemu-guest-base, or --qemu-compat.\n' >&2; exit 2 ;;
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
       --recover-run)
         case "$2" in
           [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z-*) ;;
           *) printf 'Expected a contributor run ID: YYYYMMDDTHHMMSSZ-PID.\n' >&2; exit 2 ;;
         esac
         case "${2#*-}" in ''|*[!0-9]*) exit 2 ;; esac
         recover_run=$2 ;;
       *) exit 2 ;;
     esac ;;
  3) if [ "$1" = --native-arm64 ] && [ "$2" = --mode ] && [ "$3" = cached ]; then
       platform=linux/arm64; image_arch=arm64; mode=cached
     else
       printf 'Expected --native-arm64 --mode cached.\n' >&2; exit 2
     fi ;;
  *) printf 'Usage: contributor-linux-test [--probe | --native-arm64 | --native-arm64 --mode cached | --qemu-guest-base | --qemu-compat | --mode cold|cached|both | --inspect-run YYYYMMDDTHHMMSSZ-PID | --recover-run YYYYMMDDTHHMMSSZ-PID]\n' >&2; exit 2 ;;
esac

root=$(git rev-parse --show-toplevel)
cd "$root"
environment=packages/cli/dev-cli/dev-cli-src/environment

# Recover only an existing run's exact container names and base tag. A live or
# ambiguous guest is left alone; rerun after it exits. Evidence is copied before
# any Docker removal, and every mutation repeats the ownership/state check.
if [ -n "$recover_run" ]; then
  output="$root/.artifacts/contributor-linux/$recover_run"
  if [ ! -f "$output/resources.txt" ] || [ ! -f "$output/source-commit.txt" ]; then
    printf 'Refusing recovery without an existing contributor run record: %s\n' "$output" >&2
    exit 1
  fi
  attempt="$output/recovery-$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir "$attempt"
  printf 'Contributor Linux recovery evidence: %s\n' "$attempt"
  printf 'run=%s\nstate=unknown\n' "$recover_run" > "$attempt/result.txt"
  docker version > "$attempt/docker-version.txt" 2> "$attempt/docker-errors.log"
  docker info > "$attempt/docker-info.txt" 2>> "$attempt/docker-errors.log"

  base="tao-contributor-linux-base:$recover_run"
  recorded_base_id=
  image_listing=$(docker image ls --all --filter "reference=$base" --format '{{.Repository}}:{{.Tag}}' 2>> "$attempt/docker-errors.log")
  case "$image_listing" in
    ''|"$base") ;;
    *) printf 'Ambiguous run-specific base image listing; no resources removed.\n' >&2; exit 1 ;;
  esac
  if [ -n "$image_listing" ]; then
    if [ ! -s "$output/base-identity.txt" ]; then
      printf 'Cannot verify the run-specific base image without its recorded ID.\n' >&2
      exit 1
    fi
    read -r recorded_base_id < "$output/base-identity.txt"
    current_base_id=$(docker image inspect --format '{{.Id}}' "$base" 2>> "$attempt/docker-errors.log")
    if [ "$current_base_id" != "$recorded_base_id" ]; then
      printf 'Base image tag no longer matches this run; leaving it in place.\n' >&2
      exit 1
    fi
  fi

  # Exact-name listing confirms absence. Inspect by immutable ID confirms name,
  # labels, and state; an inspect failure never counts as absence.
  for kind in cold tools cached; do
    name="tao-contributor-linux-$recover_run-$kind"
    listing=$(docker container ls --all --no-trunc --filter "name=^/$name$" --format '{{.ID}} {{.Names}}' 2>> "$attempt/docker-errors.log")
    [ -n "$listing" ] || continue
    case "$listing" in *'
'*) printf 'Ambiguous container listing for %s.\n' "$name" >&2; exit 1 ;; esac
    read -r id listed_name extra <<EOF
$listing
EOF
    case "$id" in ''|*[!0-9a-f]*) printf 'Invalid container ID for %s.\n' "$name" >&2; exit 1 ;; esac
    if [ "${#id}" -ne 64 ] || [ "$listed_name" != "$name" ] || [ -n "$extra" ]; then
      printf 'Ambiguous container identity for %s.\n' "$name" >&2
      exit 1
    fi
    identity=$(docker inspect --format '{{.Name}}|{{index .Config.Labels "tao.owner"}}|{{index .Config.Labels "tao.run"}}|{{.State.Status}}|{{.State.ExitCode}}' "$id" 2>> "$attempt/docker-errors.log")
    exit_code=${identity##*|}
    case "$exit_code" in ''|*[!0-9]*) printf 'Invalid guest exit code for %s.\n' "$name" >&2; exit 1 ;; esac
    case "$identity" in
      "/$name|contributor-linux-test|$recover_run|exited|$exit_code"|"/$name|contributor-linux-test|$recover_run|created|$exit_code") ;;
      *) printf 'Refusing recovery of unowned, live, or ambiguous container %s: %s\n' "$name" "$identity" >&2; exit 1 ;;
    esac
    printf '%s\n' "$id" > "$attempt/$kind-container-id.txt"
    printf '%s\n' "$identity" > "$attempt/$kind-identity.txt"
  done

  # Keep complete daemon logs, inspect data, guest output, and workflow logs.
  # Missing guest artifacts leave the container for diagnosis rather than
  # accepting an incomplete capture as recoverable evidence.
  for kind in cold tools cached; do
    [ -f "$attempt/$kind-container-id.txt" ] || continue
    read -r id < "$attempt/$kind-container-id.txt"
    mkdir "$attempt/$kind"
    docker inspect --size "$id" > "$attempt/$kind/container.json" 2>> "$attempt/docker-errors.log"
    case "$(cat "$attempt/$kind-identity.txt")" in
      *'|created|'*) printf 'Guest was created but never started.\n' > "$attempt/$kind/unstarted.txt" ;;
      *)
        docker logs "$id" > "$attempt/$kind/guest-console.txt" 2>&1
        docker cp "$id:/workspace/.artifacts/contributor-linux/guest-$kind" "$attempt/$kind/guest" >> "$attempt/collect.log" 2>&1
        if [ "$kind" != tools ]; then
          docker cp "$id:/workspace/.artifacts/logs" "$attempt/$kind/workflow-logs" >> "$attempt/collect.log" 2>&1
        fi ;;
    esac
  done

  for kind in cold tools cached; do
    [ -f "$attempt/$kind-container-id.txt" ] || continue
    read -r id < "$attempt/$kind-container-id.txt"
    name="tao-contributor-linux-$recover_run-$kind"
    identity=$(docker inspect --format '{{.Name}}|{{index .Config.Labels "tao.owner"}}|{{index .Config.Labels "tao.run"}}|{{.State.Status}}|{{.State.ExitCode}}' "$id" 2>> "$attempt/docker-errors.log")
    if [ "$identity" != "$(cat "$attempt/$kind-identity.txt")" ]; then
      printf 'Container %s changed state during recovery; no further resources removed.\n' "$name" >&2
      exit 1
    fi
    docker rm "$id" >> "$attempt/cleanup.log" 2>&1
    printf 'Recovered %s; container removed.\n' "$name"
  done
  # An unforced image remove refuses an image still used by another container.
  image_listing=$(docker image ls --all --filter "reference=$base" --format '{{.Repository}}:{{.Tag}}' 2>> "$attempt/docker-errors.log")
  case "$image_listing" in
    '') ;;
    "$base")
      if [ -z "$recorded_base_id" ]; then
        printf 'Base image appeared during recovery; leaving it in place.\n' >&2
        exit 1
      fi
      current_base_id=$(docker image inspect --format '{{.Id}}' "$base" 2>> "$attempt/docker-errors.log")
      if [ "$current_base_id" != "$recorded_base_id" ]; then
        printf 'Base image tag changed during recovery; leaving it in place.\n' >&2
        exit 1
      fi
      users=$(docker container ls --all --no-trunc --filter "ancestor=$base" --format '{{.ID}} {{.Names}}' 2>> "$attempt/docker-errors.log")
      if [ -n "$users" ]; then
        printf 'Base image is still used by a container; leaving its exact tag in place.\n' >&2
        exit 1
      fi
      docker image rm "$base" >> "$attempt/cleanup.log" 2>&1 ;;
    *) printf 'Ambiguous base image before removal; leaving it in place.\n' >&2; exit 1 ;;
  esac
  printf 'run=%s\nstate=complete\nshared_caches=untouched\n' "$recover_run" > "$attempt/result.txt"
  printf 'Contributor Linux recovery complete; evidence: %s\n' "$attempt"
  exit 0
fi

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
  docker info --format '{{.MemTotal}}' > "$output/docker-memory-bytes.txt" 2>&1
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

if [ "$platform" = linux/arm64 ]; then
  case "$(cut -d ' ' -f 1 "$output/docker-storage.txt")" in
    aarch64|arm64) ;;
    *) printf 'The native ARM control requires an arm64 Docker daemon.\n' >&2; exit 2 ;;
  esac
fi

# Inspection never builds, starts, or removes resources. Successful empty listings prove
# absence; daemon errors leave state=unknown rather than silently claiming cleanup.
if [ -n "$inspect_run" ]; then
  docker image ls --all --filter "reference=tao-contributor-linux-base:$inspect_run" \
    --format '{{.ID}} {{.Repository}}:{{.Tag}}' > "$output/inspection-images.txt" 2> "$output/inspection-errors.log"
  docker container ls --all --no-trunc --filter "name=^/tao-contributor-linux-$inspect_run-(cold|tools|cached)$" \
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
  # Snapshot only workflow logs from exact owned container IDs. Never execute in,
  # stop, or otherwise alter a live guest. A disappearing container may lack logs.
  while read -r inspected_id inspected_name inspected_rest; do
    case "$inspected_id" in ''|*[!0-9a-f]*) continue ;; esac
    case "$inspected_name" in
      "tao-contributor-linux-$inspect_run-cold"|"tao-contributor-linux-$inspect_run-tools"|"tao-contributor-linux-$inspect_run-cached") ;;
      *) continue ;;
    esac
    if inspected_owner=$(docker inspect --format '{{index .Config.Labels "tao.owner"}} {{index .Config.Labels "tao.run"}}' "$inspected_id" 2>> "$output/inspection-errors.log"); then
      if [ "$inspected_owner" = "contributor-linux-test $inspect_run" ]; then
        docker top "$inspected_id" -eo pid,ppid,stat,etime,time,args > "$output/$inspected_name-processes.txt" 2>> "$output/inspection-errors.log" || true
        docker stats --no-stream --format '{{json .}}' "$inspected_id" > "$output/$inspected_name-stats.json" 2>> "$output/inspection-errors.log" || true
        if docker cp "$inspected_id:/workspace/.artifacts/logs" "$output/$inspected_name-logs" 2>> "$output/inspection-errors.log"; then
          printf 'Workflow log snapshot: %s/%s-logs\n' "$output" "$inspected_name"
        else
          printf 'Workflow logs unavailable for %s; see inspection-errors.log.\n' "$inspected_name"
        fi
      fi
    fi
  done < "$output/inspection-containers.txt"
  printf 'Shared images and builder caches were not changed.\n'
  exit 0
fi

# The guest is a 16 GiB machine. A smaller Docker VM does not shrink that limit: verify
# outgrows the VM and the kernel kills a test with SIGKILL an hour or more into the run
# (7.9 GB peak inside a 7.75 GiB VM on 2026-10-07). Docker Desktop reports a little less
# than its memory setting, so 15 GiB admits a 16 GB setting.
docker_memory_bytes=
read -r docker_memory_bytes < "$output/docker-memory-bytes.txt" || true
case "$docker_memory_bytes" in
  ''|*[!0-9]*) printf 'Cannot read Docker'"'"'s total memory; see docker-memory-bytes.txt.\n' >&2; exit 1 ;;
esac
if [ "$docker_memory_bytes" -lt 16106127360 ]; then
  printf 'Docker has %s MiB of memory; the contributor guest needs 16 GiB. Raise Docker'"'"'s memory limit to 16 GB or more (Docker Desktop: Settings > Resources) and rerun.\n' \
    "$((docker_memory_bytes / 1048576))" >&2
  exit 2
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
git archive --format=tar HEAD .config/bootstrap-tao-dev-env devenv.lock "$environment" > "$output/tools.tar"
printf '%s\n' \
  "platform=$platform" 'guest_cpus=4' 'guest_memory_bytes=17179869184' \
  'guest_memory_swap_bytes=17179869184' "docker_memory_bytes=$docker_memory_bytes" 'guest_timeout_seconds=7200' \
  'base_image_build_cpu_memory_limits=not-enforced' \
  'host_only_native_ui_lanes=unrun' \
  'source=git archive HEAD; uncommitted changes excluded' > "$output/resources.txt"
case "$image_arch:$(cut -d ' ' -f 1 "$output/docker-storage.txt")" in
  amd64:x86_64|amd64:amd64|arm64:aarch64|arm64:arm64) printf 'daemon_emulation=not-required\n' ;;
  amd64:aarch64|amd64:arm64) printf 'daemon_emulation=required-for-linux-amd64; implementation-runtime-dependent\n' ;;
  *) printf 'daemon_emulation=unknown; inspect docker-storage.txt\n' ;;
esac >> "$output/resources.txt"
printf 'qemu_guest_base_experiment=%s\n' "$qemu_guest_base" >> "$output/resources.txt"
printf 'qemu_nix_filter_disabled=%s\n' "$qemu_nix_filter" >> "$output/resources.txt"
base_owned=1
stream_log "$output/base-build.log" base-build docker build --platform "$platform" --target base --tag "$base" "$output/context"
docker image inspect "$base" > "$output/base-image.json"
docker image inspect --format '{{.Id}}' "$base" > "$output/base-identity.txt"
# Build attestations can change the manifest-list ID without changing executable
# contents. Keep that ID as evidence, but key tools on ordered layers and config.
docker image inspect --format '{{if and (eq .Os "linux") (eq .Architecture "'"$image_arch"'") .RootFS.Layers .Config}}'"$platform"' {{json .RootFS.Layers}} {{json .Config}}{{else}}invalid{{end}}' "$base" > "$output/base-cache-identity.txt"
IFS= read -r base_cache_identity < "$output/base-cache-identity.txt"
case "$base_cache_identity" in
  "$platform ["*'] {'*'}') ;;
  *) printf 'Cannot establish the base image filesystem/configuration identity.\n' >&2; exit 1 ;;
esac
# Hash exact tool inputs and the base identity; never retain a dependency install or host profile.
git ls-tree HEAD .config/bootstrap-tao-dev-env devenv.lock "$environment" > "$output/cache-inputs"
cat "$output/base-cache-identity.txt" >> "$output/cache-inputs"
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
  if docker create --name "$guest_container" --platform "$platform" --cpus 4 --memory 16g --memory-swap 16g \
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
    # Keep complete workflow failures before disposing of the guest, not only
    # the bounded reports printed by its outer commands. Tools-only has no lanes.
    if [ "$guest_mode" != tools ]; then
      docker cp "$container:/workspace/.artifacts/logs" "$guest_output/workflow-logs" \
        >> "$guest_output/collect.log" 2>&1 || guest_result=$?
    fi
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
