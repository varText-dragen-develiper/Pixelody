# Raises a hosted Windows CI desktop to 1920x1080. Hosted runners start at
# 1024x768, and Windows will not size a window beyond the desktop, while the
# Singularity scenarios assert a 1440x800 window and the narrow layout asks
# for 1050 px. Fails with the measured size if the desktop stays too small.
$ErrorActionPreference = 'Stop'

if (Get-Command Set-DisplayResolution -ErrorAction SilentlyContinue) {
  Set-DisplayResolution -Width 1920 -Height 1080 -Force
} else {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class PixelodyDisplay {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion; public short dmDriverVersion; public short dmSize; public short dmDriverExtra;
    public int dmFields; public int dmPositionX; public int dmPositionY; public int dmDisplayOrientation; public int dmDisplayFixedOutput;
    public short dmColor; public short dmDuplex; public short dmYResolution; public short dmTTOption; public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels; public int dmBitsPerPel; public int dmPelsWidth; public int dmPelsHeight;
    public int dmDisplayFlags; public int dmDisplayFrequency; public int dmICMMethod; public int dmICMIntent;
    public int dmMediaType; public int dmDitherType; public int dmReserved1; public int dmReserved2;
    public int dmPanningWidth; public int dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet = CharSet.Ansi)] static extern bool EnumDisplaySettings(string device, int mode, ref DEVMODE devMode);
  [DllImport("user32.dll", CharSet = CharSet.Ansi)] static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);
  public static int Set(int width, int height) {
    var mode = new DEVMODE();
    mode.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
    if (!EnumDisplaySettings(null, -1, ref mode)) return -1;
    mode.dmPelsWidth = width;
    mode.dmPelsHeight = height;
    mode.dmFields = 0x80000 | 0x100000;
    return ChangeDisplaySettings(ref mode, 0);
  }
}
'@
  $result = [PixelodyDisplay]::Set(1920, 1080)
  if ($result -ne 0) { throw "ChangeDisplaySettings returned $result." }
}

Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
"Windows desktop: $($bounds.Width)x$($bounds.Height)"
if ($bounds.Width -lt 1440 -or $bounds.Height -lt 900) {
  throw "Desktop is $($bounds.Width)x$($bounds.Height); sized scenarios need at least 1440x900."
}
