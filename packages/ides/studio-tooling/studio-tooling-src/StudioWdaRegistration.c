/* Invocation-private WDA registration. No PID supplied by a client authorizes ownership. */
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <poll.h>
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <limits.h>
#include <errno.h>

static int wda_line(int fd, char *line, size_t size) {
  size_t used = 0;
  while (used + 1 < size) {
    struct pollfd item = {fd, POLLIN, 0};
    if (poll(&item, 1, 30000) != 1 || read(fd, line + used, 1) != 1) return 0;
    if (line[used++] == '\n') { line[used] = 0; return 1; }
  }
  return 0;
}

#ifdef TAO_WDA_RUNNER
#ifndef TAO_WDA_ENV_VALUE
#define TAO_WDA_ENV_VALUE(key) getenv(key)
#endif

static int wda_failure(const char *category) {
  /* Categories are fixed source literals. Never print an environment value or transport path. */
  fprintf(stderr, "WDA launch registration failure category=%s\n", category);
  return 0;
}

/* Called in testRunner before constructing or binding the backend. Explicit scheme values,
 * rather than inherited shell variables, must reach this process for registration to succeed. */
static int tao_wda_register(void) {
  const char *channel = TAO_WDA_ENV_VALUE("TAO_WDA_CHANNEL");
  const char *capability = TAO_WDA_ENV_VALUE("TAO_WDA_CAPABILITY");
  const char *generation = TAO_WDA_ENV_VALUE("TAO_WDA_GENERATION");
  const char *port = TAO_WDA_ENV_VALUE("TAO_WDA_PORT"), *actual_port = TAO_WDA_ENV_VALUE("USE_PORT"), *host = TAO_WDA_ENV_VALUE("USE_HOST");
  if (!channel || !*channel) return wda_failure("missing-TAO_WDA_CHANNEL");
  if (!capability || !*capability) return wda_failure("missing-TAO_WDA_CAPABILITY");
  if (!generation || !*generation) return wda_failure("missing-TAO_WDA_GENERATION");
  if (!port || !*port) return wda_failure("missing-TAO_WDA_PORT");
  if (!actual_port || !*actual_port) return wda_failure("missing-USE_PORT");
  if (!host || !*host) return wda_failure("missing-USE_HOST");
  if (strcmp(port, actual_port) != 0) return wda_failure("port-mismatch");
  if (strcmp(host, "127.0.0.1") != 0) return wda_failure("host-mismatch");
  struct sockaddr_un address = {0};
  address.sun_len = sizeof(address);
  address.sun_family = AF_UNIX;
  if (strlen(channel) >= sizeof(address.sun_path)) return wda_failure("channel-too-long");
  strcpy(address.sun_path, channel);
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return wda_failure("socket-create");
  int no_sigpipe = 1;
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &no_sigpipe, sizeof(no_sigpipe));
  char message[256];
  int size = snprintf(message, sizeof(message), "%s\t%s\n", generation, capability);
  const char *failure = NULL;
  if (size <= 0 || size >= sizeof(message)) failure = "registration-too-long";
  else if (connect(fd, (struct sockaddr *)&address, sizeof(address)) != 0) {
    int connect_errno = errno;
    fprintf(stderr, "WDA launch registration connect errno=%d\n", connect_errno);
    failure = "channel-connect";
  }
  else if (write(fd, message, size) != size) failure = "registration-write";
  char reply[16];
  if (!failure && (!wda_line(fd, reply, sizeof(reply)) || strcmp(reply, "ACK\n") != 0)) failure = "acknowledgement-failed";
  close(fd);
  return failure ? wda_failure(failure) : 1;
}

#else

#include <libproc.h>
#include <sys/proc_info.h>
#include <CommonCrypto/CommonDigest.h>
#include <Security/Security.h>
#include <CoreFoundation/CoreFoundation.h>

