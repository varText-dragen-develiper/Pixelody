using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;

var options = CliOptions.Parse(args);
if (!options.Json || (!options.Diagnose && !options.Probe && !options.LoopbackPrototype))
{
    Console.Error.WriteLine("Usage: Pixelody.Wasapi.Helper.exe --json (--diagnose | --probe | --loopback-prototype --dev-allow-loopback-prototype) [--output-label NAME] [--sink-id ID] [--duration-ms 1000] [--eq-json BASE64_JSON] [--bridge-present 0|1] [--bridge-source NAME]");
    Environment.Exit(2);
}
if (options.LoopbackPrototype && !options.DevAllowLoopbackPrototype)
{
    Console.Error.WriteLine("--loopback-prototype requires --dev-allow-loopback-prototype");
    Environment.Exit(2);
}

try
{
    var report = options.LoopbackPrototype
        ? WasapiDiagnostics.BuildLoopbackPrototype(options)
        : WasapiDiagnostics.Build(options);
    Console.WriteLine(JsonSerializer.Serialize(report, JsonOptions()));
}
catch (Exception ex)
{
    Console.WriteLine(JsonSerializer.Serialize(new
    {
        ok = false,
        contract = WasapiContract.Version,
        error = ex.Message,
        stack = ex.StackTrace,
        helper = HelperInfo.Payload()
    }, JsonOptions()));
    Environment.Exit(1);
}

static JsonSerializerOptions JsonOptions() => new()
{
    WriteIndented = false,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
};

static class WasapiContract
{
    public const int Version = 3;
}

static class VirtualEndpointContract
{
    public const string ExpectedRenderName = "Pixelody Virtual Output";
    public const string ExpectedCaptureName = "Pixelody Virtual Monitor";

    public static bool NameLooksVirtual(string value)
    {
        var name = value ?? "";
        return name.Contains("Pixelody Virtual", StringComparison.OrdinalIgnoreCase)
            || name.Contains(ExpectedRenderName, StringComparison.OrdinalIgnoreCase);
    }
}

static class SystemAudioRouteState
{
    public const string Off = "off";
    public const string HelperMissing = "helper-missing";
    public const string VirtualEndpointMissing = "virtual-endpoint-missing";
    public const string VirtualInputDetected = "virtual-input-detected";
    public const string BridgeMissing = "bridge-missing";
    public const string BridgeStarting = "bridge-starting";
    public const string BridgeReady = "bridge-ready";
    public const string Active = "active";
    public const string Degraded = "degraded";
    public const string BypassSuspected = "bypass-suspected";
    public const string RealOutputMissing = "real-output-missing";
    public const string LoopRiskBlocked = "loop-risk-blocked";
    public const string RestoreNeeded = "restore-needed";
    public const string Error = "error";
}

sealed record CliOptions(bool Json, bool Diagnose, bool Probe, bool LoopbackPrototype, bool DevAllowLoopbackPrototype, string OutputLabel, string SinkId, int DurationMs, string EqJson, bool BridgePresent, string BridgeSource)
{
    public static CliOptions Parse(string[] args)
    {
        var json = false;
        var diagnose = false;
        var probe = false;
        var loopbackPrototype = false;
        var devAllowLoopbackPrototype = false;
        var outputLabel = "";
        var sinkId = "";
        var durationMs = 1000;
        var eqJson = "";
        var bridgePresent = false;
        var bridgeSource = "";
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--json":
                    json = true;
                    break;
                case "--diagnose":
                    diagnose = true;
                    break;
                case "--probe":
                    probe = true;
                    break;
                case "--loopback-prototype":
                    loopbackPrototype = true;
                    break;
                case "--dev-allow-loopback-prototype":
                    devAllowLoopbackPrototype = true;
                    break;
                case "--output-label" when i + 1 < args.Length:
                    outputLabel = args[++i];
                    break;
                case "--sink-id" when i + 1 < args.Length:
                    sinkId = args[++i];
                    break;
                case "--duration-ms" when i + 1 < args.Length && int.TryParse(args[i + 1], out var parsedDuration):
                    durationMs = Math.Clamp(parsedDuration, 250, 3000);
                    i++;
                    break;
                case "--eq-json" when i + 1 < args.Length:
                    eqJson = args[++i];
                    break;
                case "--bridge-present" when i + 1 < args.Length:
                    bridgePresent = args[++i] is "1" or "true" or "True";
                    break;
                case "--bridge-source" when i + 1 < args.Length:
                    bridgeSource = args[++i];
                    break;
            }
        }
        return new CliOptions(json, diagnose, probe, loopbackPrototype, devAllowLoopbackPrototype, outputLabel, sinkId, durationMs, eqJson, bridgePresent, bridgeSource);
    }
}

static class HelperInfo
{
    public static object Payload() => new
    {
        name = "Pixelody WASAPI Helper",
        version = typeof(HelperInfo).Assembly.GetName().Version?.ToString() ?? "0.0.0",
        mode = "diagnostics-and-dev-probe",
        policy = "No driver, no service, no registry edits, no default-device changes, no exclusive-mode playback. Loopback prototype is capture/analysis-only and dev-gated; Virtual Endpoint is the intended global EQ route once a signed endpoint component exists."
    };
}

