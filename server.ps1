$port = 8000
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
} catch {
    Write-Host "Non riesco ad avviare il server sulla porta $port."
    Write-Host "Errore: $($_.Exception.Message)"
    Write-Host ""
    Write-Host "Premi un tasto per chiudere."
    [void][System.Console]::ReadKey($true)
    exit
}

Write-Host "Server avviato: http://localhost:$port"
Write-Host "Lascia questa finestra aperta finche' stai testando l'app."
Write-Host "Per fermarlo: chiudi questa finestra, oppure premi CTRL+C."
Write-Host ""

Start-Process "http://localhost:$port"

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".htm"  = "text/html; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
    ".woff" = "font/woff"
    ".woff2"= "font/woff2"
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
    } catch {
        break
    }

    $request = $context.Request
    $response = $context.Response

    $localPath = [System.Uri]::UnescapeDataString($request.Url.LocalPath)
    if ($localPath -eq "/") { $localPath = "/index.html" }

    $relative = $localPath.TrimStart("/") -replace "/", [System.IO.Path]::DirectorySeparatorChar
    $filePath = Join-Path $root $relative

    Write-Host "$($request.HttpMethod) $localPath"

    if ((Test-Path $filePath -PathType Leaf)) {
        $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
        $contentType = $mimeTypes[$ext]
        if (-not $contentType) { $contentType = "application/octet-stream" }

        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $response.ContentType = $contentType
        $response.ContentLength64 = $bytes.Length
        $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $response.StatusCode = 404
        $notFoundBytes = [System.Text.Encoding]::UTF8.GetBytes("404 - File non trovato: $localPath")
        $response.ContentLength64 = $notFoundBytes.Length
        $response.OutputStream.Write($notFoundBytes, 0, $notFoundBytes.Length)
    }

    $response.OutputStream.Close()
}