struct channel_policy {
  int sandbox, strings, sockets, hid, signals, profile;
  const char *type;
  CFIndex count;
};

static struct channel_policy inspect_channel_policy(CFTypeRef entitlements, const char *channel) {
  struct channel_policy policy = {0, 1, 0, 0, 0, 0, "missing", -1};
  if (strspn(channel, "/-_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.") != strlen(channel)) return policy;
  char text[256];
  if (snprintf(text, sizeof(text), "(allow network-outbound (literal \"%s\"))", channel) >= sizeof(text)) return policy;
  CFStringRef rule = CFStringCreateWithCString(NULL, text, kCFStringEncodingUTF8);
  if (entitlements && CFGetTypeID(entitlements) == CFDictionaryGetTypeID()) {
    policy.sandbox = CFDictionaryGetValue(entitlements, CFSTR("com.apple.security.app-sandbox")) == kCFBooleanTrue;
    CFTypeRef rules = CFDictionaryGetValue(entitlements, CFSTR("com.apple.security.temporary-exception.sbpl"));
    if (rules && CFGetTypeID(rules) == CFArrayGetTypeID()) {
      policy.type = "array";
      policy.count = CFArrayGetCount(rules);
      for (CFIndex index = 0; index < policy.count; index++) {
        CFTypeRef value = CFArrayGetValueAtIndex(rules, index);
        if (CFGetTypeID(value) != CFStringGetTypeID()) { policy.strings = 0; continue; }
        if (CFEqual(value, rule)) policy.sockets++;
        if (CFEqual(value, CFSTR("(allow hid-control)"))) policy.hid++;
        if (CFEqual(value, CFSTR("(allow signal)"))) policy.signals++;
      }
    } else if (rules) {
      policy.type = CFGetTypeID(rules) == CFStringGetTypeID() ? "string" : "other";
    }
  }
  CFRelease(rule);
  if (policy.strings && policy.sockets == 1) {
    if (policy.count == 1) policy.profile = 1;
    // Xcode injects this exact pre-existing pair into its original signed test host.
    if (policy.count == 3 && policy.hid == 1 && policy.signals == 1) policy.profile = 2;
  }
  return policy;
}