static class WasapiDiagnostics
{
    public static object Build(CliOptions options)
    {
        var enumerator = CreateDeviceEnumerator();
        ThrowIfFailed(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out var defaultDevice), "GetDefaultAudioEndpoint");
        var defaultId = DeviceId(defaultDevice);
        var endpoints = new List<EndpointReport> { ReadEndpoint(defaultDevice, defaultId) };
        var selected = MatchEndpoint(endpoints, options);
        var capability = options.Probe ? BuildCapabilityProbe(defaultDevice, defaultDevice, selected, defaultId, options) : null;
        ReleaseCom(defaultDevice);
        ReleaseCom(enumerator);
        return new
        {
            ok = true,
            contract = WasapiContract.Version,
            helper = HelperInfo.Payload(),
            windows = new
            {
                os = Environment.OSVersion.VersionString,
                architecture = RuntimeInformation.OSArchitecture.ToString()
            },
            request = new
            {
                outputLabel = options.OutputLabel,
                sinkId = options.SinkId,
                command = options.Probe ? "probe" : "diagnose"
            },
            selected,
            capability,
            endpoints,
            caveats = new[]
            {
                "Chromium/Electron shared output may still resample before the Windows endpoint.",
                "This helper reports Windows endpoint facts only; it does not measure analog speaker response or latency.",
                "Exclusive-mode playback is intentionally not used by this helper.",
                "Apps using ASIO, protected playback, or exclusive/direct device paths may bypass shared-mode loopback."
            }
        };
    }

    public static object BuildLoopbackPrototype(CliOptions options)
    {
        var enumerator = CreateDeviceEnumerator();
        ThrowIfFailed(enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out var defaultDevice), "GetDefaultAudioEndpoint");
        var defaultId = DeviceId(defaultDevice);
        var selected = ReadEndpoint(defaultDevice, defaultId) with { match = "default-render-loopback-prototype" };
        var eqPayload = DecodeEqPayload(options.EqJson);
        var eqSettings = NativeEqSettings.FromEncodedJson(options.EqJson);
        var capture = ProbeLoopbackCapture(defaultDevice, options.DurationMs, true, eqSettings);
        var renderProbe = ProbeSharedRenderRoute(defaultDevice);
        var route = BuildRenderRoute(defaultId, selected, renderProbe);
        ReleaseCom(defaultDevice);
        ReleaseCom(enumerator);
        return new
        {
            ok = capture.supported,
            contract = WasapiContract.Version,
            helper = HelperInfo.Payload(),
            request = new
            {
                command = "loopback-prototype",
                durationMs = options.DurationMs,
                outputLabel = options.OutputLabel,
                sinkId = options.SinkId
            },
            selected,
            prototype = new
            {
                mode = "dev-capture-analysis-only",
                capture,
                render = new
                {
                    enabled = false,
                    route,
                    preflight = renderProbe,
                    reason = route.candidate
                        ? "Separate-output render route is a dev candidate, but processed sample writing is still disabled until the guarded render loop is implemented."
                        : route.reason
                },
                processing = new
                {
                    testEq = capture.eqProcessing is not null ? "applied-to-captured-samples-not-rendered" : "planned-not-rendered",
                    eqPayload,
                    sampleProcessing = capture.eqProcessing,
                    note = "This pass proves shared-mode loopback capture availability, packet flow, app EQ payload handoff, and non-audible EQ processing analysis only."
                }
            },
            caveats = new[]
            {
                "Dev-only bounded capture test; no driver, service, registry edit, default-device change, or render reroute.",
                "A silent result may mean no external app was producing shared-mode audio during the capture window.",
                "Sample processing analysis does not render audio and does not prove feedback prevention or audible processed output quality yet."
            }
        };
    }

    static object BuildCapabilityProbe(IMMDevice defaultDevice, IMMDevice renderDevice, EndpointReport? selected, string defaultId, CliOptions options)
    {
        var loopback = ProbeLoopbackCapture(defaultDevice, 0, false);
        var renderProbe = ProbeSharedRenderRoute(renderDevice);
        var route = BuildRenderRoute(defaultId, selected, renderProbe);
        return new
        {
            defaultRenderVisible = selected?.isDefaultRender == true,
            selectedEndpointMatched = selected?.match ?? "none",
            sharedMixFormatReadable = selected?.mixFormat is not null,
            devicePeriodReadable = selected?.devicePeriod is not null,
            loopbackCapture = loopback,
            renderEndpoint = new
            {
                sharedModeLikely = selected?.state == DeviceState.Active.ToString(),
                format = selected?.mixFormat,
                period = selected?.devicePeriod,
                route,
                preflight = renderProbe
            },
            virtualEndpoint = BuildVirtualEndpointProbe(selected, options),
            processedRenderGate = new
            {
                gated = true,
                reason = route.candidate
                    ? "A separate-output render route is available for a future dev prototype, but processed sample writing is not implemented yet."
                    : route.reason
            },
            bypassRisk = new
            {
                exclusiveModeAppsCanBypass = true,
                protectedPlaybackMayBypass = true,
                asioOrDirectHardwareCanBypass = true,
                detection = "conservative-warning"
            }
        };
    }

    static object BuildVirtualEndpointProbe(EndpointReport? selected, CliOptions options)
    {
        var defaultIsVirtualInput = VirtualEndpointContract.NameLooksVirtual(selected?.name ?? "");
        var bridgeMissing = defaultIsVirtualInput && !options.BridgePresent;
        return new
        {
            preferredEngine = "virtual-endpoint",
            expectedInputName = VirtualEndpointContract.ExpectedRenderName,
            expectedMonitorName = VirtualEndpointContract.ExpectedCaptureName,
            defaultSharedOutputIsPixelodyVirtual = defaultIsVirtualInput,
            installed = defaultIsVirtualInput,
            ready = false,
            state = !defaultIsVirtualInput ? SystemAudioRouteState.VirtualEndpointMissing : bridgeMissing ? SystemAudioRouteState.BridgeMissing : SystemAudioRouteState.VirtualInputDetected,
            bridge = new
            {
                present = options.BridgePresent,
                source = string.IsNullOrWhiteSpace(options.BridgeSource) ? null : options.BridgeSource
            },
            reason = !defaultIsVirtualInput
                ? "A Pixelody virtual audio endpoint is not installed or is not the current Windows shared-mode output."
                : bridgeMissing
                    ? "Windows shared-mode audio appears routed into Pixelody Virtual Output, but Pixelody.SystemAudio.Bridge.exe is missing."
                    : "Windows shared-mode audio appears routed into the Pixelody virtual endpoint. The bridge binary is present, but it has not opened a separate real output render target."
        };
    }

    static EndpointReport? MatchEndpoint(IReadOnlyList<EndpointReport> endpoints, CliOptions options)
    {
        if (!string.IsNullOrWhiteSpace(options.OutputLabel))
        {
            var label = options.OutputLabel.Trim();
            var exact = endpoints.FirstOrDefault(endpoint => string.Equals(endpoint.name, label, StringComparison.OrdinalIgnoreCase));
            if (exact is not null) return exact with { match = "label-exact" };
            var contains = endpoints.FirstOrDefault(endpoint => endpoint.name.Contains(label, StringComparison.OrdinalIgnoreCase) || label.Contains(endpoint.name, StringComparison.OrdinalIgnoreCase));
            if (contains is not null) return contains with { match = "label-partial" };
        }
        return endpoints.FirstOrDefault(endpoint => endpoint.isDefaultRender) is { } fallback ? fallback with { match = "default-render" } : null;
    }

    static RenderRouteReport BuildRenderRoute(string defaultId, EndpointReport? selected, RenderProbeReport renderProbe)
    {
        var selectedId = selected?.id ?? "";
        var sameEndpoint = string.IsNullOrWhiteSpace(selectedId) || string.Equals(selectedId, defaultId, StringComparison.OrdinalIgnoreCase);
        var candidate = renderProbe.supported && !sameEndpoint;
        return new RenderRouteReport(
            selected?.name ?? "System Default",
            selected?.match ?? "none",
            defaultId,
            string.IsNullOrWhiteSpace(selectedId) ? defaultId : selectedId,
            sameEndpoint,
            renderProbe.supported,
            candidate,
            candidate ? "separate-output-dev-candidate" : sameEndpoint ? "same-output-blocked" : "render-preflight-blocked",
            candidate
                ? "Loopback capture and render output are different endpoints, so this can be used for a controlled dev render prototype."
                : sameEndpoint
                    ? "The selected render target is the same endpoint being captured. Writing processed audio there would duplicate or feed back the original Windows audio."
                    : "The selected render target is separate, but its shared render preflight did not initialize.");
    }

    static object DecodeEqPayload(string encoded)
    {
        if (string.IsNullOrWhiteSpace(encoded)) return new { received = false, reason = "No EQ payload was provided." };
        try
        {
            var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            var simpleCount = root.TryGetProperty("simple", out var simple) && simple.ValueKind == JsonValueKind.Object ? simple.EnumerateObject().Count() : 0;
            var parametricCount = root.TryGetProperty("parametric", out var parametric) && parametric.ValueKind == JsonValueKind.Array ? parametric.GetArrayLength() : 0;
            return new
            {
                received = true,
                schema = root.TryGetProperty("schema", out var schema) ? schema.GetString() : "",
                mode = root.TryGetProperty("mode", out var mode) ? mode.GetString() : "",
                simpleBandCount = simpleCount,
                activeParametricBands = parametricCount,
                externalAudioApplied = false,
                reason = "EQ payload received but not rendered. Feedback-safe output processing is not implemented yet.",
                payload = root.Clone()
            };
        }
        catch (Exception ex)
        {
            return new { received = false, reason = $"Invalid EQ payload: {ex.Message}" };
        }
    }

    static IMMDeviceEnumerator CreateDeviceEnumerator()
    {
        var type = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"))
            ?? throw new InvalidOperationException("MMDeviceEnumerator COM class is unavailable.");
        return (IMMDeviceEnumerator)(Activator.CreateInstance(type)
            ?? throw new InvalidOperationException("Could not create MMDeviceEnumerator."));
    }

    static EndpointReport ReadEndpoint(IMMDevice device, string defaultId)
    {
        var id = DeviceId(device);
        device.GetState(out var state);
        device.OpenPropertyStore(StorageAccessMode.Read, out var store);
        var name = ReadStringProperty(store, PropertyKeys.DeviceFriendlyName);
        var endpointForm = ReadDisplayProperty(store, PropertyKeys.EndpointFormFactor);
        var mixFormat = ReadMixFormat(device);
        var periods = ReadDevicePeriods(device);
        ReleaseCom(store);
        return new EndpointReport(
            id,
            string.IsNullOrWhiteSpace(name) ? "Audio endpoint" : name,
            state.ToString(),
            endpointForm,
            id == defaultId,
            mixFormat,
            periods,
            null
        );
    }

    static LoopbackProbeReport ProbeLoopbackCapture(IMMDevice device, int durationMs, bool capturePackets, NativeEqSettings? eqSettings = null)
    {
        IAudioClient? audioClient = null;
        IntPtr formatPtr = IntPtr.Zero;
        try
        {
            var iid = typeof(IAudioClient).GUID;
            device.Activate(ref iid, ClsCtx.InprocServer, IntPtr.Zero, out var activated);
            audioClient = (IAudioClient)activated;
            var hrFormat = audioClient.GetMixFormat(out formatPtr);
            if (hrFormat != 0 || formatPtr == IntPtr.Zero) return LoopbackProbeReport.Failed("GetMixFormat", hrFormat);
            var mixFormat = ReadMixFormatPointer(formatPtr);
            var eqProcessor = NativeEqProcessor.TryCreate(eqSettings, mixFormat);
            var hrInitialize = audioClient.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.Loopback | AudioClientStreamFlags.NoPersist, MsToReferenceTime(200), 0, formatPtr, IntPtr.Zero);
            if (hrInitialize != 0) return LoopbackProbeReport.Failed("Initialize loopback capture", hrInitialize, mixFormat);
            audioClient.GetBufferSize(out var bufferFrames);
            audioClient.GetStreamLatency(out var streamLatency);
            if (!capturePackets)
            {
                return new LoopbackProbeReport(true, true, false, "Initialized", null, mixFormat, bufferFrames, ReferenceTimeToMs(streamLatency), 0, 0, 0, 0, 0, null, null);
            }
            var iidCapture = typeof(IAudioCaptureClient).GUID;
            var hrService = audioClient.GetService(ref iidCapture, out var service);
            if (hrService != 0) return LoopbackProbeReport.Failed("GetService IAudioCaptureClient", hrService, mixFormat);
            var captureClient = (IAudioCaptureClient)service;
            var hrStart = audioClient.Start();
            if (hrStart != 0) return LoopbackProbeReport.Failed("Start loopback capture", hrStart, mixFormat);
            var stopwatch = Stopwatch.StartNew();
            uint packets = 0;
            uint frames = 0;
            uint silentPackets = 0;
            uint discontinuities = 0;
            while (stopwatch.ElapsedMilliseconds < durationMs)
            {
                captureClient.GetNextPacketSize(out var packetFrames);
                if (packetFrames == 0)
                {
                    Thread.Sleep(10);
                    continue;
                }
                while (packetFrames > 0)
                {
                    captureClient.GetBuffer(out var data, out var framesAvailable, out var flags, out _, out _);
                    packets++;
                    frames += framesAvailable;
                    if (flags.HasFlag(AudioClientBufferFlags.Silent)) silentPackets++;
                    if (flags.HasFlag(AudioClientBufferFlags.DataDiscontinuity)) discontinuities++;
                    if (!flags.HasFlag(AudioClientBufferFlags.Silent)) eqProcessor?.Analyze(data, framesAvailable);
                    captureClient.ReleaseBuffer(framesAvailable);
                    captureClient.GetNextPacketSize(out packetFrames);
                }
            }
            audioClient.Stop();
            ReleaseCom(captureClient);
            return new LoopbackProbeReport(true, true, true, "Captured", null, mixFormat, bufferFrames, ReferenceTimeToMs(streamLatency), durationMs, packets, frames, silentPackets, discontinuities, null, eqProcessor?.Report());
        }
        catch (Exception ex)
        {
            return new LoopbackProbeReport(false, false, capturePackets, "Exception", ex.Message, null, 0, null, durationMs, 0, 0, 0, 0, null, null);
        }
        finally
        {
            if (audioClient is not null) ReleaseCom(audioClient);
            if (formatPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(formatPtr);
        }
    }

    static RenderProbeReport ProbeSharedRenderRoute(IMMDevice device)
    {
        IAudioClient? audioClient = null;
        IAudioRenderClient? renderClient = null;
        IntPtr formatPtr = IntPtr.Zero;
        try
        {
            var iid = typeof(IAudioClient).GUID;
            device.Activate(ref iid, ClsCtx.InprocServer, IntPtr.Zero, out var activated);
            audioClient = (IAudioClient)activated;
            var hrFormat = audioClient.GetMixFormat(out formatPtr);
            if (hrFormat != 0 || formatPtr == IntPtr.Zero) return RenderProbeReport.Failed("GetMixFormat", hrFormat);
            var mixFormat = ReadMixFormatPointer(formatPtr);
            var hrInitialize = audioClient.Initialize(AudioClientShareMode.Shared, AudioClientStreamFlags.NoPersist, MsToReferenceTime(200), 0, formatPtr, IntPtr.Zero);
            if (hrInitialize != 0) return RenderProbeReport.Failed("Initialize shared render", hrInitialize, mixFormat);
            audioClient.GetBufferSize(out var bufferFrames);
            audioClient.GetStreamLatency(out var streamLatency);
            var iidRender = typeof(IAudioRenderClient).GUID;
            var hrService = audioClient.GetService(ref iidRender, out var service);
            if (hrService != 0) return RenderProbeReport.Failed("GetService IAudioRenderClient", hrService, mixFormat);
            renderClient = (IAudioRenderClient)service;
            return new RenderProbeReport(true, true, true, "Initialized", null, mixFormat, bufferFrames, ReferenceTimeToMs(streamLatency), null, true, "Render preflight only; no processed samples are written to the endpoint yet.");
        }
        catch (Exception ex)
        {
            return new RenderProbeReport(false, false, false, "Exception", ex.Message, null, 0, null, null, true, "Render preflight failed before processed output could be considered.");
        }
        finally
        {
            if (renderClient is not null) ReleaseCom(renderClient);
            if (audioClient is not null) ReleaseCom(audioClient);
            if (formatPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(formatPtr);
        }
    }

    static string DeviceId(IMMDevice device)
    {
        device.GetId(out var id);
        return id;
    }

    static string ReadStringProperty(IPropertyStore store, PropertyKey key)
    {
        PropVariant variant = default;
        try
        {
            store.GetValue(ref key, out variant);
            return variant.AsString();
        }
        finally
        {
            PropVariantClear(ref variant);
        }
    }

    static string ReadDisplayProperty(IPropertyStore store, PropertyKey key)
    {
        PropVariant variant = default;
        try
        {
            store.GetValue(ref key, out variant);
            return variant.AsDisplayValue();
        }
        finally
        {
            PropVariantClear(ref variant);
        }
    }

    static MixFormatReport? ReadMixFormat(IMMDevice device)
    {
        IAudioClient? audioClient = null;
        IntPtr formatPtr = IntPtr.Zero;
        try
        {
            var iid = typeof(IAudioClient).GUID;
            device.Activate(ref iid, ClsCtx.InprocServer, IntPtr.Zero, out var activated);
            audioClient = (IAudioClient)activated;
            var hr = audioClient.GetMixFormat(out formatPtr);
            return hr == 0 && formatPtr != IntPtr.Zero ? ReadMixFormatPointer(formatPtr) : null;
        }
        catch
        {
            return null;
        }
        finally
        {
            if (audioClient is not null) ReleaseCom(audioClient);
            if (formatPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(formatPtr);
        }
    }

    static MixFormatReport ReadMixFormatPointer(IntPtr formatPtr)
    {
        var format = Marshal.PtrToStructure<WaveFormatEx>(formatPtr);
        ushort validBits = format.wBitsPerSample;
        uint channelMask = 0;
        var subFormat = "";
        if (format.wFormatTag == 0xFFFE && format.cbSize >= 22)
        {
            var extensible = Marshal.PtrToStructure<WaveFormatExtensible>(formatPtr);
            validBits = extensible.Samples.wValidBitsPerSample;
            channelMask = extensible.dwChannelMask;
            subFormat = extensible.SubFormat.ToString();
        }
        return new MixFormatReport(format.nChannels, format.nSamplesPerSec, format.nBlockAlign, format.wBitsPerSample, validBits, format.wFormatTag, channelMask, subFormat);
    }

    static DevicePeriodReport? ReadDevicePeriods(IMMDevice device)
    {
        IAudioClient? audioClient = null;
        try
        {
            var iid = typeof(IAudioClient).GUID;
            device.Activate(ref iid, ClsCtx.InprocServer, IntPtr.Zero, out var activated);
            audioClient = (IAudioClient)activated;
            var hr = audioClient.GetDevicePeriod(out var defaultPeriod, out var minimumPeriod);
            return hr == 0 ? new DevicePeriodReport(ReferenceTimeToMs(defaultPeriod), ReferenceTimeToMs(minimumPeriod)) : null;
        }
        catch
        {
            return null;
        }
        finally
        {
            if (audioClient is not null) ReleaseCom(audioClient);
        }
    }

    static double ReferenceTimeToMs(long referenceTime) => Math.Round(referenceTime / 10000.0, 3);
    static long MsToReferenceTime(int ms) => ms * 10000L;

    static void ReleaseCom(object? instance)
    {
        if (instance is not null && Marshal.IsComObject(instance)) Marshal.ReleaseComObject(instance);
    }

    static void ThrowIfFailed(int hresult, string step)
    {
        if (hresult < 0) Marshal.ThrowExceptionForHR(hresult);
        if (hresult != 0) throw new InvalidOperationException($"{step} returned HRESULT 0x{hresult:X8}.");
    }

    [DllImport("Ole32.dll")]
    static extern int PropVariantClear(ref PropVariant pvar);
}

sealed record EndpointReport(string id, string name, string state, string formFactor, bool isDefaultRender, MixFormatReport? mixFormat, DevicePeriodReport? devicePeriod, string? match);
sealed record MixFormatReport(ushort channels, uint sampleRate, ushort blockAlign, ushort containerBits, ushort validBits, ushort formatTag, uint channelMask, string subFormat);
sealed record DevicePeriodReport(double defaultMs, double minimumMs);
sealed record RenderRouteReport(string selectedEndpoint, string selectedEndpointMatched, string captureEndpointId, string renderEndpointId, bool sameEndpoint, bool preflightSupported, bool candidate, string state, string reason);
sealed record RenderProbeReport(bool supported, bool initialized, bool serviceAvailable, string status, string? error, MixFormatReport? mixFormat, uint bufferFrames, double? streamLatencyMs, string? hresult, bool gated, string reason)
{
    public static RenderProbeReport Failed(string step, int hresult, MixFormatReport? mixFormat = null) =>
        new(false, false, false, $"Failed: {step}", null, mixFormat, 0, null, $"0x{hresult:X8}", true, "Shared render preflight failed; processed render remains unavailable.");
}
sealed record LoopbackProbeReport(bool supported, bool initialized, bool captured, string status, string? error, MixFormatReport? mixFormat, uint bufferFrames, double? streamLatencyMs, int durationMs, uint packets, uint frames, uint silentPackets, uint discontinuities, string? hresult, object? eqProcessing)
{
    public static LoopbackProbeReport Failed(string step, int hresult, MixFormatReport? mixFormat = null) =>
        new(false, false, false, $"Failed: {step}", null, mixFormat, 0, null, 0, 0, 0, 0, 0, $"0x{hresult:X8}", null);
}

sealed record EqBandSpec(string Type, double Frequency, double Q, double GainDb);

sealed class NativeEqSettings
{
    const double GainLimitDb = 12;
    const double HeadroomLimitDb = 18;
    const double HeadroomMarginDb = 1.5;
    public string Schema { get; init; } = "";
    public string Mode { get; init; } = "";
    public IReadOnlyList<EqBandSpec> Bands { get; init; } = Array.Empty<EqBandSpec>();
    public double HeadroomDb { get; init; }

    public static NativeEqSettings? FromEncodedJson(string encoded)
    {
        if (string.IsNullOrWhiteSpace(encoded)) return null;
        try
        {
            var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            var bands = new List<EqBandSpec>();
            var positiveGain = 0.0;
            if (root.TryGetProperty("simple", out var simple) && simple.ValueKind == JsonValueKind.Object)
            {
                AddSimpleBand(bands, simple, "bass", "lowshelf", 100, 0.7, ref positiveGain);
                AddSimpleBand(bands, simple, "presence", "peaking", 1500, 0.7, ref positiveGain);
                AddSimpleBand(bands, simple, "treble", "highshelf", 9000, 0.7, ref positiveGain);
            }
            if (root.TryGetProperty("parametric", out var parametric) && parametric.ValueKind == JsonValueKind.Array)
            {
                foreach (var candidate in parametric.EnumerateArray())
                {
                    if (candidate.ValueKind != JsonValueKind.Object) continue;
                    var frequency = Clamp(ReadDouble(candidate, "frequency", 1000), 20, 20000);
                    var q = Clamp(ReadDouble(candidate, "q", 1), 0.1, 12);
                    var gain = Clamp(ReadDouble(candidate, "gainDb", ReadDouble(candidate, "gain", 0)), -GainLimitDb, GainLimitDb);
                    if (Math.Abs(gain) <= 0.01) continue;
                    positiveGain += Math.Max(0, gain);
                    bands.Add(new EqBandSpec("peaking", frequency, q, gain));
                }
            }
            var headroom = Math.Min(HeadroomLimitDb, positiveGain > 0 ? positiveGain + HeadroomMarginDb : 0);
            return new NativeEqSettings
            {
                Schema = root.TryGetProperty("schema", out var schema) ? schema.GetString() ?? "" : "",
                Mode = root.TryGetProperty("mode", out var mode) ? mode.GetString() ?? "" : "",
                Bands = bands,
                HeadroomDb = headroom
            };
        }
        catch
        {
            return null;
        }
    }

    static void AddSimpleBand(List<EqBandSpec> bands, JsonElement simple, string property, string type, double frequency, double q, ref double positiveGain)
    {
        if (!simple.TryGetProperty(property, out var value)) return;
        var gain = Clamp(ReadDouble(value, 0), -GainLimitDb, GainLimitDb);
        if (Math.Abs(gain) <= 0.01) return;
        positiveGain += Math.Max(0, gain);
        bands.Add(new EqBandSpec(type, frequency, q, gain));
    }

    static double ReadDouble(JsonElement element, string property, double fallback)
    {
        return element.TryGetProperty(property, out var value) ? ReadDouble(value, fallback) : fallback;
    }

    static double ReadDouble(JsonElement value, double fallback)
    {
        return value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number) ? number : fallback;
    }

    static double Clamp(double value, double min, double max) => Math.Max(min, Math.Min(max, value));
}

