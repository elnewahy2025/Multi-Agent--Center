# OpenCode Desktop CLI Launcher (v2.3.2)
# Ensures invocation of the verified OpenCode Desktop binary.

$OpenCodeExe = "C:\Users\ahmed\AppData\Local\Programs\ai.opencode.desktop\resources\opencode-cli.exe"

if (-not (Test-Path $OpenCodeExe)) {
    # Fallback to roaming path if installed there
    $OpenCodeExe = "C:\Users\ahmed\AppData\Roaming\ai.opencode.desktop\cli\2.3.2-x64\opencode-cli.exe"
}

if (-not (Test-Path $OpenCodeExe)) {
    Write-Error "OpenCode 2.3.2 executable not found at expected locations."
    exit 1
}

& $OpenCodeExe @args
