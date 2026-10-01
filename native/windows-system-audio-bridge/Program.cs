using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;

var request = BridgeRequest.Parse(args);
if (!request.Json || string.IsNullOrWhiteSpace(request.Command))
{
    Console.Error.WriteLine("Usage: Pixelody.SystemAudio.Bridge.exe --json --command (protocol|status|probe|pass-through-lab|virtual-route-lab|clock-discipline-lab|clock-discipline-self-test) [--dev-allow-pass-through] [--capture-endpoint-id ID] [--render-endpoint-id ID] [--dev-allow-virtual-route] [--real-output-endpoint-id ID] [--dev-allow-clock-discipline] [--leader-endpoint-id ID] [--follower-endpoint-id ID] [--duration-ms 1000]");
    Environment.Exit(2);
}

var response = request.Command switch
{
    "protocol" or "status" => BridgeResponse.FromStatus(request.Command, BridgeStatusFactory.ForStub(request.Command)),
    "probe" => BridgeResponse.FromStatus(request.Command, BridgeStatusFactory.ForProbe()),
    "pass-through-lab" => BridgeResponse.FromLab(request, PassThroughLab.Run(request)),
    "virtual-route-lab" => BridgeResponse.FromLab(request, VirtualRouteLab.Run(request)),
    "clock-discipline-lab" => BridgeResponse.FromLab(request, ClockDisciplineLab.Run(request)),
    "clock-discipline-self-test" => BridgeResponse.FromLab(request, ClockDisciplineLab.SelfTest(request)),
    _ => BridgeResponse.FromStatus(request.Command, BridgeStatusFactory.Unsupported(request.Command))
};

Console.WriteLine(JsonSerializer.Serialize(response, JsonOptions()));
return;

static JsonSerializerOptions JsonOptions() => new()
{
    WriteIndented = false,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

static class BridgeContract
{
    public const int Version = 1;
    public const string VirtualOutput = "Pixelody Virtual Output";
    public const string VirtualMonitor = "Pixelody Virtual Monitor";
}

static class RouteState
{
    public const string VirtualEndpointMissing = "virtual-endpoint-missing";
    public const string BridgeReady = "bridge-ready";
    public const string Active = "active";
    public const string Degraded = "degraded";
    public const string BypassSuspected = "bypass-suspected";
    public const string RealOutputMissing = "real-output-missing";
    public const string LoopRiskBlocked = "loop-risk-blocked";
    public const string Error = "error";
    public const string ClockDisciplineBlocked = "clock-discipline-blocked";
}

sealed record BridgeRequest(bool Json, string Command, bool DevAllowPassThrough, bool DevAllowVirtualRoute, bool DevAllowClockDiscipline, string CaptureEndpointId, string RenderEndpointId, string RealOutputEndpointId, string LeaderEndpointId, string FollowerEndpointId, int DurationMs)
{
    public static BridgeRequest Parse(string[] args)
    {
        var json = false;
        var command = "";
        var devAllowPassThrough = false;
        var devAllowVirtualRoute = false;
        var devAllowClockDiscipline = false;
        var captureEndpointId = "";
        var renderEndpointId = "";
        var realOutputEndpointId = "";
        var leaderEndpointId = "";
        var followerEndpointId = "";
        var durationMs = 1000;
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i] == "--json") json = true;
            if (args[i] == "--command" && i + 1 < args.Length) command = args[++i];
            if (args[i] == "--status") command = "status";
            if (args[i] == "--protocol") command = "protocol";
            if (args[i] == "--probe") command = "probe";
            if (args[i] == "--dev-allow-pass-through") devAllowPassThrough = true;
            if (args[i] == "--dev-allow-virtual-route") devAllowVirtualRoute = true;
            if (args[i] == "--dev-allow-clock-discipline") devAllowClockDiscipline = true;
            if (args[i] == "--capture-endpoint-id" && i + 1 < args.Length) captureEndpointId = args[++i];
            if (args[i] == "--render-endpoint-id" && i + 1 < args.Length) renderEndpointId = args[++i];
            if (args[i] == "--real-output-endpoint-id" && i + 1 < args.Length) realOutputEndpointId = args[++i];
            if (args[i] == "--leader-endpoint-id" && i + 1 < args.Length) leaderEndpointId = args[++i];
            if (args[i] == "--follower-endpoint-id" && i + 1 < args.Length) followerEndpointId = args[++i];
            if (args[i] == "--duration-ms" && i + 1 < args.Length && int.TryParse(args[i + 1], out var parsedDuration))
            {
                durationMs = Math.Clamp(parsedDuration, 250, 3000);
                i++;
            }
        }
        return new BridgeRequest(json, command, devAllowPassThrough, devAllowVirtualRoute, devAllowClockDiscipline, captureEndpointId, renderEndpointId, realOutputEndpointId, leaderEndpointId, followerEndpointId, durationMs);
    }
}