sealed class NativeEqProcessor
{
    readonly NativeEqSettings settings;
    readonly MixFormatReport format;
    readonly BiquadState[][] stages;
    readonly double masterGain;
    readonly string? unsupportedReason;
    double inputSumSquares;
    double outputSumSquares;
    double inputPeak;
    double outputPeak;
    ulong samplesAnalyzed;
    ulong clippedSamples;

    NativeEqProcessor(NativeEqSettings settings, MixFormatReport format, string? unsupportedReason = null)
    {
        this.settings = settings;
        this.format = format;
        this.unsupportedReason = unsupportedReason;
        masterGain = Math.Pow(10, -settings.HeadroomDb / 20.0);
        CurrentSampleRate.Value = format.sampleRate;
        stages = Enumerable.Range(0, Math.Max(1, (int)format.channels))
            .Select(_ => settings.Bands.Select(BiquadState.Create).ToArray())
            .ToArray();
    }

    public static NativeEqProcessor? TryCreate(NativeEqSettings? settings, MixFormatReport format)
    {
        if (settings is null) return null;
        var isFloat = format.containerBits == 32 && (format.formatTag == 3 || format.subFormat.StartsWith("00000003", StringComparison.OrdinalIgnoreCase));
        return isFloat ? new NativeEqProcessor(settings, format) : new NativeEqProcessor(settings, format, "Only 32-bit float shared mix formats are processed by this dev analyzer.");
    }

