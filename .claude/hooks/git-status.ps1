# Hook: Stop — zeigt uncommittete Änderungen am Session-Ende
# Wenn der Working Tree sauber ist: kein Output (still).
# Wenn Änderungen vorhanden: Claude erhält sie als additionalContext.

Push-Location 'C:\Users\waldemar.toews\Documents\GitHub\USB-Station'
$output = & git status --short 2>&1 | Out-String
$branch = & git branch --show-current 2>&1
Pop-Location

if ($output.Trim()) {
    @{
        hookSpecificOutput = @{
            hookEventName   = 'Stop'
            additionalContext = "Branch: $($branch.Trim()) — uncommittete Änderungen:`n$($output.Trim())"
        }
    } | ConvertTo-Json -Depth 10
}
