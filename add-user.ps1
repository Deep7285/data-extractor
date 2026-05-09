# add-user.ps1
# Usage: .\add-user.ps1 <username> <password>
# It writes the user JSON to a temp file first, avoiding PowerShell quote-stripping.
# Requires: node tools/make-user.mjs to be available
# Requires: CLOUDFLARE_API_TOKEN to be set in this session (or wrangler already logged in)
#
# Example:
#   $env:CLOUDFLARE_API_TOKEN = "your_token_here"
#   .\add-user.ps1 priya SecurePass@123

param(
    [Parameter(Mandatory=$true)] [string]$Username,
    [Parameter(Mandatory=$true)] [string]$Password
)

Write-Host ""
Write-Host "Creating user: $Username" -ForegroundColor Cyan

# Step 1: Generate the JSON using make-user.mjs
# Capture only the JSON line (starts with '{')
$output = node tools/make-user.mjs $Username $Password 2>&1
$jsonLine = ($output | Where-Object { $_ -match '^\s*\{' }) -replace '^\s+',''

if (-not $jsonLine) {
    Write-Host "ERROR: make-user.mjs did not produce JSON output." -ForegroundColor Red
    Write-Host $output
    exit 1
}

Write-Host "JSON generated OK" -ForegroundColor Green

# Step 2: Write JSON to a temp file (avoids all PowerShell quoting issues)
$tmpFile = [System.IO.Path]::GetTempFileName()
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($tmpFile, $jsonLine, $utf8NoBom)

Write-Host "Temp file: $tmpFile"

# Step 3: Push to Cloudflare KV using --path (reads value from file, no quoting needed)
Write-Host "Writing to KV..." -ForegroundColor Cyan
npx wrangler kv key put --binding=USERS "user:$Username" --path $tmpFile --remote --preview false

# Step 4: Clean up
Remove-Item $tmpFile -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Done. User '$Username' is ready to log in." -ForegroundColor Green