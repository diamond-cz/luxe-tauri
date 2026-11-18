$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

# A native parent (Node or HiViewer) can carry PowerShell 7's module paths into
# Windows PowerShell 5.1. Use this process's built-in modules for all cmdlets.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
    $env:PSModulePath = [IO.Path]::Combine($PSHOME, 'Modules')
}

function Get-VersionParts([string]$Version) {
    if ($Version -notmatch '^(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$') { throw 'Invalid plugin version' }
    return @($Version.Split('.') | ForEach-Object { [int]$_ })
}

function Compare-PluginVersion([string]$Left, [string]$Right) {
    $a = Get-VersionParts $Left
    $b = Get-VersionParts $Right
    for ($i = 0; $i -lt 3; $i++) {
        if ($a[$i] -gt $b[$i]) { return 1 }
        if ($a[$i] -lt $b[$i]) { return -1 }
    }
    return 0
}

function Select-PluginUpdate($Catalog, [string]$CurrentVersion) {
    if ($Catalog.version -ne 1 -or $null -eq $Catalog.plugins -or @($Catalog.plugins).Count -gt 256) { throw 'Invalid plugin catalog' }
    $latest = $null
    foreach ($item in $Catalog.plugins) {
        if ($item.id -ne 'luxe.image-sync' -or $item.target -ne 'windows-x86_64') { continue }
        $expected = "https://gh-proxy.com/https://github.com/diamond-cz/luxe-tauri/releases/download/luxe-image-sync-v$($item.version)/luxe-image-sync-$($item.version)-windows-x86_64.hvp"
        if ($item.url -cne $expected -or $item.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid plugin artifact identity or digest' }
        if ((Compare-PluginVersion $item.version $CurrentVersion) -le 0) { continue }
        if ($null -eq $latest -or (Compare-PluginVersion $item.version $latest.version) -gt 0) { $latest = $item }
        elseif ($item.version -eq $latest.version -and $item.sha256 -cne $latest.sha256) { throw 'Conflicting plugin digests' }
    }
    return $latest
}

function Assert-PluginHttpStatus([int]$Status) {
    if ($Status -lt 200 -or $Status -ge 300) { throw "plugin-http-$Status" }
}

function Receive-HttpsFile([string]$Address, [string]$Destination, [long]$Limit, [int]$TimeoutSeconds = 180) {
    $uri = [Uri]$Address
    if ($uri.Scheme -ne 'https' -or $uri.UserInfo) { throw 'HTTPS required' }
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $handler = [Net.Http.HttpClientHandler]::new()
    # Check each redirect before making another request; never follow an HTTPS-to-HTTP redirect.
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
    $cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($TimeoutSeconds))
    $response = $null
    $inputStream = $null
    $outputStream = $null
    try {
        $client.DefaultRequestHeaders.UserAgent.ParseAdd('LUXE-image-sync-updater/1')
        for ($redirect = 0; $redirect -le 5; $redirect++) {
            if ($uri.Scheme -ne 'https' -or $uri.UserInfo) { throw 'HTTPS required' }
            $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, $uri)
            try { $response = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $cancel.Token).GetAwaiter().GetResult() }
            finally { $request.Dispose() }
            if ([int]$response.StatusCode -in @(301, 302, 303, 307, 308)) {
                if ($redirect -eq 5 -or $null -eq $response.Headers.Location) { throw 'Too many or invalid redirects' }
                $uri = [Uri]::new($uri, $response.Headers.Location)
                $response.Dispose()
                $response = $null
                continue
            }
            Assert-PluginHttpStatus ([int]$response.StatusCode)
            break
        }
        if ($response.Content.Headers.ContentLength -gt $Limit) { throw 'Download exceeds size limit' }
        $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $outputStream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
        $buffer = New-Object byte[] 65536
        [long]$total = 0
        while (($count = $inputStream.ReadAsync($buffer, 0, $buffer.Length, $cancel.Token).GetAwaiter().GetResult()) -gt 0) {
            $total += $count
            if ($total -gt $Limit) { throw 'Download exceeds size limit' }
            $outputStream.Write($buffer, 0, $count)
        }
        $outputStream.Flush($true)
    } finally {
        if ($outputStream) { $outputStream.Dispose() }
        if ($inputStream) { $inputStream.Dispose() }
        if ($response) { $response.Dispose() }
        $cancel.Dispose()
        $client.Dispose()
    }
}

