using System.Runtime.InteropServices;

sealed record MixFormatInfo(ushort channels, uint sampleRate, ushort blockAlign, ushort containerBits, ushort validBits, ushort formatTag, uint channelMask, string subFormat);
sealed record EndpointInfo(string id, string name, string state, MixFormatInfo format, double? defaultPeriodMs, double? minimumPeriodMs);

static class Wasapi
{
    public static readonly Guid CaptureClientGuid = typeof(IAudioCaptureClient).GUID;
    public static readonly Guid RenderClientGuid = typeof(IAudioRenderClient).GUID;
    public static readonly Guid AudioClockGuid = typeof(IAudioClock).GUID;

    public static IReadOnlyList<EndpointInfo> ListActiveRenderEndpoints()
        => ListActiveEndpoints(EDataFlow.eRender);

    public static IReadOnlyList<EndpointInfo> ListActiveCaptureEndpoints()
        => ListActiveEndpoints(EDataFlow.eCapture);

    static IReadOnlyList<EndpointInfo> ListActiveEndpoints(EDataFlow dataFlow)
    {
        IMMDeviceEnumerator? enumerator = null;
        IMMDeviceCollection? collection = null;
        var endpoints = new List<EndpointInfo>();
        try
        {
            enumerator = CreateEnumerator();
            ThrowIfFailed(enumerator.EnumAudioEndpoints(dataFlow, DeviceState.Active, out collection), "EnumAudioEndpoints");
            ThrowIfFailed(collection.GetCount(out var count), "GetCount");
            for (uint index = 0; index < count; index++)
            {
                ThrowIfFailed(collection.Item(index, out var endpoint), "Item");
                try { endpoints.Add(ReadEndpoint(endpoint)); }
                finally { Release(endpoint); }
            }
            return endpoints;
        }
        finally
        {
            Release(collection);
            Release(enumerator);
        }
    }

    public static EndpointInfo GetRenderEndpoint(string endpointId)
        => GetActiveEndpoint(endpointId);

    public static EndpointInfo GetCaptureEndpoint(string endpointId)
        => GetActiveEndpoint(endpointId);

    static EndpointInfo GetActiveEndpoint(string endpointId)
    {
        IMMDeviceEnumerator? enumerator = null;
        IMMDevice? endpoint = null;
        try
        {
            enumerator = CreateEnumerator();
            ThrowIfFailed(enumerator.GetDevice(endpointId, out endpoint), "GetDevice");
            endpoint.GetState(out var state);
            if (!state.HasFlag(DeviceState.Active)) throw new InvalidOperationException("Selected endpoint is not active.");
            return ReadEndpoint(endpoint);
        }
        finally
        {
            Release(endpoint);
            Release(enumerator);
        }
    }

    public static IAudioClient OpenAudioClient(string endpointId)
    {
        IMMDeviceEnumerator? enumerator = null;
        IMMDevice? endpoint = null;
        try
        {
            enumerator = CreateEnumerator();
            ThrowIfFailed(enumerator.GetDevice(endpointId, out endpoint), "GetDevice");
            var iid = typeof(IAudioClient).GUID;
            endpoint.Activate(ref iid, ClsCtx.InprocServer, IntPtr.Zero, out var service);
            return (IAudioClient)service;
        }
        finally
        {
            Release(endpoint);
            Release(enumerator);
        }
    }

    public static IAudioClock GetAudioClock(IAudioClient client)
    {
        var iid = AudioClockGuid;
        ThrowIfFailed(client.GetService(ref iid, out var service), "GetService IAudioClock");
        return (IAudioClock)service;
    }

