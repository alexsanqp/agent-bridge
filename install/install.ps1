$ErrorActionPreference = 'Stop'

$repo = 'alexsanqp/agent-bridge'
$binaryName = 'agent-bridge.exe'
$installDir = Join-Path $env:LOCALAPPDATA 'agent-bridge'
$githubApi = "https://api.github.com/repos/$repo/releases/latest"

# --- Output helpers ---
function Write-Info    { param($msg) Write-Host "info  " -ForegroundColor Cyan -NoNewline; Write-Host $msg }
function Write-Ok      { param($msg) Write-Host "ok    " -ForegroundColor Green -NoNewline; Write-Host $msg }
function Write-Warn    { param($msg) Write-Host "warn  " -ForegroundColor Yellow -NoNewline; Write-Host $msg }
function Write-Err     { param($msg) Write-Host "error " -ForegroundColor Red -NoNewline; Write-Host $msg; exit 1 }

# --- Main ---
function Install-AgentBridge {
    Write-Host ""
    Write-Host "Agent Bridge Installer" -ForegroundColor White -NoNewline
    Write-Host ""
    Write-Host "Peer collaboration bridge for AI coding agents"
    Write-Host ""

    # Check Windows architecture
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -ne 'AMD64' -and $arch -ne 'x86') {
        Write-Err "Unsupported architecture: $arch. Only x64 (AMD64) is supported."
    }
    Write-Info "Detected platform: windows-x64"

    # Fetch latest release
    Write-Info "Fetching latest release..."
    try {
        # Use TLS 1.2+ for GitHub API
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13

        $headers = @{ 'User-Agent' = 'agent-bridge-installer' }
        $release = Invoke-RestMethod -Uri $githubApi -Headers $headers -UseBasicParsing
    }
    catch {
        Write-Err "Failed to fetch latest release from GitHub API. Check your internet connection. $_"
    }

    $version = $release.tag_name
    if (-not $version) {
        Write-Err "Could not determine latest version from GitHub API response."
    }
    Write-Ok "Latest version: $version"

    # Find the correct asset
    $assetPattern = "agent-bridge-windows-x64"
    $asset = $release.assets | Where-Object { $_.name -like "$assetPattern*" } | Select-Object -First 1

    if (-not $asset) {
        Write-Err "Could not find release asset matching '$assetPattern' in version $version."
    }

    $downloadUrl = $asset.browser_download_url
    Write-Info "Resolving download URL..."

    # Create install directory
    if (-not (Test-Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    }

    $destPath = Join-Path $installDir $binaryName

    # Download binary
    Write-Info "Downloading agent-bridge $version..."
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $destPath -UseBasicParsing -Headers $headers
    }
    catch {
        Write-Err "Download failed: $_"
    }
    Write-Ok "Downloaded to $destPath"

    # Verify the binary runs
    try {
        $versionOutput = & $destPath --version 2>&1
        Write-Ok "Verified: $versionOutput"
    }
    catch {
        Write-Warn "Binary downloaded but could not verify version. It may still work correctly."
    }

    # Add to user PATH if not already present
    Write-Host ""
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $pathEntries = $userPath -split ';' | Where-Object { $_ -ne '' }

    if ($pathEntries -contains $installDir) {
        Write-Ok "Installation directory is already in your PATH"
    }
    else {
        Write-Info "Adding $installDir to user PATH..."
        try {
            $newPath = "$installDir;$userPath"
            [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
            Write-Ok "Added to user PATH"

            # Update current session PATH so verification works immediately
            $env:Path = "$installDir;$env:Path"

            Write-Warn "You may need to restart your terminal for PATH changes to take effect."
        }
        catch {
            Write-Warn "Could not update PATH automatically. Please add the following directory to your PATH manually:"
            Write-Host ""
            Write-Host "  $installDir" -ForegroundColor Cyan
            Write-Host ""
            Write-Host "  To add via PowerShell (run as current user):"
            Write-Host ""
            Write-Host "    `$path = [Environment]::GetEnvironmentVariable('Path', 'User')" -ForegroundColor Gray
            Write-Host "    [Environment]::SetEnvironmentVariable('Path', `"$installDir;`$path`", 'User')" -ForegroundColor Gray
        }
    }

    Write-Host ""
    Write-Host "Installation complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Run " -NoNewline
    Write-Host "agent-bridge --help" -ForegroundColor Cyan -NoNewline
    Write-Host " to get started."
    Write-Host "  Run " -NoNewline
    Write-Host "agent-bridge init" -ForegroundColor Cyan -NoNewline
    Write-Host " in a project to set up collaboration."
    Write-Host ""
}

Install-AgentBridge