    public void Analyze(IntPtr data, uint frames)
    {
        if (unsupportedReason is not null || data == IntPtr.Zero || frames == 0 || format.channels == 0) return;
        var sampleCount = checked((int)(frames * format.channels));
        var samples = new float[sampleCount];
        Marshal.Copy(data, samples, 0, sampleCount);
        for (var index = 0; index < sampleCount; index++)
        {
            var channel = index % format.channels;
            var input = samples[index];
            var output = (double)input;
            foreach (var stage in stages[channel]) output = stage.Process(output);
            output *= masterGain;
            inputSumSquares += input * input;
            outputSumSquares += output * output;
            inputPeak = Math.Max(inputPeak, Math.Abs(input));
            outputPeak = Math.Max(outputPeak, Math.Abs(output));
            if (Math.Abs(output) > 1.0) clippedSamples++;
            samplesAnalyzed++;
        }
    }

    public object Report()
    {
        var inputRms = samplesAnalyzed > 0 ? Math.Sqrt(inputSumSquares / samplesAnalyzed) : 0;
        var outputRms = samplesAnalyzed > 0 ? Math.Sqrt(outputSumSquares / samplesAnalyzed) : 0;
        return new
        {
            formatSupported = unsupportedReason is null,
            reason = unsupportedReason ?? "Captured samples were processed through the native EQ analyzer but not rendered.",
            rendered = false,
            activeFilters = settings.Bands.Count,
            headroomDb = Math.Round(settings.HeadroomDb, 2),
            masterGain = Math.Round(masterGain, 5),
            samplesAnalyzed,
            input = new
            {
                rms = Math.Round(inputRms, 6),
                peak = Math.Round(inputPeak, 6),
                rmsDb = ToDb(inputRms),
                peakDb = ToDb(inputPeak)
            },
            output = new
            {
                rms = Math.Round(outputRms, 6),
                peak = Math.Round(outputPeak, 6),
                rmsDb = ToDb(outputRms),
                peakDb = ToDb(outputPeak),
                clippedSamples
            },
            delta = new
            {
                rmsDb = samplesAnalyzed > 0 && inputRms > 0 && outputRms > 0 ? Math.Round(20 * Math.Log10(outputRms / inputRms), 3) : 0,
                peakDb = inputPeak > 0 && outputPeak > 0 ? Math.Round(20 * Math.Log10(outputPeak / inputPeak), 3) : 0
            }
        };
    }