static void baseline_digest(int xcode, char hex[65]) {
  const char *baseline = xcode ? "(allow hid-control)\n(allow signal)\n" : "";
  unsigned char bytes[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(baseline, (CC_LONG)strlen(baseline), bytes);
  for (int index = 0; index < CC_SHA256_DIGEST_LENGTH; index++) snprintf(hex + index * 2, 3, "%02x", bytes[index]);
}

static int channel_entitlements(CFTypeRef entitlements, const char *channel) {
  struct channel_policy policy = inspect_channel_policy(entitlements, channel);
  if (!policy.sandbox || !policy.profile) fprintf(stderr,
    "WDA registration failure category=signed-entitlement-policy sandbox=%d exact-rule=%d sbpl-type=%s count=%ld socket-matches=%d hid-matches=%d signal-matches=%d\n",
    policy.sandbox, policy.profile != 0, policy.type, (long)policy.count, policy.sockets, policy.hid, policy.signals);
  return policy.sandbox ? policy.profile : 0;
}

static int controller_failure(const char *category, int code) {
  fprintf(stderr, "WDA registration failure category=%s\n", category);
  return code;
}

static int security_status(const char *stage, OSStatus status) {
  if (status == errSecSuccess) return 1;
  fprintf(stderr, "WDA registration failure category=security-%s status=%d\n", stage, (int)status);
  return 0;
}

/* Verify the running host's signed entitlement, not a copied plist or the peer's claimed metadata. */
static int signed_channel_rule(pid_t pid, const char *channel) {
  CFNumberRef number = CFNumberCreate(NULL, kCFNumberIntType, &pid);
  const void *keys[] = { kSecGuestAttributePid }, *values[] = { number };
  CFDictionaryRef attributes = CFDictionaryCreate(NULL, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  SecCodeRef code = NULL;
  CFDictionaryRef information = NULL;
  int ok = 0;
  if (security_status("guest", SecCodeCopyGuestWithAttributes(NULL, attributes, kSecCSDefaultFlags, &code))
    && security_status("validity", SecCodeCheckValidity(code, kSecCSDefaultFlags, NULL))
    && security_status("information", SecCodeCopySigningInformation(code, kSecCSSigningInformation, &information))) {
    ok = channel_entitlements(CFDictionaryGetValue(information, kSecCodeInfoEntitlementsDict), channel);
  }
  if (information) CFRelease(information);
  if (code) CFRelease(code);
  CFRelease(attributes); CFRelease(number);
  return ok;
}

/* Fixed engineering workflow inspects only its built signed test host; never emits entitlement values. */
static int baseline_proof(const char *path) {
  const char *channel = getenv("TAO_WDA_PROOF_CHANNEL");
  if (!channel) return controller_failure("baseline-proof-channel-missing", 18);
  CFURLRef url = CFURLCreateFromFileSystemRepresentation(NULL, (const UInt8 *)path, strlen(path), 1);
  SecStaticCodeRef code = NULL;
  CFDictionaryRef information = NULL;
  int result = 18;
  if (security_status("static-code", SecStaticCodeCreateWithPath(url, kSecCSDefaultFlags, &code))
    && security_status("static-validity", SecStaticCodeCheckValidity(code, kSecCSDefaultFlags, NULL))
    && security_status("static-information", SecCodeCopySigningInformation((SecCodeRef)code, kSecCSSigningInformation, &information))) {
    struct channel_policy policy = inspect_channel_policy(CFDictionaryGetValue(information, kSecCodeInfoEntitlementsDict), channel);
    int baseline = policy.strings && policy.hid == 1 && policy.signals == 1 && (policy.count == 2 || policy.count == 3);
    char hash[65]; baseline_digest(baseline, hash);
    printf("{\"sandbox\":%s,\"sbplType\":\"%s\",\"sbplCount\":%ld,\"socketMatches\":%d,\"hidMatches\":%d,\"signalMatches\":%d,\"xcodeBaseline\":%s,\"baselineDigest\":\"%s\",\"acceptedProfile\":%d}\n",
      policy.sandbox ? "true" : "false", policy.type, (long)policy.count, policy.sockets, policy.hid, policy.signals,
      baseline ? "true" : "false", hash, policy.sandbox ? policy.profile : 0);
    result = 0;
  }
  if (information) CFRelease(information);
  if (code) CFRelease(code);
  CFRelease(url);
  return result;
}

static int identity(pid_t pid, struct proc_bsdinfo *info) {
  return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, info, sizeof(*info)) == sizeof(*info)
    && info->pbi_pid == pid;
}

static int same_identity(pid_t pid, const struct proc_bsdinfo *expected) {
  struct proc_bsdinfo current;
  return identity(pid, &current) && current.pbi_start_tvsec == expected->pbi_start_tvsec
    && current.pbi_start_tvusec == expected->pbi_start_tvusec;
}

static int private_file(const char *path) {
  int fd = open(path, O_RDONLY | O_NOFOLLOW);
  struct stat stat;
  if (fd < 0) return -1;
  if (fstat(fd, &stat) != 0 || !S_ISREG(stat.st_mode) || stat.st_uid != getuid()
    || (stat.st_mode & 0777) != 0600) { close(fd); return -1; }
  return fd;
}

static int registration_message_valid(const char *received, const char *expected) {
  return strcmp(received, expected) == 0;
}

static int bundle_candidate(const char *candidate, size_t size, const char *root) {
  const char *suffix = "/WebDriverAgentRunner.xctest/Contents/MacOS/WebDriverAgentRunner";
  size_t root_size = strlen(root), suffix_size = strlen(suffix);
  return size > root_size + suffix_size
    && strncmp(candidate, root, root_size) == 0 && candidate[root_size] == '/'
    && strcmp(candidate + size - suffix_size, suffix) == 0;
}

/* Kernel VM mapping corroborates the loaded bundle; a peer-declared path is never accepted. */
static int loaded_bundle(pid_t pid, const char *root, char *path, struct vinfo_stat *mapped) {
  uint64_t address = 0;
  for (int count = 0; count < 65536; count++) {
    struct proc_regionwithpathinfo region;
    if (proc_pidinfo(pid, PROC_PIDREGIONPATHINFO, address, &region, sizeof(region)) != sizeof(region)) return 0;
    const char *candidate = region.prp_vip.vip_path;
    size_t size = strnlen(candidate, sizeof(region.prp_vip.vip_path));
    if (size < sizeof(region.prp_vip.vip_path) && bundle_candidate(candidate, size, root)) {
      if (!realpath(candidate, path) || strcmp(path, candidate) != 0) return 0;
      *mapped = region.prp_vip.vip_vi.vi_stat;
      return 1;
    }
    uint64_t next = region.prp_prinfo.pri_address + region.prp_prinfo.pri_size;
    if (next <= address) return 0;
    address = next;
  }
  return 0;
}

static int digest(const char *path, const struct vinfo_stat *mapped, char *hex) {
  int fd = open(path, O_RDONLY | O_NOFOLLOW);
  if (fd < 0) return 0;
  struct stat file;
  if (fstat(fd, &file) != 0 || !S_ISREG(file.st_mode)
    || (uint32_t)file.st_dev != mapped->vst_dev || file.st_ino != mapped->vst_ino) {
    close(fd); return 0;
  }
  CC_SHA256_CTX context;
  CC_SHA256_Init(&context);
  char data[16384];
  ssize_t size;
  while ((size = read(fd, data, sizeof(data))) > 0) CC_SHA256_Update(&context, data, (CC_LONG)size);
  close(fd);
  if (size < 0) return 0;
  unsigned char bytes[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256_Final(bytes, &context);
  for (int index = 0; index < CC_SHA256_DIGEST_LENGTH; index++) snprintf(hex + index * 2, 3, "%02x", bytes[index]);
  return 1;
}

int main(int argc, char **argv) {
  if (argc == 3 && strcmp(argv[1], "--baseline-proof") == 0) return baseline_proof(argv[2]);
  if (argc != 6) return 2;
  const char *channel = argv[1], *capability_path = argv[2], *generation = argv[3];
  const char *root = argv[4], *acknowledgement = argv[5];
  struct proc_bsdinfo controller;
  pid_t controller_pid = getppid();
  if (!identity(controller_pid, &controller)) return 3;
  int secret = private_file(capability_path);
  char capability[80];
  if (secret < 0 || !wda_line(secret, capability, sizeof(capability))) return 4;
  close(secret);
  capability[strcspn(capability, "\n")] = 0;
  char expected[256];
  if (snprintf(expected, sizeof(expected), "%s\t%s\n", generation, capability) >= sizeof(expected)) return 5;
  struct sockaddr_un address = {0};
  address.sun_len = sizeof(address);
  address.sun_family = AF_UNIX;
  if (strlen(channel) >= sizeof(address.sun_path)) return 6;
  strcpy(address.sun_path, channel);
  umask(0077);
  int server = socket(AF_UNIX, SOCK_STREAM, 0);
  if (server < 0 || bind(server, (struct sockaddr *)&address, sizeof(address)) != 0 || listen(server, 1) != 0) {
    perror("WDA registration socket"); return 7;
  }
  puts("READY"); fflush(stdout);
  int peer = -1;
  for (int attempt = 0; attempt < 3000; attempt++) {
    if (!same_identity(controller_pid, &controller)) return 8;
    struct pollfd item = {server, POLLIN, 0};
    int result = poll(&item, 1, 100);
    if (result < 0) return 9;
    if (result == 1) { peer = accept(server, NULL, NULL); break; }
  }
  /* The endpoint is one use, including a rejected registration. */
  close(server); unlink(channel);
  if (peer < 0) return 10;
  int no_sigpipe = 1;
  setsockopt(peer, SOL_SOCKET, SO_NOSIGPIPE, &no_sigpipe, sizeof(no_sigpipe));
  pid_t peer_pid = 0;
  socklen_t peer_size = sizeof(peer_pid);
  uid_t peer_uid; gid_t peer_gid;
  if (getsockopt(peer, SOL_LOCAL, LOCAL_PEERPID, &peer_pid, &peer_size) != 0
    || peer_size != sizeof(peer_pid) || peer_pid <= 1
    || getpeereid(peer, &peer_uid, &peer_gid) != 0 || peer_uid != getuid()) return controller_failure("os-peer", 11);
  struct proc_bsdinfo captured;
  if (!identity(peer_pid, &captured)) return controller_failure("peer-identity", 12);
  char received[256], bundle[PATH_MAX], hash[65];
  struct vinfo_stat mapped;
  if (!wda_line(peer, received, sizeof(received)) || !registration_message_valid(received, expected)) return controller_failure("registration-message", 13);
  if (!loaded_bundle(peer_pid, root, bundle, &mapped) || strchr(bundle, '\t') || strchr(bundle, '\n')) return controller_failure("loaded-bundle", 13);
  if (!digest(bundle, &mapped, hash)) return controller_failure("mapped-bundle-digest", 13);
  if (!same_identity(peer_pid, &captured)) return controller_failure("peer-identity-before-signature", 13);
  int signed_profile = signed_channel_rule(peer_pid, channel);
  if (!signed_profile) return controller_failure("signed-channel-rule", 13);
  if (!same_identity(peer_pid, &captured)) return controller_failure("peer-identity-after-signature", 13);
  char signed_baseline[65]; baseline_digest(signed_profile == 2, signed_baseline);
  printf("PEER\t%d\t%llu:%llu\t%s\t%s\t1\t%d\t%s\n", peer_pid,
    (unsigned long long)captured.pbi_start_tvsec, (unsigned long long)captured.pbi_start_tvusec, hash, bundle, signed_profile, signed_baseline);
  fflush(stdout);
  char expected_ack[100];
  snprintf(expected_ack, sizeof(expected_ack), "%d\t%llu:%llu\n", peer_pid,
    (unsigned long long)captured.pbi_start_tvsec, (unsigned long long)captured.pbi_start_tvusec);
  for (int attempt = 0; attempt < 300; attempt++) {
    if (!same_identity(controller_pid, &controller) || !same_identity(peer_pid, &captured)) return 14;
    int ack = private_file(acknowledgement);
    if (ack >= 0) {
      char text[100], current_bundle[PATH_MAX], current_hash[65];
      struct vinfo_stat current_mapped;
      int ok = wda_line(ack, text, sizeof(text)) && strcmp(text, expected_ack) == 0;
      close(ack);
      if (!ok || !loaded_bundle(peer_pid, root, current_bundle, &current_mapped) || strcmp(current_bundle, bundle) != 0
        || current_mapped.vst_dev != mapped.vst_dev || current_mapped.vst_ino != mapped.vst_ino
        || !digest(current_bundle, &current_mapped, current_hash) || strcmp(current_hash, hash) != 0
        || signed_channel_rule(peer_pid, channel) != signed_profile
        || !same_identity(peer_pid, &captured) || !same_identity(controller_pid, &controller)) return controller_failure("acknowledgement-recheck", 15);
      if (write(peer, "ACK\n", 4) != 4) return 16;
      puts("ACKED"); fflush(stdout);
      close(peer);
      return 0;
    }
    usleep(100000);
  }
  close(peer);
  return 17;
}
#endif