function Receive-PluginCatalog([string]$Destination) {
    $origin = 'https://github.com/diamond-cz/luxe-tauri/releases/download/luxe-plugin-updates/plugins.json'
    $addresses = @("https://gh-proxy.com/$origin", $origin)
    $missing = 0
    $errors = @()
    foreach ($address in $addresses) {
        try {
            Receive-HttpsFile $address $Destination 1MB 15
            return
        } catch {
            if ($_.Exception.Message -eq 'plugin-http-404') { $missing++ }
            $errors += $_.Exception.Message
            # A failed attempt may have created an incomplete file; the next download uses CreateNew.
            if ([IO.File]::Exists($Destination)) { [IO.File]::Delete($Destination) }
        }
    }
    if ($missing -eq $addresses.Count) { throw 'catalog-not-published' }
    throw ('catalog-unavailable: ' + ($errors -join '; '))
}

function Test-PluginArchive([string]$ArchivePath, $Artifact) {
    $digest = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($digest -cne $Artifact.sha256) { throw 'Plugin package SHA-256 mismatch' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        if ($archive.Entries.Count -gt 2048) { throw 'Too many package entries' }
        [long]$total = 0
        foreach ($entry in $archive.Entries) {
            $total += $entry.Length
            if ($total -gt 256MB) { throw 'Expanded package exceeds size limit' }
        }
        $entries = @($archive.Entries | Where-Object { $_.FullName -ceq 'manifest.json' })
        if ($entries.Count -ne 1 -or $entries[0].Length -gt 64KB) { throw 'Invalid package manifest' }
        $reader = [IO.StreamReader]::new($entries[0].Open(), [Text.UTF8Encoding]::new($false, $true))
        try {
            $text = New-Object char[] 65537
            $length = $reader.ReadBlock($text, 0, $text.Length)
            if ($length -gt 65536) { throw 'Invalid package manifest' }
            $manifest = (-join $text[0..($length - 1)]) | ConvertFrom-Json
        } finally { $reader.Dispose() }
        if ($manifest.id -cne $Artifact.id -or $manifest.version -cne $Artifact.version -or
            $manifest.backend.target -cne $Artifact.target -or $manifest.manifestVersion -ne 1 -or
            $manifest.apiVersion -ne 1) { throw 'Plugin package does not match catalog' }
    } finally { $archive.Dispose() }
}

function ConvertTo-ContractValue($Value) {
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [string] -or $Value -is [ValueType]) { return (ConvertTo-Json -InputObject $Value -Compress) }
    if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [pscustomobject]) {
        return '[' + ((@($Value | ForEach-Object { ConvertTo-ContractValue $_ })) -join ',') + ']'
    }
    return '{' + ((@($Value.PSObject.Properties | Sort-Object Name | ForEach-Object {
        (ConvertTo-Json -InputObject $_.Name -Compress) + ':' + (ConvertTo-ContractValue $_.Value)
    })) -join ',') + '}'
}