    static double ToDb(double amplitude) => amplitude > 0 ? Math.Round(20 * Math.Log10(amplitude), 3) : -120;
}

sealed class BiquadState
{
    readonly double b0;
    readonly double b1;
    readonly double b2;
    readonly double a1;
    readonly double a2;
    double z1;
    double z2;

    BiquadState(double b0, double b1, double b2, double a0, double a1, double a2)
    {
        this.b0 = b0 / a0;
        this.b1 = b1 / a0;
        this.b2 = b2 / a0;
        this.a1 = a1 / a0;
        this.a2 = a2 / a0;
    }

    public static BiquadState Create(EqBandSpec band)
    {
        var sampleRate = Math.Max(1, CurrentSampleRate.Value);
        var frequency = Math.Max(20, Math.Min(sampleRate * 0.45, band.Frequency));
        var w0 = 2 * Math.PI * frequency / sampleRate;
        var cos = Math.Cos(w0);
        var sin = Math.Sin(w0);
        var gain = Math.Pow(10, band.GainDb / 40.0);
        if (band.Type == "lowshelf" || band.Type == "highshelf")
        {
            var alpha = sin / Math.Sqrt(2);
            var beta = 2 * Math.Sqrt(gain) * alpha;
            if (band.Type == "lowshelf")
            {
                return new BiquadState(
                    gain * ((gain + 1) - (gain - 1) * cos + beta),
                    2 * gain * ((gain - 1) - (gain + 1) * cos),
                    gain * ((gain + 1) - (gain - 1) * cos - beta),
                    (gain + 1) + (gain - 1) * cos + beta,
                    -2 * ((gain - 1) + (gain + 1) * cos),
                    (gain + 1) + (gain - 1) * cos - beta);
            }
            return new BiquadState(
                gain * ((gain + 1) + (gain - 1) * cos + beta),
                -2 * gain * ((gain - 1) + (gain + 1) * cos),
                gain * ((gain + 1) + (gain - 1) * cos - beta),
                (gain + 1) - (gain - 1) * cos + beta,
                2 * ((gain - 1) - (gain + 1) * cos),
                (gain + 1) - (gain - 1) * cos - beta);
        }
        var q = Math.Max(0.1, band.Q);
        var peakingAlpha = sin / (2 * q);
        return new BiquadState(
            1 + peakingAlpha * gain,
            -2 * cos,
            1 - peakingAlpha * gain,
            1 + peakingAlpha / gain,
            -2 * cos,
            1 - peakingAlpha / gain);
    }