sealed record BridgeStatusReport(
    bool accepted,
    string state,
    bool ready,
    bool active,
    string reason,
    object endpoints,
    object format,
    object counters,
    object watchdog);

sealed record BridgeResponse(bool ok, int contract, object bridge, object request, BridgeStatusReport status, object? lab = null)
{
    public static BridgeResponse FromStatus(string command, BridgeStatusReport status) => new(
        status.accepted,
        BridgeContract.Version,
        Info(),
        new { command },
        status);

    public static BridgeResponse FromLab(BridgeRequest request, LabResult lab) => new(
        lab.status.accepted,
        BridgeContract.Version,
        Info(),
        new
        {
            command = request.Command,
            durationMs = request.DurationMs,
            devAllowPassThrough = request.DevAllowPassThrough,
            devAllowVirtualRoute = request.DevAllowVirtualRoute,
            devAllowClockDiscipline = request.DevAllowClockDiscipline,
            realOutputEndpointId = string.IsNullOrWhiteSpace(request.RealOutputEndpointId) ? null : "[explicit-endpoint-id]",
            leaderEndpointId = string.IsNullOrWhiteSpace(request.LeaderEndpointId) ? null : "[explicit-endpoint-id]",
            followerEndpointId = string.IsNullOrWhiteSpace(request.FollowerEndpointId) ? null : "[explicit-endpoint-id]"
        },
        lab.status,
        lab.details);

    static object Info() => new
    {
        name = "Pixelody System Audio Bridge",
        mode = "dev-bounded-labs",
        audioEngineImplemented = false,
        policy = "The laboratories are explicit, bounded, shared-mode only, and cannot change Windows routing or install a driver. The virtual-route lab is not a resident bridge."
    };
}

static class BridgeStatusFactory
{
    public static BridgeStatusReport ForStub(string command) => New(
        true,
        RouteState.VirtualEndpointMissing,
        false,
        false,
        "The bridge protocol is present, but the Pixelody virtual endpoint driver is not installed and this command opens no audio streams.");

    public static BridgeStatusReport ForProbe()
    {
        try
        {
            var endpoints = Wasapi.ListActiveRenderEndpoints();
            return New(
                true,
                RouteState.BridgeReady,
                true,
                false,
                $"Found {endpoints.Count} active render endpoint(s). Select two distinct endpoint IDs before running the dev pass-through lab.",
                new { availableRenderEndpoints = endpoints });
        }
        catch (Exception ex)
        {
            return New(false, RouteState.Error, false, false, $"Endpoint probe failed: {ex.Message}");
        }
    }

    public static BridgeStatusReport Unsupported(string command) => New(false, RouteState.Error, false, false, $"Unsupported bridge command: {command}.");

    public static BridgeStatusReport New(bool accepted, string state, bool ready, bool active, string reason, object? endpoints = null, object? format = null, object? counters = null, object? watchdog = null) => new(
        accepted,
        state,
        ready,
        active,
        reason,
        endpoints ?? EmptyEndpoints(),
        format ?? EmptyFormat(),
        counters ?? EmptyCounters(),
        watchdog ?? new { current = false, lastHeartbeatUtc = (string?)null });

    public static object EmptyEndpoints() => new
    {
        virtualOutput = new { name = BridgeContract.VirtualOutput, id = (string?)null, present = false },
        virtualMonitor = new { name = BridgeContract.VirtualMonitor, id = (string?)null, present = false },
        realOutput = new { name = (string?)null, id = (string?)null, present = false }
    };

    public static object EmptyFormat() => new { sampleRate = (int?)null, channels = (int?)null, framesPerPeriod = (int?)null };
    public static object EmptyCounters() => new { inputFrames = 0L, outputFrames = 0L, underruns = 0L, overruns = 0L, driftPpm = 0d, latencyMs = (double?)null };
}

sealed record LabResult(BridgeStatusReport status, object details);

static class VirtualRouteLab
{
    const string Mode = "dev-virtual-route-pass-through";

