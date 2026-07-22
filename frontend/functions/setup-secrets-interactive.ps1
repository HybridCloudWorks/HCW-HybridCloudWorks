# Interactive Secret Setup for Firebase Functions
# Run this script to configure FIRECRAWL_API_KEY and ANTHROPIC_API_KEY

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "🔐 FIREBASE SECRETS SETUP" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Write-Host "This script will help you set up the required API keys for the current content pipeline." -ForegroundColor White
Write-Host ""

# Check if we're in the functions directory
$currentDir = (Get-Location).Path
if ($currentDir -notmatch "\\functions$") {
    Write-Host "❌ Please run this script from the functions\ directory" -ForegroundColor Red
    Write-Host "   Current: $currentDir" -ForegroundColor Yellow
    Write-Host "   Expected: ...\\Personal-Site_HCW\\functions" -ForegroundColor Yellow
    exit 1
}

Write-Host "📋 Required Secrets:" -ForegroundColor Yellow
Write-Host "   1. REPLICATE_API_KEY  - AI image generation for publish-time covers" -ForegroundColor White
Write-Host "   2. FIRECRAWL_API_KEY  - Web scraping service" -ForegroundColor White
Write-Host "" 
Write-Host "Optional only if you switch providers or enable image fallback:" -ForegroundColor Yellow
Write-Host "   3. OPENAI_API_KEY     - OpenAI provider / image fallback" -ForegroundColor White
Write-Host "   4. ANTHROPIC_API_KEY  - Anthropic provider" -ForegroundColor White
Write-Host ""

Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "STEP 1: REPLICATE_API_KEY" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "Get your key from: https://replicate.com/account/api-tokens" -ForegroundColor Gray
Write-Host ""

$replicateKey = Read-Host "Enter REPLICATE_API_KEY (or press Enter to skip)"

if ($replicateKey) {
    Write-Host "Setting REPLICATE_API_KEY..." -ForegroundColor Yellow
    try {
        $replicateKey | firebase functions:secrets:set REPLICATE_API_KEY --project hybridcloudworks-61e8d --force
        Write-Host "✅ REPLICATE_API_KEY configured!" -ForegroundColor Green
    }
    catch {
        Write-Host "❌ Failed to set REPLICATE_API_KEY" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
    }
}
else {
    Write-Host "⏭️  Skipped REPLICATE_API_KEY" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "STEP 2: FIRECRAWL_API_KEY" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "Get your key from: https://www.firecrawl.dev/" -ForegroundColor Gray
Write-Host "Format: fc-xxxxx..." -ForegroundColor Gray
Write-Host ""

$firecrawlKey = Read-Host "Enter FIRECRAWL_API_KEY (or press Enter to skip)"

if ($firecrawlKey) {
    Write-Host "Setting FIRECRAWL_API_KEY..." -ForegroundColor Yellow
    try {
        $firecrawlKey | firebase functions:secrets:set FIRECRAWL_API_KEY --project hybridcloudworks-61e8d --force
        Write-Host "✅ FIRECRAWL_API_KEY configured!" -ForegroundColor Green
    }
    catch {
        Write-Host "❌ Failed to set FIRECRAWL_API_KEY" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
    }
}
else {
    Write-Host "⏭️  Skipped FIRECRAWL_API_KEY" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "VERIFICATION" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

Write-Host "Checking configured secrets..." -ForegroundColor Yellow
firebase functions:secrets:list --project hybridcloudworks-61e8d

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "NEXT STEPS" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Ensure functions/.env contains the recommended non-secret AI config:" -ForegroundColor White
Write-Host "   CONTENTFORGE_AI_PROVIDER=vertex" -ForegroundColor Gray
Write-Host "   CONTENTFORGE_METADATA_ONLY=true" -ForegroundColor Gray
Write-Host "   CONTENTFORGE_IMAGE_MODEL=google/imagen-4-fast" -ForegroundColor Gray
Write-Host "" 
Write-Host "2. Deploy the functions:" -ForegroundColor White
Write-Host "   cd .." -ForegroundColor Gray
Write-Host "   firebase deploy --only functions" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Validate readiness:" -ForegroundColor White
Write-Host "   cd functions" -ForegroundColor Gray
Write-Host "   node --env-file=.env check-ai-stack-readiness.js" -ForegroundColor Gray
Write-Host ""
Write-Host "✨ Setup complete!" -ForegroundColor Green