    public static bool IsPixelodyVirtual(string name) => name.Contains("Pixelody Virtual", StringComparison.OrdinalIgnoreCase);
    public static bool FormatsMatch(MixFormatInfo left, MixFormatInfo right) => left.channels == right.channels && left.sampleRate == right.sampleRate && left.blockAlign == right.blockAlign && left.containerBits == right.containerBits && left.formatTag == right.formatTag && string.Equals(left.subFormat, right.subFormat, StringComparison.OrdinalIgnoreCase);
    public static double ReferenceTimeToMs(long referenceTime) => Math.Round(referenceTime / 10000.0, 3);
    public static long MsToReferenceTime(int milliseconds) => milliseconds * 10000L;
    public static void ThrowIfFailed(int hresult, string step)
    {
        if (hresult < 0) Marshal.ThrowExceptionForHR(hresult);
        if (hresult != 0) throw new InvalidOperationException($"{step} returned HRESULT 0x{hresult:X8}.");
    }
    public static void Copy(IntPtr source, IntPtr target, int bytes)
    {
        var buffer = new byte[bytes];
        Marshal.Copy(source, buffer, 0, bytes);
        Marshal.Copy(buffer, 0, target, bytes);
    }
    public static void Clear(IntPtr target, int bytes) => Marshal.Copy(new byte[bytes], 0, target, bytes);
    public static void Release(object? value)
    {
        if (value is not null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value);
    }

    static IMMDeviceEnumerator CreateEnumerator()
    {
        var type = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"))
            ?? throw new InvalidOperationException("MMDeviceEnumerator COM class is unavailable.");
        return (IMMDeviceEnumerator)(Activator.CreateInstance(type)
            ?? throw new InvalidOperationException("Could not create MMDeviceEnumerator."));
    }

    static EndpointInfo ReadEndpoint(IMMDevice endpoint)
    {
        endpoint.GetId(out var id);
        endpoint.GetState(out var state);
        endpoint.OpenPropertyStore(StorageAccessMode.Read, out var store);
        var name = ReadString(store, PropertyKeys.DeviceFriendlyName);
        Release(store);
        var client = ActivateClient(endpoint);
        IntPtr formatPointer = IntPtr.Zero;
        try
        {
            ThrowIfFailed(client.GetMixFormat(out formatPointer), "GetMixFormat");
            ThrowIfFailed(client.GetDevicePeriod(out var defaultPeriod, out var minimumPeriod), "GetDevicePeriod");
            return new EndpointInfo(id, string.IsNullOrWhiteSpace(name) ? "Audio endpoint" : name, state.ToString(), ReadFormat(formatPointer), ReferenceTimeToMs(defaultPeriod), ReferenceTimeToMs(minimumPeriod));
        }
        finally
        {
            Release(client);
            if (formatPointer != IntPtr.Zero) Marshal.FreeCoTaskMem(formatPointer);
        }
    }

    static IAudioClient ActivateClient(IMMDevice endpoint)
    {
        var iid = typeof(IAudioClient).GUID;
        endpoint.Activate(ref iid, ClsCtx.InprocServer, IntPtr.Zero, out var service);
        return (IAudioClient)service;
    }

    static string ReadString(IPropertyStore store, PropertyKey key)
    {
        PropVariant value = default;
        try { store.GetValue(ref key, out value); return value.AsString(); }
        finally { PropVariantClear(ref value); }
    }

    public static MixFormatInfo ReadFormat(IntPtr formatPointer)
    {
        var format = Marshal.PtrToStructure<WaveFormatEx>(formatPointer);
        ushort validBits = format.wBitsPerSample;
        uint channelMask = 0;
        var subFormat = "";
        if (format.wFormatTag == 0xFFFE && format.cbSize >= 22)
        {
            var extensible = Marshal.PtrToStructure<WaveFormatExtensible>(formatPointer);
            validBits = extensible.Samples.wValidBitsPerSample;
            channelMask = extensible.dwChannelMask;
            subFormat = extensible.SubFormat.ToString();
        }
        return new MixFormatInfo(format.nChannels, format.nSamplesPerSec, format.nBlockAlign, format.wBitsPerSample, validBits, format.wFormatTag, channelMask, subFormat);
    }

    [DllImport("Ole32.dll")]
    static extern int PropVariantClear(ref PropVariant pvar);
}

