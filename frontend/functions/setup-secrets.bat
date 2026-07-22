@echo off
REM Quick setup script for Windows Command Prompt
REM Sets Firebase secrets for content pipeline

echo ============================================
echo FIREBASE SECRETS SETUP
echo ============================================
echo.
echo This will set up required API keys for the content pipeline.
echo.
echo Required secrets for the default article pipeline:
echo   1. REPLICATE_API_KEY
echo   2. FIRECRAWL_API_KEY
echo.
echo Optional only if you switch providers or enable image fallback:
echo   3. OPENAI_API_KEY
echo   4. ANTHROPIC_API_KEY
echo.
echo ============================================
echo.

echo STEP 1: REPLICATE_API_KEY
echo Get your key from: https://replicate.com/account/api-tokens
echo.
set /p REPLICATE_KEY="Enter REPLICATE_API_KEY: "

if "%REPLICATE_KEY%"=="" (
    echo ERROR: No key provided!
    exit /b 1
)

echo Setting REPLICATE_API_KEY...
echo %REPLICATE_KEY% | firebase functions:secrets:set REPLICATE_API_KEY --project hybridcloudworks-61e8d --force
echo.

echo ============================================
echo.
echo STEP 2: FIRECRAWL_API_KEY
echo Get your key from: https://www.firecrawl.dev/
echo.
set /p FIRECRAWL_KEY="Enter FIRECRAWL_API_KEY: "

if "%FIRECRAWL_KEY%"=="" (
    echo ERROR: No key provided!
    exit /b 1
)

echo Setting FIRECRAWL_API_KEY...
echo %FIRECRAWL_KEY% | firebase functions:secrets:set FIRECRAWL_API_KEY --project hybridcloudworks-61e8d --force
echo.

echo ============================================
echo SETUP COMPLETE!
echo ============================================
echo.
echo Next steps:
echo   1. Ensure functions\.env contains the recommended non-secret AI config
echo   2. Deploy: firebase deploy --only functions
echo   3. Validate: cd functions ^&^& node --env-file=.env check-ai-stack-readiness.js
echo.
