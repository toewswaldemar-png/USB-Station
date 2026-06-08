# Hook: PostToolUse — Go build nach .go-Änderungen
# Liest stdin-JSON, prüft Dateiendung, bricht bei Nicht-Go-Dateien still ab.
# Gibt bei Fehler ein hookSpecificOutput-Objekt mit additionalContext zurück,
# damit Claude den Fehler sofort sieht und korrigiert.

$raw = [Console]::In.ReadToEnd()
if (-not $raw.Trim()) { exit 0 }

$json = $raw | ConvertFrom-Json
$file = $json.tool_input.file_path

# Nur .go-Dateien weiterbehandeln
if ($file -notmatch '\.go$') { exit 0 }

Push-Location 'C:\Users\waldemar.toews\Documents\GitHub\USB-Station\filestation-go'
$output = & go build ./... 2>&1 | Out-String
$code = $LASTEXITCODE
Pop-Location

if ($code -ne 0 -and $output.Trim()) {
    @{
        hookSpecificOutput = @{
            hookEventName   = 'PostToolUse'
            additionalContext = "go build ./... FEHLER:`n$($output.Trim())"
        }
    } | ConvertTo-Json -Depth 10
    exit 1
}
