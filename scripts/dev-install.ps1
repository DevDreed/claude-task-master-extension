#!/usr/bin/env powershell

# Claude Task Master Extension - Auto Dev Install Script
# This script compiles, packages, and installs the extension automatically

$EXTENSION_NAME = "claude-task-master-extension"
$VSIX_FILE = "$EXTENSION_NAME-1.2.1.vsix"

Write-Host "🚀 Starting automatic extension rebuild and install..." -ForegroundColor Green
Write-Host ""

# Step 1: Compile TypeScript
Write-Host "📦 Step 1: Compiling TypeScript..." -ForegroundColor Yellow
try {
    npm run compile
    if ($LASTEXITCODE -ne 0) {
        throw "TypeScript compilation failed"
    }
    Write-Host "✅ TypeScript compiled successfully" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "❌ TypeScript compilation failed: $_" -ForegroundColor Red
    exit 1
}

# Step 2: Package the extension
Write-Host "📦 Step 2: Packaging extension..." -ForegroundColor Yellow
try {
    npx vsce package
    if ($LASTEXITCODE -ne 0) {
        throw "Packaging failed"
    }
    Write-Host "✅ Extension packaged successfully" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "❌ Packaging failed: $_" -ForegroundColor Red
    exit 1
}

# Step 3: Find VS Code or Cursor
Write-Host "🔧 Step 3: Installing extension..." -ForegroundColor Yellow

$codeCommand = $null

# Try common commands first
$commands = @("cursor", "code")
foreach ($cmd in $commands) {
    try {
        & $cmd --version 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $codeCommand = $cmd
            break
        }
    } catch {
        # Command not found, try next
    }
}

# If not found, check common Windows installation paths
if (-not $codeCommand) {
    $windowsPaths = @(
        "$env:USERPROFILE\AppData\Local\Programs\cursor\Cursor.exe",
        "$env:USERPROFILE\AppData\Local\Programs\Microsoft VS Code\Code.exe",
        "${env:ProgramFiles}\Microsoft VS Code\Code.exe",
        "${env:ProgramFiles(x86)}\Microsoft VS Code\Code.exe"
    )
    
    foreach ($path in $windowsPaths) {
        if (Test-Path $path) {
            $codeCommand = "`"$path`""
            break
        }
    }
}

if (-not $codeCommand) {
    Write-Host "⚠️  VS Code/Cursor CLI not found. Manual installation required:" -ForegroundColor Yellow
    Write-Host "   1. Open VS Code/Cursor"
    Write-Host "   2. Ctrl+Shift+P → 'Extensions: Install from VSIX'"
    Write-Host "   3. Select: $VSIX_FILE"
    Write-Host "   4. Reload window: Ctrl+Shift+P → 'Developer: Reload Window'"
    exit 0
}

Write-Host "   Using: $codeCommand" -ForegroundColor Cyan

# Install the extension
$installCmd = "$codeCommand --install-extension $VSIX_FILE --force"

try {
    Invoke-Expression $installCmd
    if ($LASTEXITCODE -ne 0) {
        throw "Installation command failed"
    }
    
    Write-Host "✅ Extension installed successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "🎉 All done! Next steps:" -ForegroundColor Green
    Write-Host "   1. Reload VS Code/Cursor window (Ctrl+Shift+P → 'Developer: Reload Window')"
    Write-Host "   2. Check the Task Master panel for updated functionality"
    
    # Optional: Try to reload VS Code automatically
    Write-Host ""
    Write-Host "🔄 Attempting to reload VS Code/Cursor..." -ForegroundColor Yellow
    
    try {
        & $codeCommand --command workbench.action.reloadWindow 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ VS Code/Cursor reloaded successfully!" -ForegroundColor Green
        } else {
            Write-Host "⚠️  Auto-reload failed. Please manually reload:" -ForegroundColor Yellow
            Write-Host "   Ctrl+Shift+P → 'Developer: Reload Window'"
        }
    } catch {
        Write-Host "⚠️  Auto-reload failed. Please manually reload:" -ForegroundColor Yellow
        Write-Host "   Ctrl+Shift+P → 'Developer: Reload Window'"
    }
    
} catch {
    Write-Host "❌ Installation failed: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "📝 Manual installation steps:" -ForegroundColor Yellow
    Write-Host "   1. Open VS Code/Cursor"
    Write-Host "   2. Ctrl+Shift+P → 'Extensions: Install from VSIX'"
    Write-Host "   3. Select: $VSIX_FILE"
    exit 1
} 