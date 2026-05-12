param(
    [string]$TaskName = "CatchScore-BlindReview",
    [string]$ConfigPath = ".\\config.local.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

try {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $nodeCommand = Get-Command node -ErrorAction Stop
    $nodePath = $nodeCommand.Source
    $mainScript = Join-Path $repoRoot "src\\main.js"
    $resolvedConfig = Resolve-Path $ConfigPath -ErrorAction Stop

    $argument = "`"$mainScript`" run-once --config `"$($resolvedConfig.Path)`""
    $action = New-ScheduledTaskAction -Execute $nodePath -Argument $argument
    $triggers = @(
        (New-ScheduledTaskTrigger -Daily -At 12:00),
        (New-ScheduledTaskTrigger -Daily -At 18:00)
    )
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -StartWhenAvailable

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $triggers `
        -Settings $settings `
        -Description "Poll SEU blind review results and push notifications." `
        -Force | Out-Null

    Write-Host "Scheduled task installed:" $TaskName
} catch {
    Write-Error ("Failed to install scheduled task '{0}': {1}" -f $TaskName, $_.Exception.Message)
    exit 1
}
