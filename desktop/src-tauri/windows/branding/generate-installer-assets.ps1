Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$outputDir = $PSScriptRoot
$srcTauriDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$iconPath = Join-Path $srcTauriDir "icons/icon.png"

if (-not (Test-Path $iconPath)) {
    throw "Brand icon not found at $iconPath"
}

$brandIcon = [System.Drawing.Image]::FromFile($iconPath)

function New-Color([int] $r, [int] $g, [int] $b, [int] $a = 255) {
    return [System.Drawing.Color]::FromArgb($a, $r, $g, $b)
}

$palette = @{
    BackgroundTop = New-Color 6 8 13
    BackgroundBottom = New-Color 5 8 14
    AccentPrimary = New-Color 34 211 238
    AccentSecondary = New-Color 20 184 166
    PanelBorder = New-Color 255 255 255 24
    PanelFill = New-Color 10 15 24 220
    TextPrimary = New-Color 246 252 255
    TextMuted = New-Color 165 180 200
    Grid = New-Color 255 255 255 14
    Shadow = New-Color 0 0 0 56
}

function New-Font([string] $family, [float] $size, [System.Drawing.FontStyle] $style = [System.Drawing.FontStyle]::Regular) {
    return New-Object System.Drawing.Font($family, $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}

$fonts = @{
    Eyebrow = New-Font "Segoe UI" 11 ([System.Drawing.FontStyle]::Bold)
    Header = New-Font "Segoe UI" 20 ([System.Drawing.FontStyle]::Bold)
    HeaderCompact = New-Font "Segoe UI" 14 ([System.Drawing.FontStyle]::Bold)
    BannerTitle = New-Font "Segoe UI" 18 ([System.Drawing.FontStyle]::Bold)
    BannerSubtitle = New-Font "Segoe UI" 9 ([System.Drawing.FontStyle]::Regular)
    Title = New-Font "Segoe UI" 34 ([System.Drawing.FontStyle]::Bold)
    HeroTitle = New-Font "Segoe UI" 24 ([System.Drawing.FontStyle]::Bold)
    HeroBody = New-Font "Segoe UI" 12 ([System.Drawing.FontStyle]::Regular)
    Subtitle = New-Font "Segoe UI" 15 ([System.Drawing.FontStyle]::Regular)
    SidebarTitle = New-Font "Segoe UI" 20 ([System.Drawing.FontStyle]::Bold)
    SidebarBody = New-Font "Segoe UI" 12 ([System.Drawing.FontStyle]::Regular)
    Small = New-Font "Segoe UI" 10 ([System.Drawing.FontStyle]::Regular)
}

function Set-GraphicsQuality([System.Drawing.Graphics] $graphics) {
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
}

function New-RoundedRectanglePath([float] $x, [float] $y, [float] $width, [float] $height, [float] $radius) {
    $diameter = $radius * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $diameter, $diameter, 180, 90)
    $path.AddArc($x + $width - $diameter, $y, $diameter, $diameter, 270, 90)
    $path.AddArc($x + $width - $diameter, $y + $height - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($x, $y + $height - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function Draw-Glow([System.Drawing.Graphics] $graphics, [float] $x, [float] $y, [float] $width, [float] $height, [System.Drawing.Color] $centerColor) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddEllipse($x, $y, $width, $height)
    $brush = New-Object System.Drawing.Drawing2D.PathGradientBrush($path)
    $brush.CenterColor = $centerColor
    $brush.SurroundColors = @([System.Drawing.Color]::FromArgb(0, $centerColor))
    $graphics.FillEllipse($brush, $x, $y, $width, $height)
    $brush.Dispose()
    $path.Dispose()
}

function Draw-Background([System.Drawing.Graphics] $graphics, [int] $width, [int] $height) {
    $rect = New-Object System.Drawing.Rectangle 0, 0, $width, $height
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        $palette.BackgroundTop,
        $palette.BackgroundBottom,
        90
    )
    $graphics.FillRectangle($brush, $rect)
    $brush.Dispose()

    Draw-Glow $graphics (-0.12 * $width) (-0.18 * $height) (0.72 * $width) (0.62 * $height) ([System.Drawing.Color]::FromArgb(72, $palette.AccentPrimary))
    Draw-Glow $graphics (0.48 * $width) (0.08 * $height) (0.46 * $width) (0.52 * $height) ([System.Drawing.Color]::FromArgb(44, $palette.AccentSecondary))
    Draw-Glow $graphics (0.58 * $width) (0.58 * $height) (0.42 * $width) (0.34 * $height) ([System.Drawing.Color]::FromArgb(20, $palette.AccentPrimary))

    $gridPen = New-Object System.Drawing.Pen($palette.Grid, 1)
    for ($x = 0; $x -lt $width; $x += 26) {
        $graphics.DrawLine($gridPen, $x, 0, $x, $height)
    }
    for ($y = 0; $y -lt $height; $y += 26) {
        $graphics.DrawLine($gridPen, 0, $y, $width, $y)
    }
    $gridPen.Dispose()
}

function Draw-LogoTile([System.Drawing.Graphics] $graphics, [float] $x, [float] $y, [float] $size) {
    $shadowPath = New-RoundedRectanglePath ($x + 3) ($y + 6) $size $size 22
    $shadowBrush = New-Object System.Drawing.SolidBrush($palette.Shadow)
    $graphics.FillPath($shadowBrush, $shadowPath)
    $shadowBrush.Dispose()
    $shadowPath.Dispose()

    $tilePath = New-RoundedRectanglePath $x $y $size $size 22
    $tileRect = New-Object System.Drawing.RectangleF $x, $y, $size, $size
    $tileBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $tileRect,
        [System.Drawing.Color]::FromArgb(245, 18, 28, 42),
        [System.Drawing.Color]::FromArgb(245, 8, 12, 18),
        135
    )
    $graphics.FillPath($tileBrush, $tilePath)
    $tileBrush.Dispose()

    $accentBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $tileRect,
        [System.Drawing.Color]::FromArgb(80, $palette.AccentPrimary),
        [System.Drawing.Color]::FromArgb(16, $palette.AccentSecondary),
        45
    )
    $graphics.FillEllipse($accentBrush, $x + ($size * 0.12), $y + ($size * 0.08), $size * 0.76, $size * 0.42)
    $accentBrush.Dispose()

    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(62, 255, 255, 255), 1.6)
    $graphics.DrawPath($borderPen, $tilePath)
    $borderPen.Dispose()
    $tilePath.Dispose()

    $graphics.DrawImage($brandIcon, $x + ($size * 0.11), $y + ($size * 0.11), $size * 0.78, $size * 0.78)
}

