$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../plugins/luxe-image-sync/native/update.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-True($Condition, [string]$Message) {
    if (-not $Condition) { throw "Assertion failed: $Message" }
}
function Assert-Throws([scriptblock]$Action, [string]$Pattern) {
    try { & $Action } catch {
        if ($_.Exception.Message -notmatch $Pattern) { throw }
        return
    }
    throw "Expected failure: $Pattern"
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('luxe-update-test-' + [Guid]::NewGuid().ToString('N'))
$null = [IO.Directory]::CreateDirectory($root)
try {
    Assert-True ((Compare-PluginVersion '0.1.10' '0.1.9') -eq 1) 'numeric version ordering'
    Assert-True ((Compare-PluginVersion '1.0.0' '0.99.999') -eq 1) 'major version ordering'
    Assert-Throws { Compare-PluginVersion '01.2.3' '1.2.3' } 'Invalid plugin version'
    $manifest = @{ manifestVersion = 1; apiVersion = 1; id = 'luxe.image-sync'; version = '0.1.5'; backend = @{ target = 'windows-x86_64' } }
    $source = Join-Path $root 'source'
    $null = [IO.Directory]::CreateDirectory($source)
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $source 'manifest.json') -Encoding UTF8
    $fixture = Join-Path $root 'fixture.hvp'
    [IO.Compression.ZipFile]::CreateFromDirectory($source, $fixture)
    $artifact = [pscustomobject]@{
        id = 'luxe.image-sync'; version = '0.1.5'; target = 'windows-x86_64'
        url = 'https://gh-proxy.com/https://github.com/diamond-cz/luxe-tauri/releases/download/luxe-image-sync-v0.1.5/luxe-image-sync-0.1.5-windows-x86_64.hvp'
        sha256 = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $catalog = @{ version = 1; plugins = @($artifact) }
    Assert-True ($null -eq (Select-PluginUpdate $catalog '0.1.5')) 'same version is not an update'
    Assert-True ($null -eq (Select-PluginUpdate $catalog '0.1.6')) 'downgrade rejected'
    Assert-True ((Select-PluginUpdate $catalog '0.1.4').version -eq '0.1.5') 'new version offered'
    $artifact.target = 'macos-aarch64'
    Assert-True ($null -eq (Select-PluginUpdate $catalog '0.1.4')) 'platform must match'
    $artifact.target = 'windows-x86_64'
    $artifact.id = 'other.plugin'
    Assert-True ($null -eq (Select-PluginUpdate $catalog '0.1.4')) 'identity must match'
    $artifact.id = 'luxe.image-sync'
    $artifact.url = 'http://example.invalid/plugin.hvp'
    Assert-Throws { Select-PluginUpdate $catalog '0.1.4' } 'Invalid plugin artifact'
    $artifact.url = 'https://gh-proxy.com/https://github.com/diamond-cz/luxe-tauri/releases/download/luxe-image-sync-v0.1.5/luxe-image-sync-0.1.5-windows-x86_64.hvp'
    Test-PluginArchive $fixture $artifact
    $artifact.version = '0.1.6'
    Assert-Throws { Test-PluginArchive $fixture $artifact } 'does not match'
    $artifact.version = '0.1.5'
    $correctHash = $artifact.sha256
    $artifact.sha256 = 'a' * 64
    Assert-Throws { Test-PluginArchive $fixture $artifact } 'SHA-256 mismatch'
    $artifact.sha256 = $correctHash

    Assert-PluginHttpStatus 200
    Assert-Throws { Assert-PluginHttpStatus 404 } '^plugin-http-404$'
    Assert-Throws { Assert-PluginHttpStatus 503 } '^plugin-http-503$'
    $script:catalogRequests = @()
    $script:catalogTestMode = 'proxy-failure'
    function Receive-HttpsFile([string]$Address, [string]$Destination, [long]$Limit, [int]$TimeoutSeconds = 180) {
        $script:catalogRequests += $Address
        Assert-True ($Limit -eq 1MB -and $TimeoutSeconds -eq 15) 'catalog requests are bounded and responsive'
        if ($script:catalogTestMode -eq 'missing') { throw 'plugin-http-404' }
        if ($script:catalogTestMode -eq 'network') { throw 'network-unavailable' }
        if ($Address.StartsWith('https://gh-proxy.com/')) {
            [IO.File]::WriteAllText($Destination, 'partial')
            throw 'proxy-unavailable'
        }
        [IO.File]::WriteAllText($Destination, ($catalog | ConvertTo-Json -Depth 8))
    }
    $catalogProbe = Join-Path $root 'catalog-probe.json'
    Receive-PluginCatalog $catalogProbe
    Assert-True ($script:catalogRequests.Count -eq 2) 'proxy failure falls back to origin once'
    Assert-True ($script:catalogRequests[0].StartsWith('https://gh-proxy.com/')) 'proxy is preferred'
    Assert-True (([IO.File]::ReadAllText($catalogProbe) | ConvertFrom-Json).version -eq 1) 'origin replaces incomplete proxy result'
    [IO.File]::Delete($catalogProbe)
    $script:catalogTestMode = 'missing'
    Assert-Throws { Receive-PluginCatalog $catalogProbe } '^catalog-not-published$'
    $script:catalogTestMode = 'network'
    Assert-Throws { Receive-PluginCatalog $catalogProbe } '^catalog-unavailable:'

    # Exercise the real orchestration with deterministic local transport; no network or installed package writes.
    $script:downloads = 0
    function Receive-HttpsFile([string]$Address, [string]$Destination, [long]$Limit, [int]$TimeoutSeconds = 180) {
        if ($Address.EndsWith('plugins.json')) {
            Assert-True ($Limit -eq 1MB) 'catalog limit'
            Assert-True ($TimeoutSeconds -eq 15) 'catalog timeout'
            [IO.File]::WriteAllText($Destination, ($catalog | ConvertTo-Json -Depth 8))
        } else {
            Assert-True ($Limit -eq 128MB) 'package limit'
            Assert-True ($TimeoutSeconds -eq 180) 'package timeout'
            $script:downloads++
            [IO.File]::Copy($fixture, $Destination)
        }
    }
    $updates = Join-Path $root 'updates'
    $checked = Invoke-PluginUpdate 'check' '0.1.4' $updates
    Assert-True ($checked.available -and $null -eq $checked.path -and $script:downloads -eq 0) 'check never downloads package'
    $downloaded = Invoke-PluginUpdate 'download' '0.1.4' $updates
    Assert-True ([IO.File]::Exists($downloaded.path) -and $script:downloads -eq 1) 'verified package staged'
    $again = Invoke-PluginUpdate 'download' '0.1.4' $updates
    Assert-True ($again.path -eq $downloaded.path -and $script:downloads -eq 1) 'verified package reused'
    [IO.File]::WriteAllText($downloaded.path, 'corrupted')
    Assert-Throws { Invoke-PluginUpdate 'download' '0.1.4' $updates } 'SHA-256 mismatch'
    Assert-True (@(Get-ChildItem -LiteralPath $updates -File).Count -eq 1) 'temporary files always removed'
    Assert-True ([IO.File]::ReadAllText($downloaded.path) -eq 'corrupted') 'existing corrupt package never overwritten'
    Assert-Throws { Invoke-PluginUpdate 'install' '0.1.4' $updates } 'Invalid update operation'
    # Independent runtime import: only bin/ is exported; package integration
    # declarations cannot silently change under inherited host grants.
    $runtimeManifest = @{ manifestVersion = 1; apiVersion = 1; id = 'luxe.image-sync'; version = '0.1.7';
        permissions = @('native.execute', 'selection.read', 'native.update'); dataVersion = 1;
        backend = @{ executable = 'bin/luxe-image-sync.exe'; target = 'windows-x86_64'; transport = 'stdio-jsonl' } }
    $contract = $runtimeManifest | ConvertTo-Json -Depth 10 -Compress
    $runtimeManifest.version = '0.1.8'
    function New-RuntimeArchive([string]$ExtraPath = '', [bool]$ChangedContract = $false) {
        $archivePath = Join-Path $root ([Guid]::NewGuid().ToString('N') + '.hvp')
        $zip = [IO.Compression.ZipFile]::Open($archivePath, [IO.Compression.ZipArchiveMode]::Create)
        try {
            $copy = ($runtimeManifest | ConvertTo-Json -Depth 10) | ConvertFrom-Json
            if ($ChangedContract) { $copy.permissions += 'network.fetch' }
            $entries = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
            $entries.Add('manifest.json', ($copy | ConvertTo-Json -Depth 10))
            $entries.Add('main.js', 'worker')
            $entries.Add('bin/luxe-image-sync.exe', 'new-executable')
            $entries.Add('bin/lib/runtime.dll', 'library')
            if ($ExtraPath) { $entries[$ExtraPath] = 'unsafe' }
            foreach ($name in $entries.Keys) {
                $entry = $zip.CreateEntry($name)
                $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
                try { $writer.Write($entries[$name]) } finally { $writer.Dispose() }
            }
        } finally { $zip.Dispose() }
        return $archivePath
    }
    $runtimeArchive = New-RuntimeArchive
    $executable = Expand-PluginRuntime $runtimeArchive $updates '0.1.8' $contract
    Assert-True ([IO.File]::ReadAllText($executable) -eq 'new-executable') 'runtime executable staged'
    $runtimeDir = [IO.Path]::GetDirectoryName($executable)
    Assert-True ([IO.File]::ReadAllText((Join-Path $runtimeDir 'lib/runtime.dll')) -eq 'library') 'nested runtime resources preserved'
    Assert-True (-not [IO.File]::Exists((Join-Path $runtimeDir 'main.js'))) 'worker/manifest are not copied into runtime root'
    Assert-True (@(Get-ChildItem -LiteralPath $runtimeDir -File).Count -eq 1) 'runtime contains no downloaded archives or updater state'
    Assert-Throws { Expand-PluginRuntime $runtimeArchive $updates '0.1.9' $contract } 'version mismatch'
    Assert-Throws { Expand-PluginRuntime (New-RuntimeArchive -ChangedContract $true) $updates '0.1.8' $contract } 'plugin-contract-changed'
    foreach ($unsafe in @('bin/../escape.exe', 'bin/C:/escape.exe', 'bin/lib/./bad.dll', 'bin/LUXE-IMAGE-SYNC.EXE')) {
        Assert-Throws { Expand-PluginRuntime (New-RuntimeArchive $unsafe) $updates '0.1.8' $contract } 'Unsafe package path'
    }
    $fixture = $runtimeArchive
    $artifact.version = '0.1.8'
    $artifact.url = 'https://gh-proxy.com/https://github.com/diamond-cz/luxe-tauri/releases/download/luxe-image-sync-v0.1.8/luxe-image-sync-0.1.8-windows-x86_64.hvp'
    $artifact.sha256 = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash.ToLowerInvariant()
    $native = Invoke-PluginUpdate 'download' '0.1.7' $updates $true $contract
    Assert-True ([IO.File]::Exists($native.path) -and [IO.File]::Exists($native.executable)) 'real updater returns both verified package and isolated runtime'
    Assert-Throws { Expand-PluginRuntime $runtimeArchive $updates '0.1.8' $contract } 'Too many unresolved'
    Write-Output 'Plugin update version, identity, digest, download, reuse, runtime contract and cleanup assertions passed.'
} finally {
    # Only this explicitly created test directory may be removed.
    $resolvedRoot = [IO.Path]::GetFullPath($root)
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolvedRoot.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not ([IO.Path]::GetFileName($resolvedRoot)).StartsWith('luxe-update-test-')) { throw 'Unsafe test cleanup target' }
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
}