    public static LabResult Run(BridgeRequest request)
    {
        if (!request.DevAllowVirtualRoute)
        {
            return Rejected(RouteState.Error, "Virtual-route laboratory requires --dev-allow-virtual-route. It is disabled by default.");
        }
        if (string.IsNullOrWhiteSpace(request.RealOutputEndpointId))
        {
            return Rejected(RouteState.RealOutputMissing, "--real-output-endpoint-id is required. The bridge never selects a physical output automatically.");
        }

        try
        {
            var virtualOutputs = Wasapi.ListActiveRenderEndpoints().Where(endpoint => string.Equals(endpoint.name, BridgeContract.VirtualOutput, StringComparison.Ordinal)).ToList();
            var virtualMonitors = Wasapi.ListActiveCaptureEndpoints().Where(endpoint => string.Equals(endpoint.name, BridgeContract.VirtualMonitor, StringComparison.Ordinal)).ToList();
            if (virtualOutputs.Count != 1 || virtualMonitors.Count != 1)
            {
                return Rejected(RouteState.VirtualEndpointMissing, "Exactly one active Pixelody Virtual Output render endpoint and one active Pixelody Virtual Monitor capture endpoint are required before the virtual-route lab can open streams.");
            }

            var virtualOutput = virtualOutputs[0];
            var virtualMonitor = Wasapi.GetCaptureEndpoint(virtualMonitors[0].id);
            var realOutput = Wasapi.GetRenderEndpoint(request.RealOutputEndpointId);
            var endpoints = () => EndpointReport(virtualOutput, virtualMonitor, realOutput);
            if (string.Equals(realOutput.id, virtualOutput.id, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(realOutput.id, virtualMonitor.id, StringComparison.OrdinalIgnoreCase) ||
                Wasapi.IsPixelodyVirtual(realOutput.name))
            {
                return Rejected(RouteState.LoopRiskBlocked, "The selected real output resolves to a Pixelody virtual endpoint or the capture endpoint. Virtual-output loops are blocked.", endpoints());
            }
            if (!IsFirstDriverFormat(virtualMonitor.format) || !IsFirstDriverFormat(virtualOutput.format) || !IsFirstDriverFormat(realOutput.format))
            {
                return Rejected(RouteState.Error, "The virtual-route lab supports only stereo 48 kHz shared-mode PCM. It does not resample or convert formats.", endpoints());
            }
            if (!Wasapi.FormatsMatch(virtualMonitor.format, realOutput.format))
            {
                return Rejected(RouteState.Error, "The virtual monitor and real output have different shared mix formats. This neutral pass-through lab refuses format conversion.", endpoints());
            }

            return PassThroughLab.Execute(
                request,
                virtualMonitor,
                realOutput,
                AudioClientStreamFlags.NoPersist,
                Mode,
                endpoints,
                "virtual-monitor-plus-explicit-real-output");
        }
        catch (Exception ex)
        {
            return Rejected(RouteState.Error, $"Virtual-route laboratory could not resolve the guarded endpoint route: {ex.Message}");
        }
    }

    static bool IsFirstDriverFormat(MixFormatInfo format) => format.channels == 2 && format.sampleRate == 48000;

    static LabResult Rejected(string state, string reason, object? endpoints = null) => new(
        BridgeStatusFactory.New(false, state, false, false, reason, endpoints),
        new { mode = Mode, neutral = true, stopReason = "safety-check", endpointSelection = "virtual-monitor-plus-explicit-real-output" });

    static object EndpointReport(EndpointInfo virtualOutput, EndpointInfo virtualMonitor, EndpointInfo realOutput) => new
    {
        virtualOutput = new { virtualOutput.id, virtualOutput.name, virtualOutput.state, present = true, virtualOutput.defaultPeriodMs, virtualOutput.minimumPeriodMs },
        virtualMonitor = new { virtualMonitor.id, virtualMonitor.name, virtualMonitor.state, present = true, virtualMonitor.defaultPeriodMs, virtualMonitor.minimumPeriodMs },
        realOutput = new { realOutput.id, realOutput.name, realOutput.state, present = true, realOutput.defaultPeriodMs, realOutput.minimumPeriodMs }
    };
}

static class ClockDisciplineLab
{
    const string Mode = "dev-endpoint-clock-discipline";

