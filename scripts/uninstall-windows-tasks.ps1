param(
    [string]$TaskName = "CatchScore-BlindReview"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

try {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Scheduled task removed:" $TaskName
    } else {
        Write-Host "Scheduled task not found:" $TaskName
    }
} catch {
    Write-Error ("Failed to remove scheduled task '{0}': {1}" -f $TaskName, $_.Exception.Message)
    exit 1
}
