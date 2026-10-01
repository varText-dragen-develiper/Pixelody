$ErrorActionPreference = 'Stop'
# Rasterizes build\icon.svg into build\icon.png with System.Drawing.
# build\icon.svg is written by tools\brand\generate_brand_assets.py and holds
# one rounded tile plus one path made only of absolute M/L/Z polygons, so it
# can be drawn here without an SVG renderer. On machines with Node and
# Playwright, tools\brand\render_brand_pngs.js produces the same PNG.
Add-Type -AssemblyName System.Drawing
$project = Split-Path -Parent $PSScriptRoot
$source = Join-Path $project 'build\icon.svg'
$output = Join-Path $project 'build\icon.png'
$svg = [xml](Get-Content -Raw -LiteralPath $source)
$ns = @{ s = 'http://www.w3.org/2000/svg' }
$tile = (Select-Xml -Xml $svg -XPath '//s:rect' -Namespace $ns).Node
$mark = (Select-Xml -Xml $svg -XPath '//s:path' -Namespace $ns).Node
if (-not $tile -or -not $mark) { throw "Unexpected icon.svg layout: $source" }
if ($mark.d -match '[^MLZ0-9.,\-\s]') { throw 'icon.svg path must contain only absolute M/L/Z commands.' }

$size = 512
$scale = $size / 24.0
$culture = [Globalization.CultureInfo]::InvariantCulture
function ConvertTo-Color([string]$hex) { [Drawing.ColorTranslator]::FromHtml($hex) }

$bitmap = [Drawing.Bitmap]::new($size, $size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $graphics.Clear([Drawing.Color]::Transparent)

  $radius = [double]::Parse($tile.rx, $culture) * $scale
  $tilePath = [Drawing.Drawing2D.GraphicsPath]::new()
  $d = 2 * $radius
  $tilePath.AddArc(0, 0, $d, $d, 180, 90)
  $tilePath.AddArc($size - $d, 0, $d, $d, 270, 90)
  $tilePath.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $tilePath.AddArc(0, $size - $d, $d, $d, 90, 90)
  $tilePath.CloseFigure()
  $tileBrush = [Drawing.SolidBrush]::new((ConvertTo-Color $tile.fill))
  $graphics.FillPath($tileBrush, $tilePath)

  $markPath = [Drawing.Drawing2D.GraphicsPath]::new([Drawing.Drawing2D.FillMode]::Alternate)
  foreach ($figure in ($mark.d -split 'Z' | Where-Object { $_.Trim() })) {
    $points = foreach ($pair in ($figure.TrimStart('M') -split 'L')) {
      $xy = $pair.Split(',')
      [Drawing.PointF]::new([single]([double]::Parse($xy[0], $culture) * $scale), [single]([double]::Parse($xy[1], $culture) * $scale))
    }
    $markPath.AddPolygon([Drawing.PointF[]]$points)
  }
  $markBrush = [Drawing.SolidBrush]::new((ConvertTo-Color $mark.fill))
  $graphics.FillPath($markBrush, $markPath)

  $bitmap.Save($output, [Drawing.Imaging.ImageFormat]::Png)
  $tileBrush.Dispose(); $markBrush.Dispose(); $tilePath.Dispose(); $markPath.Dispose()
} finally { $graphics.Dispose(); $bitmap.Dispose() }
Write-Host "Generated $output from build\icon.svg."