    public static LabResult SelfTest(BridgeRequest request)
    {
        if (!request.DevAllowClockDiscipline)
        {
            return Rejected("Clock-discipline self-test requires --dev-allow-clock-discipline. It is disabled by default.");
        }
        var details = ClockDisciplineSelfTest.Run();
        if (!details.passed)
        {
            return Rejected("The clock-discipline self-test failed its correction or PCM-resampler bounds.");
        }
        return new LabResult(
            BridgeStatusFactory.New(true, RouteState.BridgeReady, true, false, "The bounded clock-discipline model self-test passed without opening audio streams."),
            new { mode = "clock-discipline-self-test", opensAudioStreams = false, details });
    }

    public static LabResult Run(BridgeRequest request)
    {
        if (!request.DevAllowClockDiscipline)
        {
            return Rejected("Endpoint-clock monitoring requires --dev-allow-clock-discipline. It is disabled by default.");
        }
        if (string.IsNullOrWhiteSpace(request.LeaderEndpointId) || string.IsNullOrWhiteSpace(request.FollowerEndpointId))
        {
            return Rejected("Both --leader-endpoint-id and --follower-endpoint-id are required. The laboratory never selects a fallback output.");
        }
        if (string.Equals(request.LeaderEndpointId, request.FollowerEndpointId, StringComparison.OrdinalIgnoreCase))
        {
            return Rejected("Leader and follower endpoint IDs are identical. Duplicate-route clock monitoring is blocked before opening streams.");
        }

        try
        {
            var leader = Wasapi.GetRenderEndpoint(request.LeaderEndpointId);
            var follower = Wasapi.GetRenderEndpoint(request.FollowerEndpointId);
            if (Wasapi.IsPixelodyVirtual(leader.name) || Wasapi.IsPixelodyVirtual(follower.name))
            {
                return Rejected("Endpoint-clock monitoring only accepts two explicit non-virtual render endpoints.", Endpoints(leader, follower));
            }
            return Execute(request, leader, follower);
        }
        catch (Exception ex)
        {
            return Rejected($"Endpoint-clock monitoring could not resolve the selected outputs: {ex.Message}");
        }
    }

    static LabResult Execute(BridgeRequest request, EndpointInfo leaderEndpoint, EndpointInfo followerEndpoint)
    {
        IAudioClient? leaderClient = null;
        IAudioClient? followerClient = null;
        IAudioRenderClient? leaderRender = null;
        IAudioRenderClient? followerRender = null;
        IAudioClock? leaderClock = null;
        IAudioClock? followerClock = null;
        IntPtr leaderFormat = IntPtr.Zero;
        IntPtr followerFormat = IntPtr.Zero;
        var leaderStarted = false;
        var followerStarted = false;
        var leaderQueuedFrames = 0L;
        var followerQueuedFrames = 0L;
        var leaderModel = new EndpointClockModel(leaderEndpoint.format.sampleRate);
        var followerModel = new EndpointClockModel(followerEndpoint.format.sampleRate);
        var discipline = new FollowerClockDiscipline();
        var correction = new FollowerClockCorrection(1, 0, 0, 0, false, "warming-up");
        var stopwatch = Stopwatch.StartNew();
        var stopReason = "not-started";
        try
        {
            leaderClient = Wasapi.OpenAudioClient(leaderEndpoint.id);
            followerClient = Wasapi.OpenAudioClient(followerEndpoint.id);
            Wasapi.ThrowIfFailed(leaderClient.GetMixFormat(out leaderFormat), "GetMixFormat leader");
            Wasapi.ThrowIfFailed(followerClient.GetMixFormat(out followerFormat), "GetMixFormat follower");
            Wasapi.ThrowIfFailed(leaderClient.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.NoPersist, Wasapi.MsToReferenceTime(200), 0, leaderFormat, IntPtr.Zero), "Initialize leader render");
            Wasapi.ThrowIfFailed(followerClient.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.NoPersist, Wasapi.MsToReferenceTime(200), 0, followerFormat, IntPtr.Zero), "Initialize follower render");
            Wasapi.ThrowIfFailed(leaderClient.GetBufferSize(out var leaderBufferFrames), "GetBufferSize leader");
            Wasapi.ThrowIfFailed(followerClient.GetBufferSize(out var followerBufferFrames), "GetBufferSize follower");
            var leaderRenderGuid = Wasapi.RenderClientGuid;
            var followerRenderGuid = Wasapi.RenderClientGuid;
            Wasapi.ThrowIfFailed(leaderClient.GetService(ref leaderRenderGuid, out var leaderRenderObject), "GetService IAudioRenderClient leader");
            Wasapi.ThrowIfFailed(followerClient.GetService(ref followerRenderGuid, out var followerRenderObject), "GetService IAudioRenderClient follower");
            leaderRender = (IAudioRenderClient)leaderRenderObject;
            followerRender = (IAudioRenderClient)followerRenderObject;
            leaderClock = Wasapi.GetAudioClock(leaderClient);
            followerClock = Wasapi.GetAudioClock(followerClient);
            Wasapi.ThrowIfFailed(leaderClock.GetFrequency(out var leaderClockFrequency), "GetFrequency IAudioClock leader");
            Wasapi.ThrowIfFailed(followerClock.GetFrequency(out var followerClockFrequency), "GetFrequency IAudioClock follower");
            if (leaderClockFrequency == 0 || followerClockFrequency == 0)
            {
                return Rejected("A selected endpoint reported an invalid IAudioClock frequency.", Endpoints(leaderEndpoint, followerEndpoint));
            }