function Draw-TextBlock(
    [System.Drawing.Graphics] $graphics,
    [string] $eyebrow,
    [string] $title,
    [string] $subtitle,
    [float] $x,
    [float] $y,
    [float] $width,
    [bool] $compact = $false
) {
    $eyebrowBrush = New-Object System.Drawing.SolidBrush($palette.AccentPrimary)
    $titleBrush = New-Object System.Drawing.SolidBrush($palette.TextPrimary)
    $subtitleBrush = New-Object System.Drawing.SolidBrush($palette.TextMuted)

    $eyebrowRect = New-Object System.Drawing.RectangleF $x, $y, $width, 20
    $titleRect = New-Object System.Drawing.RectangleF $x, ($y + 20), $width, ($(if ($compact) { 30 } else { 98 }))
    $subtitleRect = New-Object System.Drawing.RectangleF $x, ($(if ($compact) { $y + 44 } else { $y + 120 })), $width, ($(if ($compact) { 34 } else { 86 }))

    $stringFormat = New-Object System.Drawing.StringFormat
    $stringFormat.Trimming = [System.Drawing.StringTrimming]::EllipsisWord

    if ($compact) {
        $graphics.DrawString($eyebrow, $fonts.Small, $eyebrowBrush, $eyebrowRect, $stringFormat)
        $graphics.DrawString($title, $fonts.Header, $titleBrush, $titleRect, $stringFormat)
        $graphics.DrawString($subtitle, $fonts.Small, $subtitleBrush, $subtitleRect, $stringFormat)
    }
    else {
        $graphics.DrawString($eyebrow, $fonts.Eyebrow, $eyebrowBrush, $eyebrowRect, $stringFormat)
        $graphics.DrawString($title, $fonts.Title, $titleBrush, $titleRect, $stringFormat)
        $graphics.DrawString($subtitle, $fonts.Subtitle, $subtitleBrush, $subtitleRect, $stringFormat)
    }

    $stringFormat.Dispose()
    $eyebrowBrush.Dispose()
    $titleBrush.Dispose()
    $subtitleBrush.Dispose()
}