enum EDataFlow { eRender, eCapture, eAll }
enum ERole { eConsole, eMultimedia, eCommunications }
[Flags] enum DeviceState : uint { Active = 0x00000001, Disabled = 0x00000002, NotPresent = 0x00000004, Unplugged = 0x00000008 }
enum StorageAccessMode { Read = 0 }
[Flags] enum ClsCtx : uint { InprocServer = 0x1 }
enum AudioClientShareMode { Shared = 0, Exclusive = 1 }
[Flags] enum AudioClientStreamFlags : uint { None = 0, Loopback = 0x00020000, NoPersist = 0x00080000 }
[Flags] enum AudioClientBufferFlags : uint { None = 0, DataDiscontinuity = 0x1, Silent = 0x2, TimestampError = 0x4 }

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
sealed class MMDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(EDataFlow dataFlow, DeviceState stateMask, out IMMDeviceCollection devices);
    [PreserveSig] int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice endpoint);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice endpoint);
}

[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection
{
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int Item(uint deviceIndex, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice
{
    void Activate(ref Guid iid, ClsCtx clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
    void OpenPropertyStore(StorageAccessMode accessMode, out IPropertyStore properties);
    void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetState(out DeviceState state);
}

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore
{
    void GetCount(out uint propertyCount);
    void GetAt(uint propertyIndex, out PropertyKey key);
    void GetValue(ref PropertyKey key, out PropVariant value);
}

[ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient
{
    [PreserveSig] int Initialize(AudioClientShareMode shareMode, AudioClientStreamFlags streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr format, IntPtr audioSessionGuid);
    [PreserveSig] int GetBufferSize(out uint bufferSize);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint currentPadding);
    [PreserveSig] int IsFormatSupported(AudioClientShareMode shareMode, IntPtr format, out IntPtr closestMatch);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long defaultDevicePeriod, out long minimumDevicePeriod);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr eventHandle);
    [PreserveSig] int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}

[ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient
{
    void GetBuffer(out IntPtr data, out uint numFramesToRead, out AudioClientBufferFlags flags, out ulong devicePosition, out ulong qpcPosition);
    void ReleaseBuffer(uint numFramesRead);
    void GetNextPacketSize(out uint numFramesInNextPacket);
}

[ComImport, Guid("F294ACFC-3146-4483-A7BF-ADDCA7C260E2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioRenderClient
{
    void GetBuffer(uint numFramesRequested, out IntPtr data);
    void ReleaseBuffer(uint numFramesWritten, AudioClientBufferFlags flags);
}

[ComImport, Guid("CD63314F-3FBA-4A1B-812C-EF96358728E7"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClock
{
    [PreserveSig] int GetFrequency(out ulong frequency);
    [PreserveSig] int GetPosition(out ulong devicePosition, out ulong qpcPosition);
    [PreserveSig] int GetCharacteristics(out uint characteristics);
}

[StructLayout(LayoutKind.Sequential)] struct PropertyKey { public Guid fmtid; public uint pid; }
static class PropertyKeys { public static PropertyKey DeviceFriendlyName = new() { fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), pid = 14 }; }
[StructLayout(LayoutKind.Sequential)] struct PropVariant
{
    ushort vt; ushort wReserved1; ushort wReserved2; ushort wReserved3; IntPtr p; int p2;
    public string AsString() => vt == 31 && p != IntPtr.Zero ? Marshal.PtrToStringUni(p) ?? "" : "";
}
[StructLayout(LayoutKind.Sequential, Pack = 2)] struct WaveFormatEx { public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize; }
[StructLayout(LayoutKind.Sequential, Pack = 2)] struct SamplesUnion { public ushort wValidBitsPerSample; }
[StructLayout(LayoutKind.Sequential, Pack = 2)] struct WaveFormatExtensible { public WaveFormatEx Format; public SamplesUnion Samples; public uint dwChannelMask; public Guid SubFormat; }
