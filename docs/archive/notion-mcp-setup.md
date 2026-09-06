# Notion MCP Server Setup Guide

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 26, 2026
**Status:** Setup Instructions
**Persona:** FED + KCS

## Overview

This guide walks through setting up the Notion MCP (Model Context Protocol) server to enable direct
AI agent access to your Notion secrets database.

---

## What You Need

1. **Notion API Token** - Your integration token (already have: `NOTION_API_TOKEN`)
2. **Notion Database ID** - Your secrets database ID (already have: `NOTION_SECRETS_DB_ID`)
3. **VS Code** - Latest version with GitHub Copilot Agent
4. **Node.js** - v18+ (for MCP server)

---

## Step 1: Install Notion MCP Server

### Option A: Via NPM (Recommended)

```powershell
# Install globally
npm install -g @modelcontextprotocol/server-notion

# Or install locally in project
npm install --save-dev @modelcontextprotocol/server-notion
```

### Option B: Via Official MCP Server Repository

```powershell
# Clone the MCP servers repository
git clone https://github.com/modelcontextprotocol/servers.git
cd servers/src/notion

# Install dependencies
npm install

# Build
npm run build
```

---

## Step 2: Configure VS Code Settings

Create or update your VS Code settings to include the Notion MCP server.

### For Workspace (Recommended)

Create `.vscode/settings.json` in your repository:

```json
{
  "github.copilot.chat.mcp.servers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-notion"],
      "env": {
        "NOTION_API_KEY": "${env:NOTION_API_TOKEN}",
        "NOTION_DATABASE_ID": "${env:NOTION_SECRETS_DB_ID}"
      }
    }
  }
}
```

### For User Settings (Global)

On Windows: `%APPDATA%\Code\User\settings.json`

Add:

```json
{
  "github.copilot.chat.mcp.servers": {
    "notion": {
      "command": "node",
      "args": ["C:\\path\\to\\notion-mcp-server\\build\\index.js"],
      "env": {
        "NOTION_API_KEY": "your-notion-api-token",
        "NOTION_DATABASE_ID": "your-database-id"
      }
    }
  }
}
```

⚠️ **Security Note:** Using environment variables (`${env:NOTION_API_TOKEN}`) is more secure than
hardcoding tokens.

---

## Step 3: Set Environment Variables

The MCP server needs access to your Notion credentials:

### Option A: PowerShell Profile (Persistent)

```powershell
# Edit your PowerShell profile
notepad $PROFILE

# Add these lines:
$env:NOTION_API_TOKEN = "ntn_xxxxxxxxxxxxx"
$env:NOTION_SECRETS_DB_ID = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# Save and reload
. $PROFILE
```

### Option B: System Environment Variables (Most Secure)

1. Open **Settings → System → About → Advanced system settings**
2. Click **Environment Variables**
3. Under **User variables**, click **New**
4. Add:
   - Variable name: `NOTION_API_TOKEN`
   - Variable value: `ntn_xxxxxxxxxxxxx`
5. Repeat for `NOTION_SECRETS_DB_ID`
6. Restart VS Code for changes to take effect

### Option C: .env File (Development Only)

Create `.env` in repository root:

```bash
NOTION_API_TOKEN=ntn_xxxxxxxxxxxxx
NOTION_SECRETS_DB_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

⚠️ **Add to `.gitignore`:**

```
.env
```

---

## Step 4: Verify Installation

### Test 1: Check MCP Server Installation

```powershell
# If installed globally
npx @modelcontextprotocol/server-notion --version

# Should output version number
```

### Test 2: Verify Environment Variables

```powershell
# Check variables are set
echo $env:NOTION_API_TOKEN
echo $env:NOTION_SECRETS_DB_ID

# Should output your values (not empty)
```

### Test 3: Test Notion API Connection

```powershell
# Use existing script to test connection
cd scripts
node notion-to-yaml.js --db-id $env:NOTION_SECRETS_DB_ID --output test.yaml --filter all