            Wasapi.ThrowIfFailed(leaderClient.Start(), "Start leader render");
            leaderStarted = true;
            Wasapi.ThrowIfFailed(followerClient.Start(), "Start follower render");
            followerStarted = true;
            while (stopwatch.ElapsedMilliseconds < request.DurationMs)
            {
                leaderQueuedFrames += QueueSilentFrames(leaderClient, leaderRender, leaderBufferFrames);
                followerQueuedFrames += QueueSilentFrames(followerClient, followerRender, followerBufferFrames);
                Wasapi.ThrowIfFailed(leaderClock.GetPosition(out var leaderFrames, out var leaderQpc), "GetPosition IAudioClock leader");
                Wasapi.ThrowIfFailed(followerClock.GetPosition(out var followerFrames, out var followerQpc), "GetPosition IAudioClock follower");
                leaderModel.Add(leaderFrames, leaderQpc);
                followerModel.Add(followerFrames, followerQpc);
                Wasapi.ThrowIfFailed(followerClient.GetCurrentPadding(out var followerPadding), "GetCurrentPadding follower");
                correction = discipline.Update(leaderModel.Snapshot(), followerModel.Snapshot(), checked((int)followerPadding - checked((int)followerBufferFrames / 2)), checked((int)followerBufferFrames / 2));
                Thread.Sleep(10);
            }