function Expand-PluginRuntime([string]$ArchivePath, [string]$Directory, [string]$Version, [string]$CurrentManifestJson) {
    if (-not $CurrentManifestJson) { throw 'Current plugin contract unavailable' }
    $current = $CurrentManifestJson | ConvertFrom-Json
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    $runtime = $null
    $complete = $false
    try {
        $manifestEntry = @($archive.Entries | Where-Object { $_.FullName -ceq 'manifest.json' })
        if ($manifestEntry.Count -ne 1 -or $manifestEntry[0].Length -gt 64KB) { throw 'Invalid package manifest' }
        $reader = [IO.StreamReader]::new($manifestEntry[0].Open(), [Text.UTF8Encoding]::new($false, $true))
        try { $candidate = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($candidate.version -cne $Version) { throw 'Runtime version mismatch' }
        # Independent updates preserve the host's installed contract. Any new
        # permission/command/data/UI declaration needs a full package review.
        $candidate.version = $current.version
        if ((ConvertTo-ContractValue $candidate) -cne (ConvertTo-ContractValue $current)) { throw 'plugin-contract-changed: install the full package in HiViewer' }
        if ($candidate.backend.executable -cne 'bin/luxe-image-sync.exe') { throw 'Invalid plugin executable' }
        $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        $binEntries = @()
        [long]$total = 0
        if ($archive.Entries.Count -gt 2048) { throw 'Too many package entries' }
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName
            if (-not $name -or $name.Contains('\') -or $name.StartsWith('/') -or $name.Contains(':') -or
                @($name.Split('/') | Where-Object { $_ -in @('', '.', '..') -or $_.EndsWith('.') -or $_.EndsWith(' ') }).Count -gt 0 -or
                $name.Split('/').Count -gt 15 -or -not $names.Add($name) -or
                (($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000 -or
                ($entry.ExternalAttributes -band 0x400) -ne 0) { throw 'Unsafe package path or duplicate entry' }
            $total += $entry.Length
            if ($entry.Length -gt 128MB -or $total -gt 256MB) { throw 'Expanded package exceeds size limit' }
            if ($name.StartsWith('bin/', [StringComparison]::Ordinal)) { $binEntries += $entry }
        }
        if (-not $names.Contains('bin/luxe-image-sync.exe')) { throw 'Plugin executable missing' }
        # At most two unresolved candidates can survive interrupted/timed-out
        # handoffs. Successful imports are removed by the native adapter.
        if (@([IO.Directory]::GetDirectories($Directory, 'runtime-*')).Count -ge 2) { throw 'Too many unresolved plugin runtimes; inspect the installed version and remove retired runtime-* directories from the plugin update folder' }
        $runtime = [IO.Path]::GetFullPath((Join-Path $Directory ('runtime-' + $Version + '-' + [Guid]::NewGuid().ToString('N'))))
        $root = [IO.Path]::GetFullPath($Directory).TrimEnd('\') + '\'
        if (-not $runtime.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe runtime directory' }
        $null = [IO.Directory]::CreateDirectory($runtime)
        [long]$writtenTotal = 0
        foreach ($entry in $binEntries) {
            $target = [IO.Path]::GetFullPath((Join-Path $runtime $entry.FullName.Substring(4)))
            if (-not $target.StartsWith($runtime + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe runtime path' }
            $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target))
            $inputStream = $entry.Open()
            $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $buffer = New-Object byte[] 65536
                [long]$written = 0
                while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $written += $count
                    $writtenTotal += $count
                    if ($written -gt $entry.Length -or $written -gt 128MB -or $writtenTotal -gt 256MB) { throw 'Expanded runtime exceeds size limit' }
                    $outputStream.Write($buffer, 0, $count)
                }
                if ($written -ne $entry.Length) { throw 'Truncated runtime entry' }
                $outputStream.Flush($true)
            }
            finally { $outputStream.Dispose(); $inputStream.Dispose() }
        }
        $complete = $true
        return (Join-Path $runtime 'luxe-image-sync.exe')
    } finally {
        $archive.Dispose()
        if (-not $complete -and $runtime -and [IO.Directory]::Exists($runtime)) {
            $root = [IO.Path]::GetFullPath($Directory).TrimEnd('\') + '\'
            if (-not $runtime.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or
                -not ([IO.Path]::GetFileName($runtime)).StartsWith('runtime-')) { throw 'Unsafe failed runtime cleanup' }
            [IO.Directory]::Delete($runtime, $true)
        }
    }
}

function Invoke-PluginUpdate([string]$Mode, [string]$CurrentVersion, [string]$Directory, [bool]$NativeInstall = $false, [string]$CurrentManifestJson = '') {
    if ($Mode -notin @('check', 'download')) { throw 'Invalid update operation' }
    $null = Get-VersionParts $CurrentVersion
    if (-not [IO.Path]::IsPathRooted($Directory)) { throw 'Absolute update directory required' }
    $null = [IO.Directory]::CreateDirectory($Directory)
    $catalogPath = Join-Path $Directory ('catalog-' + [Guid]::NewGuid().ToString('N') + '.json')
    $partial = Join-Path $Directory ('package-' + [Guid]::NewGuid().ToString('N') + '.partial')
    try {
        Receive-PluginCatalog $catalogPath
        $catalog = [IO.File]::ReadAllText($catalogPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
        $artifact = Select-PluginUpdate $catalog $CurrentVersion
        if ($null -eq $artifact) { return @{ available = $false; version = $CurrentVersion; path = $null } }
        if ($Mode -eq 'check') { return @{ available = $true; version = $artifact.version; path = $null } }
        $destination = Join-Path $Directory "luxe-image-sync-$($artifact.version)-windows-x86_64.hvp"
        if ([IO.File]::Exists($destination)) { Test-PluginArchive $destination $artifact }
        else {
            Receive-HttpsFile $artifact.url $partial 128MB
            Test-PluginArchive $partial $artifact
            # File.Move refuses to replace an existing package. The live installed package is never modified.
            [IO.File]::Move($partial, $destination)
        }
        $executable = $null
        if ($NativeInstall) { $executable = Expand-PluginRuntime $destination $Directory $artifact.version $CurrentManifestJson }
        return @{ available = $true; version = $artifact.version; path = $destination; executable = $executable }
    } finally {
        foreach ($temporary in @($catalogPath, $partial)) {
            if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
        }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Invoke-PluginUpdate $env:LUXE_PLUGIN_UPDATE_MODE $env:LUXE_PLUGIN_CURRENT_VERSION $env:LUXE_PLUGIN_UPDATE_DIRECTORY ($env:LUXE_PLUGIN_NATIVE_INSTALL -eq '1') $env:LUXE_PLUGIN_CURRENT_MANIFEST | ConvertTo-Json -Compress
    } catch {
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 1
    }
}