    public double Process(double input)
    {
        var output = b0 * input + z1;
        z1 = b1 * input - a1 * output + z2;
        z2 = b2 * input - a2 * output;
        return output;
    }
}

static class CurrentSampleRate
{
    [ThreadStatic]
    static double value;
    public static double Value
    {
        get => value <= 0 ? 48000 : value;
        set => CurrentSampleRate.value = value;
    }
}

enum EDataFlow
{
    eRender,
    eCapture,
    eAll
}

enum ERole
{
    eConsole,
    eMultimedia,
    eCommunications
}

[Flags]
enum DeviceState : uint
{
    Active = 0x00000001,
    Disabled = 0x00000002,
    NotPresent = 0x00000004,
    Unplugged = 0x00000008
}

enum StorageAccessMode
{
    Read = 0
}

[Flags]
enum ClsCtx : uint
{
    InprocServer = 0x1
}

enum AudioClientShareMode
{
    Shared = 0,
    Exclusive = 1
}

[Flags]
enum AudioClientStreamFlags : uint
{
    None = 0,
    Loopback = 0x00020000,
    NoPersist = 0x00080000
}

[Flags]
enum AudioClientBufferFlags : uint
{
    None = 0,
    DataDiscontinuity = 0x1,
    Silent = 0x2,
    TimestampError = 0x4
}

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
sealed class MMDeviceEnumerator
{
}

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator
{
    [PreserveSig]
    int EnumAudioEndpoints(EDataFlow dataFlow, DeviceState stateMask, [MarshalAs(UnmanagedType.Interface)] out IMMDeviceCollection devices);
    [PreserveSig]
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, [MarshalAs(UnmanagedType.Interface)] out IMMDevice endpoint);
}

