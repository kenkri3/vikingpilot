# Speiler kildekoden fra byggeroten til Google Drive.
#
# Hvorfor dette finnes: byggeroten kan ikke ligge på Google Drive. G: er et
# virtuelt FAT32-filsystem som skriver 0-byte filer og kaller det suksess.
# Se LAGT-TIL-GRUNN.md A-001.
#
# Derfor: bygg på C:, speil til G: så du fortsatt har koden i Google Drive.
#
# Bruk:
#   pwsh -File scripts/speil-til-drive.ps1

param(
    [string]$Fra = "C:\VikingPilot",
    [string]$Til = "G:\Min disk\GitHub\Vikingpilot"
)

$ErrorActionPreference = "Stop"

Write-Host "Speiler VikingPilot"
Write-Host "  fra: $Fra"
Write-Host "  til: $Til"

if (-not (Test-Path $Fra)) {
    Write-Error "Kilden finnes ikke: $Fra"
    exit 1
}

if (-not (Test-Path (Split-Path $Til -Parent))) {
    Write-Error @"
Google Drive er ikke tilgjengelig: $(Split-Path $Til -Parent)

Start Google Drive for Desktop og prøv igjen. Uten den kan ikke kildekoden
speiles, men byggeroten på C: virker uansett.
"@
    exit 1
}

# Det som IKKE skal speiles:
#   node_modules, .next  - kan bygges på nytt, og er enorme
#   .git                 - Google Drive håndterer ikke git-løse filer godt
#   .pg, .tools          - lokalt byggemiljø
#   src\generated        - genereres av prisma generate
#   .env                 - inneholder hemmeligheter, skal aldri forlate maskinen
robocopy $Fra $Til /E `
    /XD node_modules .next .git .pg .tools "src\generated" `
    /XF .env `
    /NFL /NDL /NJH /NJS /NP | Out-Null

# robocopy: 0 = ingenting å gjøre, 1 = filer kopiert, 2 = ekstra filer, 3 = begge.
# Alt under 8 er normalt.
if ($LASTEXITCODE -ge 8) {
    Write-Error "robocopy feilet med kode $LASTEXITCODE"
    exit 1
}

# Kontroller at filene faktisk har innhold. Dette er hele poenget med scriptet:
# uten kontrollen ville 0-byte filer sett ut som en vellykket speiling.
$filer = Get-ChildItem $Til -Recurse -File -ErrorAction SilentlyContinue
$tomme = $filer | Where-Object { $_.Length -eq 0 }

Write-Host ""
Write-Host "Speilet $($filer.Count) filer."

if ($tomme.Count -gt 0) {
    Write-Host ""
    Write-Warning "$($tomme.Count) fil(er) er 0 byte. Det betyr at Google Drive ikke skrev dem."
    $tomme | Select-Object -First 10 FullName | Format-Table -AutoSize
    Write-Host "Byggeroten på C: er upåvirket. Prøv speilingen igjen."
    exit 1
}

Write-Host "Ingen tomme filer. Speilingen er hel."
Write-Host ""
Write-Host "Husk: bygg alltid på $Fra, aldri på $Til."
