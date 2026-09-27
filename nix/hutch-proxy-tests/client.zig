const std = @import("std");

pub fn main(init: std.process.Init) !void {
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    if (args.len != 6) return error.ExpectedProxyPortUrlCertificateTrustResult;
    var allocator: std.heap.DebugAllocator(.{}) = .init;
    defer if (allocator.deinit() == .leak) @panic("HTTP client leaked allocations");
    const gpa = allocator.allocator();
    var proxy: std.http.Client.Proxy = .{
        .protocol = .plain,
        .host = try std.Io.net.HostName.init("127.0.0.1"),
        .port = try std.fmt.parseInt(u16, args[1], 10),
        .authorization = null,
        .supports_connect = true,
    };
    var client: std.http.Client = .{
        .allocator = gpa,
        .io = init.io,
        .https_proxy = &proxy,
        // A non-null timestamp prevents loading the machine's trust store.
        .now = std.Io.Clock.real.now(init.io),
    };
    defer client.deinit();
    if (std.mem.eql(u8, args[4], "trusted")) {
        try client.ca_bundle.addCertsFromFilePathAbsolute(gpa, init.io, client.now.?, args[3]);
    }
    const expect_success = std.mem.eql(u8, args[5], "success");
    for (0..2) |_| {
        var body_buffer: [16]u8 = undefined;
        var body = std.Io.Writer.fixed(&body_buffer);
        const response = client.fetch(.{
            .location = .{ .url = args[2] },
            .response_writer = &body,
        }) catch |err| {
            if (expect_success or err != error.TlsInitializationFailed) return err;
            if (client.connection_pool.used.first != null or client.connection_pool.free_len != 0)
                return error.FailedConnectionRetained;
            continue;
        };
        if (!expect_success) return error.UnexpectedHttpsSuccess;
        if (response.status != .ok or !std.mem.eql(u8, body.buffered(), "ok"))
            return error.UnexpectedResponse;
        if (client.connection_pool.used.first != null or client.connection_pool.free_len != 1)
            return error.ExpectedReusableConnection;
    }
}