# Should fetch secrets successfully
Remove-Item test.yaml
```

---

## Step 5: Enable MCP in VS Code

1. **Restart VS Code** completely (close all windows)
2. Open **GitHub Copilot Chat**
3. Type: `@workspace list notion secrets`
4. The MCP server should now be available

### Verify MCP Server is Running

Open **Output Panel** in VS Code:

- View → Output
- Select "GitHub Copilot MCP" from dropdown
- Look for: `[notion] MCP server started`

---

## Available MCP Commands

Once configured, you can use these commands in GitHub Copilot Chat:

### Query Notion Database

```
@workspace what secrets are in the notion database?
```

### Get Specific Secret

```
@workspace get the value of CLOUDFLARE_API_TOKEN from notion
```

### List All Secrets

```
@workspace list all production secrets from notion
```

### Check for Missing Secrets

```
@workspace compare terraform variables with notion secrets and tell me what's missing
```

---

## Configuration Files Created

After setup, you should have:

```
.vscode/
  └── settings.json           # MCP server configuration

# Environment variables set in one of:
$PROFILE                      # PowerShell profile
System Environment Variables  # Windows settings
.env                         # Local development (not committed)
```

---

## Troubleshooting

### Error: "MCP server not found"

**Solution:**

```powershell
# Reinstall the MCP server
npm install -g @modelcontextprotocol/server-notion

# Verify installation
npx @modelcontextprotocol/server-notion --version
```

### Error: "NOTION_API_KEY not set"

**Solution:**

1. Check environment variables are set: `echo $env:NOTION_API_TOKEN`
2. Restart VS Code after setting system environment variables
3. Verify syntax in `.vscode/settings.json` is correct

### Error: "Database not found"

**Solution:**

1. Verify database ID is correct (32 characters, no dashes)
2. Check Notion integration has access to the database:
   - Open database in Notion
   - Click "..." → "Connections"
   - Ensure your integration is connected

### MCP Server Not Starting

**Solution:**

```powershell
# Check VS Code output logs
# View → Output → "GitHub Copilot MCP"

# Manually test the server
$env:NOTION_API_KEY = $env:NOTION_API_TOKEN
npx @modelcontextprotocol/server-notion

# Should output server info without errors
```

---

## Security Considerations

### ✅ **Do:**

- Use environment variables for credentials
- Store tokens in system environment variables (most secure)
- Add `.env` to `.gitignore`
- Use workspace settings for team sharing (without credentials)
- Rotate Notion API token periodically

### ❌ **Don't:**

- Hardcode tokens in `.vscode/settings.json`
- Commit `.env` files to git
- Share tokens in plain text (Slack, email)
- Use production tokens for development testing

---

## Alternative: Use Existing Scripts (No MCP Required)

If MCP setup is too complex, you can continue using the existing scripts:

```powershell
# Query Notion directly
cd scripts
node notion-to-yaml.js --db-id $env:NOTION_SECRETS_DB_ID --filter all --output secrets.yaml

# View secrets
Get-Content secrets.yaml

# Clean up
Remove-Item secrets.yaml
```

This approach works without MCP but requires manual script execution.

---

## Next Steps

After MCP is configured:

1. **Test MCP access**: Ask Copilot to list secrets
2. **Compare with Terraform**: Use MCP to audit missing secrets
3. **Automate workflows**: Use MCP for secrets management tasks

---

## Related Documentation

- [terraform-notion-secrets-audit.md](../archive/terraform-notion-secrets-audit.md) - Secret comparison
- [security-secrets-guide.md](../archive/security-secrets-guide.md) - Complete secrets management
- [terraform-cloud-setup.md](../archive/terraform-cloud-setup.md) - Terraform Cloud setup

---

## Quick Start Commands

```powershell
# 1. Install MCP server
npm install -g @modelcontextprotocol/server-notion

# 2. Set environment variables (choose one method above)
$env:NOTION_API_TOKEN = "your-token"
$env:NOTION_SECRETS_DB_ID = "your-db-id"

# 3. Create workspace settings
mkdir -Force .vscode
@"
{
  "github.copilot.chat.mcp.servers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-notion"],
      "env": {
        "NOTION_API_KEY": "`${env:NOTION_API_TOKEN}",
        "NOTION_DATABASE_ID": "`${env:NOTION_SECRETS_DB_ID}"
      }
    }
  }
}
"@ | Out-File -FilePath .vscode/settings.json -Encoding utf8

# 4. Restart VS Code

# 5. Test in Copilot Chat
# @workspace list notion secrets
```
