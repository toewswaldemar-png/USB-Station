# Hook: PostToolUse — TypeScript/Vite build nach .ts/.tsx-Änderungen
# Läuft asynchron (asyncRewake:true in settings.json):
#   → exit 0  = Build OK, kein Feedback (still)
#   → exit 2  = Build FEHLER, weckt Claude mit dem Fehlertext

$raw = [Console]::In.ReadToEnd()
if (-not $raw.Trim()) { exit 0 }

$json = $raw | ConvertFrom-Json
$file = $json.tool_input.file_path

# Nur .ts / .tsx Dateien weiterbehandeln
if ($file -notmatch '\.(ts|tsx)$') { exit 0 }

Push-Location 'C:\Users\waldemar.toews\Documents\GitHub\USB-Station\frontend-react'
$output = & npm run build 2>&1 | Select-Object -Last 40 | Out-String
$code = $LASTEXITCODE
Pop-Location

if ($code -ne 0) {
    @{
        hookSpecificOutput = @{
            hookEventName   = 'PostToolUse'
            additionalContext = "npm run build FEHLER (exit $code):`n$($output.Trim())"
        }
    } | ConvertTo-Json -Depth 10
    exit 2   # asyncRewake: Claude wird geweckt
}