            stopReason = "duration-elapsed";
            var leaderSnapshot = leaderModel.Snapshot();
            var followerSnapshot = followerModel.Snapshot();
            var observed = leaderSnapshot.sampleCount >= 2 && followerSnapshot.sampleCount >= 2 && leaderSnapshot.latestDeviceFrames > 0 && followerSnapshot.latestDeviceFrames > 0;
            var reason = observed
                ? "Both selected endpoint clocks advanced during the bounded monitoring lab. The reported follower ratio is bounded runtime correction only; no Pixelody source audio was rendered."
                : "Both render streams opened, but the endpoint clocks did not advance enough for a usable correction estimate.";
            var state = observed ? RouteState.Degraded : RouteState.BypassSuspected;
            var latencyMs = Math.Round(((double)leaderBufferFrames / leaderEndpoint.format.sampleRate + (double)followerBufferFrames / followerEndpoint.format.sampleRate) * 1000d, 3);
            var status = BridgeStatusFactory.New(
                true,
                state,
                true,
                false,
                reason,
                Endpoints(leaderEndpoint, followerEndpoint),
                new { leader = leaderEndpoint.format, follower = followerEndpoint.format, leaderBufferFrames, followerBufferFrames },
                new { inputFrames = 0L, outputFrames = leaderQueuedFrames + followerQueuedFrames, underruns = 0L, overruns = 0L, driftPpm = Math.Round(followerSnapshot.driftPpm - leaderSnapshot.driftPpm, 3), latencyMs, leaderQueuedFrames, followerQueuedFrames, correctionPpm = Math.Round(correction.correctionPpm, 3), correctionRatio = correction.ratio, correctionState = correction.state },
                new { current = observed, lastHeartbeatUtc = DateTime.UtcNow.ToString("O") });
            return new LabResult(status, new
            {
                mode = Mode,
                endpointSelection = "explicit-leader-and-follower-only",
                silentKeepAliveOnly = true,
                sourceAudioRendered = false,
                stopReason,
                durationMs = request.DurationMs,
                elapsedMs = stopwatch.ElapsedMilliseconds,
                leaderClock = leaderSnapshot,
                followerClock = followerSnapshot,
                followerCorrection = correction,
                resampler = new { algorithm = "linear-interpolation", ratioMin = FollowerClockDiscipline.MinimumRatio, ratioMax = FollowerClockDiscipline.MaximumRatio, maxCorrectionPpm = FollowerClockDiscipline.MaximumCorrectionPpm, maxSlewPpmPerUpdate = FollowerClockDiscipline.MaximumSlewPpmPerUpdate }
            });
        }
        catch (Exception ex)
        {
            stopReason = $"error: {ex.Message}";
            return Rejected(stopReason, Endpoints(leaderEndpoint, followerEndpoint));
        }
        finally
        {
            if (followerStarted) { try { followerClient?.Stop(); } catch { } }
            if (leaderStarted) { try { leaderClient?.Stop(); } catch { } }
            Wasapi.Release(leaderClock);
            Wasapi.Release(followerClock);
            Wasapi.Release(leaderRender);
            Wasapi.Release(followerRender);
            Wasapi.Release(leaderClient);
            Wasapi.Release(followerClient);
            if (leaderFormat != IntPtr.Zero) Marshal.FreeCoTaskMem(leaderFormat);
            if (followerFormat != IntPtr.Zero) Marshal.FreeCoTaskMem(followerFormat);
        }
    }

    static uint QueueSilentFrames(IAudioClient client, IAudioRenderClient render, uint bufferFrames)
    {
        Wasapi.ThrowIfFailed(client.GetCurrentPadding(out var padding), "GetCurrentPadding render");
        var available = bufferFrames > padding ? bufferFrames - padding : 0;
        if (available == 0) return 0;
        render.GetBuffer(available, out _);
        render.ReleaseBuffer(available, AudioClientBufferFlags.Silent);
        return available;
    }

    static LabResult Rejected(string reason, object? endpoints = null) => new(
        BridgeStatusFactory.New(false, RouteState.ClockDisciplineBlocked, false, false, reason, endpoints),
        new { mode = Mode, stopReason = "safety-check", endpointSelection = "explicit-leader-and-follower-only", sourceAudioRendered = false });

    static object Endpoints(EndpointInfo leader, EndpointInfo follower) => new
    {
        leader = new { leader.id, leader.name, leader.state, leader.defaultPeriodMs, leader.minimumPeriodMs },
        follower = new { follower.id, follower.name, follower.state, follower.defaultPeriodMs, follower.minimumPeriodMs }
    };
}

static class PassThroughLab
{
    public static LabResult Run(BridgeRequest request)
    {
        if (!request.DevAllowPassThrough)
        {
            return Rejected(RouteState.Error, "Pass-through laboratory requires --dev-allow-pass-through. It is disabled by default.");
        }
        if (string.IsNullOrWhiteSpace(request.CaptureEndpointId) || string.IsNullOrWhiteSpace(request.RenderEndpointId))
        {
            return Rejected(RouteState.Error, "Both --capture-endpoint-id and --render-endpoint-id are required. The lab never selects devices automatically.");
        }
        if (string.Equals(request.CaptureEndpointId, request.RenderEndpointId, StringComparison.OrdinalIgnoreCase))
        {
            return Rejected(RouteState.LoopRiskBlocked, "Capture and render endpoint IDs are identical. Same-endpoint pass-through is blocked to prevent duplicate audio or feedback.");
        }

        try
        {
            var captureEndpoint = Wasapi.GetRenderEndpoint(request.CaptureEndpointId);
            var renderEndpoint = Wasapi.GetRenderEndpoint(request.RenderEndpointId);
            if (Wasapi.IsPixelodyVirtual(captureEndpoint.name) || Wasapi.IsPixelodyVirtual(renderEndpoint.name))
            {
                return Rejected(RouteState.LoopRiskBlocked, "The dev pass-through lab cannot capture from or render to a Pixelody virtual endpoint.", captureEndpoint, renderEndpoint);
            }
            if (!Wasapi.FormatsMatch(captureEndpoint.format, renderEndpoint.format))
            {
                return Rejected(RouteState.Error, "The selected endpoints have different shared mix formats. This pass-through-only lab refuses format conversion.", captureEndpoint, renderEndpoint);
            }
            return Execute(
                request,
                captureEndpoint,
                renderEndpoint,
                AudioClientStreamFlags.Loopback | AudioClientStreamFlags.NoPersist,
                "dev-two-endpoint-pass-through",
                () => Endpoints(captureEndpoint, renderEndpoint),
                "explicit-id-only");
        }
        catch (Exception ex)
        {
            return Rejected(RouteState.Error, $"Pass-through laboratory could not open the selected endpoint: {ex.Message}");
        }
    }