function Save-Bitmap([string] $path, [int] $width, [int] $height, [scriptblock] $drawer) {
    $bitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        Set-GraphicsQuality $graphics
        & $drawer $graphics $width $height
        $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Write-NsisHeader {
    $path = Join-Path $outputDir "nsis-header.bmp"
    Save-Bitmap $path 150 57 {
        param($graphics, $width, $height)
        Draw-Background $graphics $width $height
        Draw-LogoTile $graphics 8 8 38

        $titleBrush = New-Object System.Drawing.SolidBrush($palette.TextPrimary)
        $accentBrush = New-Object System.Drawing.SolidBrush($palette.AccentPrimary)
        $titleFormat = New-Object System.Drawing.StringFormat
        $titleRect = New-Object System.Drawing.RectangleF 53, 17, 88, 22
        $graphics.DrawString("Singra Vox", $fonts.HeaderCompact, $titleBrush, $titleRect, $titleFormat)
        $graphics.FillRectangle($accentBrush, 54, 40, 56, 2)
        $titleBrush.Dispose()
        $accentBrush.Dispose()
        $titleFormat.Dispose()
    }
}

function Write-NsisSidebar {
    $path = Join-Path $outputDir "nsis-sidebar.bmp"
    Save-Bitmap $path 164 314 {
        param($graphics, $width, $height)
        Draw-Background $graphics $width $height

        $panelPath = New-RoundedRectanglePath 12 14 140 286 24
        $panelBrush = New-Object System.Drawing.SolidBrush($palette.PanelFill)
        $borderPen = New-Object System.Drawing.Pen($palette.PanelBorder, 1.2)
        $graphics.FillPath($panelBrush, $panelPath)
        $graphics.DrawPath($borderPen, $panelPath)
        $panelBrush.Dispose()
        $borderPen.Dispose()
        $panelPath.Dispose()

        Draw-LogoTile $graphics 34 30 96
        Draw-TextBlock $graphics "PRIVACY-FIRST" "Singra Vox" "Open source chat, voice and encrypted channels for self-hosted communities." 24 146 114 $true

        $footerBrush = New-Object System.Drawing.SolidBrush($palette.TextMuted)
        $footerRect = New-Object System.Drawing.RectangleF 24, 245, 116, 46
        $footerFormat = New-Object System.Drawing.StringFormat
        $graphics.DrawString("Desktop client by Maik Haedrich", $fonts.Small, $footerBrush, $footerRect, $footerFormat)
        $footerBrush.Dispose()
        $footerFormat.Dispose()
    }
}

function Write-WixBanner {
    $path = Join-Path $outputDir "wix-banner.bmp"
    Save-Bitmap $path 493 58 {
        param($graphics, $width, $height)
        Draw-Background $graphics $width $height
        Draw-LogoTile $graphics 16 8 42

        $titleBrush = New-Object System.Drawing.SolidBrush($palette.TextPrimary)
        $subtitleBrush = New-Object System.Drawing.SolidBrush($palette.TextMuted)
        $accentBrush = New-Object System.Drawing.SolidBrush($palette.AccentPrimary)
        $format = New-Object System.Drawing.StringFormat
        $graphics.DrawString("Singra Vox", $fonts.BannerTitle, $titleBrush, (New-Object System.Drawing.RectangleF 74, 10, 170, 24), $format)
        $graphics.DrawString("Open source desktop client", $fonts.BannerSubtitle, $subtitleBrush, (New-Object System.Drawing.RectangleF 74, 31, 160, 16), $format)

        $lineBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            (New-Object System.Drawing.Rectangle 366, 24, 98, 8),
            [System.Drawing.Color]::FromArgb(0, $palette.AccentPrimary),
            [System.Drawing.Color]::FromArgb(200, $palette.AccentPrimary),
            0
        )
        $graphics.FillRectangle($lineBrush, 366, 27, 105, 3)
        $lineBrush.Dispose()
        $graphics.FillRectangle($accentBrush, 74, 43, 120, 2)

        $titleBrush.Dispose()
        $subtitleBrush.Dispose()
        $accentBrush.Dispose()
        $format.Dispose()
    }
}

