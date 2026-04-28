# claude-with-context.ps1 — Load chat history and run Claude in terminal
# Usage: .\claude-with-context.ps1 [query]

param(
    [string]$Query = ""
)

# Path to chat history
$chatHistoryPath = "$(Get-Location)\chat-history.json"

# Check if history exists
if (!(Test-Path $chatHistoryPath)) {
    Write-Host "⚠️  Chat history not found at: $chatHistoryPath" -ForegroundColor Yellow
    Write-Host "Starting fresh Claude session..." -ForegroundColor Gray
    if ($Query) {
        claude $Query
    } else {
        claude
    }
    exit
}

# Load history
try {
    $historyJson = Get-Content $chatHistoryPath -Raw | ConvertFrom-Json
    Write-Host "✓ Loaded chat history from web interface" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to parse chat history: $_" -ForegroundColor Red
    exit 1
}

# Extract active conversation
$activeConvId = $historyJson.activeConversationId
$activeConv = $historyJson.conversations | Where-Object { $_.id -eq $activeConvId } | Select-Object -First 1

if ($null -eq $activeConv) {
    $activeConv = $historyJson.conversations | Select-Object -First 1
}

# Format history for Claude context
$contextString = @"
## Previous Chat Context from Web Interface

**Last Updated:** $($historyJson.lastUpdated)
**Conversation ID:** $($activeConv.id)

---

"@

$activeConv.messages | ForEach-Object {
    $roleDisplay = $_.role.ToUpper()
    $contextString += "`n**$roleDisplay**:`n$($_.content)`n`n---`n"
}

# Create temporary file with context
$tempContextFile = "$env:TEMP\claude_context_$(Get-Random).txt"
$contextString | Out-File $tempContextFile -Encoding UTF8

Write-Host "`n📋 Chat context loaded ($($activeConv.messages.Count) messages)" -ForegroundColor Cyan
Write-Host "---" -ForegroundColor Gray

# If query provided, append to context and run directly
if ($Query) {
    Write-Host "`n▶ Running query with context..." -ForegroundColor Cyan
    $fullPrompt = $contextString + "`n\nNEW QUERY:\n$Query"
    $fullPrompt | claude
} else {
    Write-Host "`n💬 Starting Claude CLI with loaded context..." -ForegroundColor Cyan
    Write-Host "Type 'exit' or Ctrl+C to quit`n" -ForegroundColor Gray
    
    # Run Claude interactively
    $contextString | claude
}

# Cleanup
Remove-Item $tempContextFile -ErrorAction SilentlyContinue