    internal static LabResult Execute(BridgeRequest request, EndpointInfo captureEndpoint, EndpointInfo renderEndpoint, AudioClientStreamFlags captureFlags, string mode, Func<object> endpointReport, string endpointSelection)
    {
        IAudioClient? captureClient = null;
        IAudioClient? renderClient = null;
        IAudioCaptureClient? captureService = null;
        IAudioRenderClient? renderService = null;
        IntPtr captureFormat = IntPtr.Zero;
        IntPtr renderFormat = IntPtr.Zero;
        var inputFrames = 0L;
        var outputFrames = 0L;
        var underruns = 0L;
        var overruns = 0L;
        var discontinuities = 0L;
        var captureWaits = 0L;
        var started = false;
        var stopReason = "not-started";
        var stopwatch = Stopwatch.StartNew();
        try
        {
            captureClient = Wasapi.OpenAudioClient(captureEndpoint.id);
            renderClient = Wasapi.OpenAudioClient(renderEndpoint.id);
            Wasapi.ThrowIfFailed(captureClient.GetMixFormat(out captureFormat), "GetMixFormat capture");
            Wasapi.ThrowIfFailed(renderClient.GetMixFormat(out renderFormat), "GetMixFormat render");
            if (!Wasapi.FormatsMatch(Wasapi.ReadFormat(captureFormat), Wasapi.ReadFormat(renderFormat)))
            {
                var formatChangedStatus = BridgeStatusFactory.New(false, RouteState.Error, false, false, "Selected endpoint formats changed before streams opened. The pass-through lab stopped without conversion.", endpointReport());
                return new LabResult(formatChangedStatus, new { mode, neutral = true, stopReason = "format-changed", durationMs = request.DurationMs, elapsedMs = stopwatch.ElapsedMilliseconds });
            }
            Wasapi.ThrowIfFailed(captureClient.Initialize(AudioClientShareMode.Shared, captureFlags, Wasapi.MsToReferenceTime(200), 0, captureFormat, IntPtr.Zero), "Initialize capture");
            Wasapi.ThrowIfFailed(renderClient.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.NoPersist, Wasapi.MsToReferenceTime(200), 0, renderFormat, IntPtr.Zero), "Initialize shared render");
            Wasapi.ThrowIfFailed(captureClient.GetBufferSize(out var captureBufferFrames), "GetBufferSize capture");
            Wasapi.ThrowIfFailed(renderClient.GetBufferSize(out var renderBufferFrames), "GetBufferSize render");
            Wasapi.ThrowIfFailed(captureClient.GetStreamLatency(out var captureLatency), "GetStreamLatency capture");
            Wasapi.ThrowIfFailed(renderClient.GetStreamLatency(out var renderLatency), "GetStreamLatency render");
            var captureServiceGuid = Wasapi.CaptureClientGuid;
            var renderServiceGuid = Wasapi.RenderClientGuid;
            Wasapi.ThrowIfFailed(captureClient.GetService(ref captureServiceGuid, out var captureObject), "GetService IAudioCaptureClient");
            Wasapi.ThrowIfFailed(renderClient.GetService(ref renderServiceGuid, out var renderObject), "GetService IAudioRenderClient");
            captureService = (IAudioCaptureClient)captureObject;
            renderService = (IAudioRenderClient)renderObject;
            Wasapi.ThrowIfFailed(renderClient.Start(), "Start shared render");
            Wasapi.ThrowIfFailed(captureClient.Start(), "Start loopback capture");
            started = true;

            while (stopwatch.ElapsedMilliseconds < request.DurationMs)
            {
                captureService.GetNextPacketSize(out var packetFrames);
                if (packetFrames == 0)
                {
                    captureWaits++;
                    Thread.Sleep(2);
                    continue;
                }
                while (packetFrames > 0)
                {
                    captureService.GetBuffer(out var source, out var capturedFrames, out var flags, out _, out _);
                    inputFrames += capturedFrames;
                    if (flags.HasFlag(AudioClientBufferFlags.DataDiscontinuity)) discontinuities++;
                    Wasapi.ThrowIfFailed(renderClient.GetCurrentPadding(out var paddingFrames), "GetCurrentPadding render");
                    var availableFrames = renderBufferFrames > paddingFrames ? renderBufferFrames - paddingFrames : 0;
                    if (capturedFrames > availableFrames)
                    {
                        overruns++;
                        captureService.ReleaseBuffer(capturedFrames);
                        captureService.GetNextPacketSize(out packetFrames);
                        continue;
                    }
                    renderService.GetBuffer(capturedFrames, out var target);
                    if (flags.HasFlag(AudioClientBufferFlags.Silent))
                    {
                        Wasapi.Clear(target, checked((int)(capturedFrames * captureEndpoint.format.blockAlign)));
                    }
                    else
                    {
                        Wasapi.Copy(source, target, checked((int)(capturedFrames * captureEndpoint.format.blockAlign)));
                    }
                    renderService.ReleaseBuffer(capturedFrames, flags.HasFlag(AudioClientBufferFlags.Silent) ? AudioClientBufferFlags.Silent : AudioClientBufferFlags.None);
                    outputFrames += capturedFrames;
                    captureService.ReleaseBuffer(capturedFrames);
                    captureService.GetNextPacketSize(out packetFrames);
                }
            }
            stopReason = "duration-elapsed";
            var observedActive = inputFrames > 0 && outputFrames > 0;
            var degraded = observedActive && (overruns > 0 || discontinuities > 0);
            var state = !observedActive ? RouteState.BypassSuspected : degraded ? RouteState.Degraded : RouteState.Active;
            var reason = !observedActive
                ? "Both streams opened, but no pass-through frames completed during the bounded lab window."
                : degraded
                    ? "Pass-through frames moved, with capture discontinuity or render backpressure warnings."
                    : "Pass-through frames moved between distinct endpoints for the bounded dev lab.";
            var latencyMs = Math.Round(Wasapi.ReferenceTimeToMs(captureLatency) + Wasapi.ReferenceTimeToMs(renderLatency) + ((double)renderBufferFrames / captureEndpoint.format.sampleRate * 1000), 3);
            var status = BridgeStatusFactory.New(
                true,
                state,
                true,
                observedActive,
                reason,
                endpointReport(),
                new { sampleRate = captureEndpoint.format.sampleRate, channels = captureEndpoint.format.channels, framesPerPeriod = renderBufferFrames, captureBufferFrames, renderBufferFrames },
                new { inputFrames, outputFrames, underruns, overruns, driftPpm = 0d, latencyMs, captureDiscontinuities = discontinuities, captureWaits },
                new { current = observedActive, lastHeartbeatUtc = DateTime.UtcNow.ToString("O") });
            return new LabResult(status, new { mode, neutral = true, stopReason, durationMs = request.DurationMs, elapsedMs = stopwatch.ElapsedMilliseconds, endpointSelection });
        }
        catch (Exception ex)
        {
            stopReason = $"error: {ex.Message}";
            var status = BridgeStatusFactory.New(false, RouteState.Error, false, false, stopReason, endpointReport());
            return new LabResult(status, new { mode, neutral = true, stopReason, durationMs = request.DurationMs, elapsedMs = stopwatch.ElapsedMilliseconds });
        }
        finally
        {
            if (started)
            {
                try { captureClient?.Stop(); } catch { }
                try { renderClient?.Stop(); } catch { }
            }
            Wasapi.Release(captureService);
            Wasapi.Release(renderService);
            Wasapi.Release(captureClient);
            Wasapi.Release(renderClient);
            if (captureFormat != IntPtr.Zero) Marshal.FreeCoTaskMem(captureFormat);
            if (renderFormat != IntPtr.Zero) Marshal.FreeCoTaskMem(renderFormat);
        }
    }

    static LabResult Rejected(string state, string reason, EndpointInfo? capture = null, EndpointInfo? render = null) => new(
        BridgeStatusFactory.New(false, state, false, false, reason, capture is null || render is null ? null : Endpoints(capture, render)),
        new { mode = "dev-two-endpoint-pass-through", neutral = true, stopReason = "safety-check", endpointSelection = "explicit-id-only" });

    static object Endpoints(EndpointInfo capture, EndpointInfo render) => new
    {
        virtualOutput = new { name = BridgeContract.VirtualOutput, id = (string?)null, present = false },
        virtualMonitor = new { name = BridgeContract.VirtualMonitor, id = (string?)null, present = false },
        capture = new { capture.id, capture.name, capture.state },
        realOutput = new { render.id, render.name, present = true }
    };
}