[ComImport]
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection
{
    [PreserveSig]
    int GetCount(out uint count);
    [PreserveSig]
    int Item(uint deviceIndex, [MarshalAs(UnmanagedType.Interface)] out IMMDevice device);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice
{
    void Activate(ref Guid iid, ClsCtx clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
    void OpenPropertyStore(StorageAccessMode accessMode, out IPropertyStore properties);
    void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetState(out DeviceState state);
}

[ComImport]
[Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore
{
    void GetCount(out uint propertyCount);
    void GetAt(uint propertyIndex, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropVariant value);
}

[ComImport]
[Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient
{
    [PreserveSig]
    int Initialize(AudioClientShareMode shareMode, AudioClientStreamFlags streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr format, IntPtr audioSessionGuid);
    [PreserveSig]
    int GetBufferSize(out uint bufferSize);
    [PreserveSig]
    int GetStreamLatency(out long latency);
    [PreserveSig]
    int GetCurrentPadding(out uint currentPadding);
    [PreserveSig]
    int IsFormatSupported(AudioClientShareMode shareMode, IntPtr format, out IntPtr closestMatch);
    [PreserveSig]
    int GetMixFormat(out IntPtr format);
    [PreserveSig]
    int GetDevicePeriod(out long defaultDevicePeriod, out long minimumDevicePeriod);
    [PreserveSig]
    int Start();
    [PreserveSig]
    int Stop();
    [PreserveSig]
    int Reset();
    [PreserveSig]
    int SetEventHandle(IntPtr eventHandle);
    [PreserveSig]
    int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}

[ComImport]
[Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient
{
    void GetBuffer(out IntPtr data, out uint numFramesToRead, out AudioClientBufferFlags flags, out ulong devicePosition, out ulong qpcPosition);
    void ReleaseBuffer(uint numFramesRead);
    void GetNextPacketSize(out uint numFramesInNextPacket);
}

[ComImport]
[Guid("F294ACFC-3146-4483-A7BF-ADDCA7C260E2")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioRenderClient
{
    void GetBuffer(uint numFramesRequested, out IntPtr data);
    void ReleaseBuffer(uint numFramesWritten, AudioClientBufferFlags flags);
}

[StructLayout(LayoutKind.Sequential)]
struct PropertyKey
{
    public Guid fmtid;
    public uint pid;
}

static class PropertyKeys
{
    public static PropertyKey DeviceFriendlyName = new() { fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), pid = 14 };
    public static PropertyKey EndpointFormFactor = new() { fmtid = new Guid("1DA5D803-D492-4EDD-8C23-E0C0FFEE7F0E"), pid = 0 };
}

[StructLayout(LayoutKind.Sequential)]
struct PropVariant
{
    ushort vt;
    ushort wReserved1;
    ushort wReserved2;
    ushort wReserved3;
    IntPtr p;
    int p2;

    public string AsString()
    {
        return vt == 31 && p != IntPtr.Zero ? Marshal.PtrToStringUni(p) ?? "" : "";
    }

    public string AsDisplayValue()
    {
        if (vt == 31 && p != IntPtr.Zero) return Marshal.PtrToStringUni(p) ?? "";
        if (vt == 19) return ((uint)p.ToInt64()).ToString();
        return "";
    }
}

[StructLayout(LayoutKind.Sequential, Pack = 2)]
struct WaveFormatEx
{
    public ushort wFormatTag;
    public ushort nChannels;
    public uint nSamplesPerSec;
    public uint nAvgBytesPerSec;
    public ushort nBlockAlign;
    public ushort wBitsPerSample;
    public ushort cbSize;
}

[StructLayout(LayoutKind.Sequential, Pack = 2)]
struct SamplesUnion
{
    public ushort wValidBitsPerSample;
}

[StructLayout(LayoutKind.Sequential, Pack = 2)]
struct WaveFormatExtensible
{
    public WaveFormatEx Format;
    public SamplesUnion Samples;
    public uint dwChannelMask;
    public Guid SubFormat;
}