function Write-WixDialog {
    $path = Join-Path $outputDir "wix-dialog.bmp"
    Save-Bitmap $path 493 312 {
        param($graphics, $width, $height)
        Draw-Background $graphics $width $height

        $leftPanelPath = New-RoundedRectanglePath 22 24 255 264 28
        $panelBrush = New-Object System.Drawing.SolidBrush($palette.PanelFill)
        $borderPen = New-Object System.Drawing.Pen($palette.PanelBorder, 1.4)
        $graphics.FillPath($panelBrush, $leftPanelPath)
        $graphics.DrawPath($borderPen, $leftPanelPath)
        $panelBrush.Dispose()
        $borderPen.Dispose()
        $leftPanelPath.Dispose()

        $eyebrowBrush = New-Object System.Drawing.SolidBrush($palette.AccentPrimary)
        $titleBrush = New-Object System.Drawing.SolidBrush($palette.TextPrimary)
        $bodyBrush = New-Object System.Drawing.SolidBrush($palette.TextMuted)
        $textFormat = New-Object System.Drawing.StringFormat
        $graphics.DrawString("SINGRA VOX", $fonts.Small, $eyebrowBrush, (New-Object System.Drawing.RectangleF 42, 48, 180, 16), $textFormat)
        $graphics.DrawString("Privacy-first chat and voice", $fonts.HeroTitle, $titleBrush, (New-Object System.Drawing.RectangleF 42, 74, 206, 64), $textFormat)
        $graphics.DrawString("Self-hosted chat, LiveKit voice, screen sharing and encrypted channels.", $fonts.HeroBody, $bodyBrush, (New-Object System.Drawing.RectangleF 42, 146, 198, 54), $textFormat)

        $detailBrush = New-Object System.Drawing.SolidBrush($palette.TextMuted)
        $detailRect = New-Object System.Drawing.RectangleF 42, 236, 204, 24
        $detailFormat = New-Object System.Drawing.StringFormat
        $graphics.DrawString("Maintained by Maik Haedrich", $fonts.Small, $detailBrush, $detailRect, $detailFormat)
        $detailBrush.Dispose()
        $detailFormat.Dispose()
        $eyebrowBrush.Dispose()
        $titleBrush.Dispose()
        $bodyBrush.Dispose()
        $textFormat.Dispose()

        Draw-Glow $graphics 290 24 180 180 ([System.Drawing.Color]::FromArgb(85, $palette.AccentPrimary))
        Draw-Glow $graphics 322 146 126 118 ([System.Drawing.Color]::FromArgb(56, $palette.AccentSecondary))
        Draw-LogoTile $graphics 320 72 124

        $captionBrush = New-Object System.Drawing.SolidBrush($palette.TextPrimary)
        $captionFormat = New-Object System.Drawing.StringFormat
        $captionFormat.Alignment = [System.Drawing.StringAlignment]::Center
        $captionRect = New-Object System.Drawing.RectangleF 290, 226, 180, 28
        $graphics.DrawString("Singra Vox", $fonts.SidebarTitle, $captionBrush, $captionRect, $captionFormat)
        $captionBrush.Dispose()
        $captionFormat.Dispose()

        $subBrush = New-Object System.Drawing.SolidBrush($palette.TextMuted)
        $subFormat = New-Object System.Drawing.StringFormat
        $subFormat.Alignment = [System.Drawing.StringAlignment]::Center
        $subRect = New-Object System.Drawing.RectangleF 300, 258, 160, 34
        $graphics.DrawString("Open source desktop", $fonts.Small, $subBrush, $subRect, $subFormat)
        $subBrush.Dispose()
        $subFormat.Dispose()
    }
}

Write-NsisHeader
Write-NsisSidebar
Write-WixBanner
Write-WixDialog

$brandIcon.Dispose()

Write-Output "Installer branding assets generated in $outputDir"
