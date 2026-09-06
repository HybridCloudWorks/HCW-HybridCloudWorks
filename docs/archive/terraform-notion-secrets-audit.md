# Terraform Cloud & Notion Secrets Audit

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 26, 2026
**Status:** Audit Report
**Persona:** GPCA + KCS

## Executive Summary

This document compares **Terraform Cloud variables** (needed for infrastructure deployment) with
**Notion Secrets Database** entries (source of truth for secrets management).

---

## Required Terraform Variables

Based on `platform/terraform/variables.tf`, these variables are required:

### Category: Infrastructure Credentials

| Terraform Variable     | Required? | Sensitive | Notion Field Name       | Should Be in Notion? | Notes                                             |
| ---------------------- | --------- | --------- | ----------------------- | -------------------- | ------------------------------------------------- |
| `hostinger_api_token`  | ✅ YES    | ✅ YES    | `HOSTINGER_API_TOKEN`   | ✅ YES               | Hostinger VPS provisioning                        |
| `cloudflare_api_token` | ✅ YES    | ✅ YES    | `CLOUDFLARE_API_TOKEN`  | ✅ YES               | DNS management                                    |
| `cloudflare_zone_id`   | ✅ YES    | ❌ No     | `CLOUDFLARE_ZONE_ID`    | ✅ YES               | Zone identifier (not secret but stored centrally) |
| `ssh_public_key`       | ✅ YES    | ❌ No     | `SSH_PUBLIC_KEY_DEPLOY` | ✅ YES               | VPS access key                                    |

### Category: VPS Configuration (Optional - Has Defaults)

| Terraform Variable | Default                | Should Be in Notion? | Notes                          |
| ------------------ | ---------------------- | -------------------- | ------------------------------ |
| `vps_plan`         | `kvm4`                 | ⚠️ OPTIONAL          | Only if different from default |
| `datacenter`       | `us`                   | ⚠️ OPTIONAL          | Only if different from default |
| `os_id`            | `ubuntu_22_04`         | ⚠️ OPTIONAL          | Only if different from default |
| `hostname`         | `hcw-prod`             | ⚠️ OPTIONAL          | Only if different from default |
| `domain`           | `hybridcloudworks.com` | ⚠️ OPTIONAL          | Only if different from default |

### Category: Application Credentials

| Terraform Variable        | Required?   | Sensitive | Notion Field Name                    | Should Be in Notion? | Generate Command          |
| ------------------------- | ----------- | --------- | ------------------------------------ | -------------------- | ------------------------- |
| `db_password`             | ✅ YES      | ✅ YES    | `DB_PASSWORD` or `POSTGRES_PASSWORD` | ✅ YES               | `openssl rand -base64 32` |
| `n8n_encryption_key`      | ✅ YES      | ✅ YES    | `N8N_ENCRYPTION_KEY`                 | ✅ YES               | `openssl rand -hex 32`    |
| `n8n_admin_user`          | ❌ Optional | ❌ No     | `N8N_ADMIN_USER`                     | ⚠️ OPTIONAL          | Default: `admin`          |
| `n8n_admin_password`      | ✅ YES      | ✅ YES    | `N8N_ADMIN_PASSWORD`                 | ✅ YES               | `openssl rand -base64 32` |
| `grafana_admin_user`      | ❌ Optional | ❌ No     | `GRAFANA_ADMIN_USER`                 | ⚠️ OPTIONAL          | Default: `admin`          |
| `grafana_admin_password`  | ✅ YES      | ✅ YES    | `GRAFANA_ADMIN_PASSWORD`             | ✅ YES               | `openssl rand -base64 32` |
| `traefik_password`        | ✅ YES      | ✅ YES    | `TRAEFIK_PASSWORD`                   | ✅ YES               | `openssl rand -base64 32` |
| `keycloak_admin_user`     | ❌ Optional | ❌ No     | `KEYCLOAK_ADMIN_USER`                | ⚠️ OPTIONAL          | Default: `admin`          |
| `keycloak_admin_password` | ✅ YES      | ✅ YES    | `KEYCLOAK_ADMIN_PASSWORD`            | ✅ YES               | `openssl rand -base64 32` |

---

## Notion Database Required Secrets

These should exist in your Notion Secrets Database with proper metadata:

### Infrastructure Category

| Secret Name             | Category       | Environment | TargetVPS | TargetGitHub | TargetFirebase | CanAutoRotate | Description                                         |
| ----------------------- | -------------- | ----------- | --------- | ------------ | -------------- | ------------- | --------------------------------------------------- |
| `HOSTINGER_API_TOKEN`   | Infrastructure | Production  | ✅        | ✅           | ❌             | ❌            | Hostinger API token for VPS provisioning            |
| `CLOUDFLARE_API_TOKEN`  | Infrastructure | Production  | ✅        | ✅           | ❌             | ❌            | Cloudflare API token with Zone DNS Edit permissions |
| `CLOUDFLARE_ZONE_ID`    | Infrastructure | Production  | ✅        | ✅           | ❌             | ❌            | Cloudflare Zone ID for hybridcloudworks.com         |
| `SSH_PUBLIC_KEY_DEPLOY` | Infrastructure | Production  | ✅        | ❌           | ❌             | ❌            | SSH public key for VPS access (RSA 4096-bit)        |

### Database Category

| Secret Name         | Category | Environment | TargetVPS | TargetGitHub | TargetFirebase | CanAutoRotate | Description                              |
| ------------------- | -------- | ----------- | --------- | ------------ | -------------- | ------------- | ---------------------------------------- |
| `DB_PASSWORD`       | Database | Production  | ✅        | ❌           | ❌             | ✅            | PostgreSQL admin password                |
| `POSTGRES_PASSWORD` | Database | Production  | ✅        | ❌           | ❌             | ✅            | Alternative name for PostgreSQL password |

### Application Services Category

| Secret Name               | Category    | Environment | TargetVPS | TargetGitHub | TargetFirebase | CanAutoRotate | Description                                |
| ------------------------- | ----------- | ----------- | --------- | ------------ | -------------- | ------------- | ------------------------------------------ |
| `N8N_ENCRYPTION_KEY`      | Application | Production  | ✅        | ❌           | ❌             | ✅            | n8n workflow encryption key (64 hex chars) |
| `N8N_ADMIN_USER`          | Application | Production  | ✅        | ❌           | ❌             | ❌            | n8n admin username                         |
| `N8N_ADMIN_PASSWORD`      | Application | Production  | ✅        | ❌           | ❌             | ✅            | n8n admin password                         |
| `GRAFANA_ADMIN_USER`      | Application | Production  | ✅        | ❌           | ❌             | ❌            | Grafana admin username                     |
| `GRAFANA_ADMIN_PASSWORD`  | Application | Production  | ✅        | ❌           | ❌             | ✅            | Grafana admin password                     |
| `TRAEFIK_PASSWORD`        | Application | Production  | ✅        | ❌           | ❌             | ✅            | Traefik dashboard password                 |
| `KEYCLOAK_ADMIN_USER`     | Application | Production  | ✅        | ❌           | ❌             | ❌            | Keycloak admin username                    |
| `KEYCLOAK_ADMIN_PASSWORD` | Application | Production  | ✅        | ❌           | ❌             | ✅            | Keycloak admin password                    |

---

## How to Check What's Missing

### Option 1: Query Notion Database (Recommended)

```powershell
# Set your Notion API token temporarily
$env:NOTION_API_TOKEN = "your-notion-token"

# Query database
cd scripts
node notion-to-yaml.js --db-id $env:NOTION_SECRETS_DB_ID --output temp-check.yaml --filter all

# View secrets
Get-Content temp-check.yaml | Select-String "^[A-Z_]+:"

# Clean up
Remove-Item temp-check.yaml
Remove-Item env:NOTION_API_TOKEN
```

### Option 2: Manual Notion Database Check

1. Open your Notion Secrets Database
2. Filter by: `Environment = Production` AND `TargetVPS = ✅`
3. Check if these secrets exist with correct names

---

## Common Missing Secrets

Based on typical setups, you're most likely missing:

### 🔴 **CRITICAL - Likely Missing:**

1. **HOSTINGER_API_TOKEN** - External API, must create in Hostinger panel
2. **CLOUDFLARE_API_TOKEN** - External API, must create in Cloudflare dashboard
3. **CLOUDFLARE_ZONE_ID** - Get from Cloudflare dashboard
4. **SSH_PUBLIC_KEY_DEPLOY** - Generate SSH key pair
5. **TRAEFIK_PASSWORD** - Generate random password

### 🟡 **MODERATE - May Have Different Names:**

6. **DB_PASSWORD** vs **POSTGRES_PASSWORD** - You might have one but not the other
7. **N8N_ENCRYPTION_KEY** - Needs to be 64 hex characters (specific format)

### 🟢 **LOW - Likely Already Have:**

8. **N8N_ADMIN_PASSWORD** - Probably exists
9. **GRAFANA_ADMIN_PASSWORD** - Probably exists
10. **KEYCLOAK_ADMIN_PASSWORD** - Probably exists

---

## Step-by-Step: Add Missing Secrets to Notion

### 1. Get Hostinger API Token

```powershell
# Steps:
# 1. Login to Hostinger Panel: https://www.hostinger.com
# 2. Navigate to: VPS → API
# 3. Click "Generate New API Token"
# 4. Copy the token (shown only once!)
# 5. Add to Notion:
#    - Name: HOSTINGER_API_TOKEN
#    - Value: <paste-token>
#    - Category: Infrastructure
#    - Environment: Production
#    - TargetVPS: ✅
#    - TargetGitHub: ✅
#    - CanAutoRotate: ❌
```

### 2. Get Cloudflare API Token

```powershell
# Steps:
# 1. Login to Cloudflare: https://dash.cloudflare.com
# 2. Go to: My Profile → API Tokens
# 3. Click "Create Token"
# 4. Use template: "Edit zone DNS"
# 5. Select zones: hybridcloudworks.com
# 6. Click "Continue to summary" → "Create Token"
# 7. Copy token (shown only once!)
# 8. Add to Notion:
#    - Name: CLOUDFLARE_API_TOKEN
#    - Value: <paste-token>
#    - Category: Infrastructure
#    - Environment: Production
#    - TargetVPS: ✅
#    - TargetGitHub: ✅
#    - CanAutoRotate: ❌
```

### 3. Get Cloudflare Zone ID

```powershell
# Steps:
# 1. Login to Cloudflare: https://dash.cloudflare.com
# 2. Select: hybridcloudworks.com
# 3. Scroll down on Overview page
# 4. Find "Zone ID" in right sidebar (API section)
# 5. Copy the ID
# 6. Add to Notion:
#    - Name: CLOUDFLARE_ZONE_ID
#    - Value: <paste-zone-id>
#    - Category: Infrastructure
#    - Environment: Production
#    - TargetVPS: ✅
#    - TargetGitHub: ✅
#    - CanAutoRotate: ❌
```

### 4. Generate SSH Public Key

```powershell
# Generate key pair
ssh-keygen -t rsa -b 4096 -C "deploy@hybridcloudworks.com" -f ~/.ssh/hcw_deploy

# Display public key
Get-Content ~/.ssh/hcw_deploy.pub

# Copy the entire output and add to Notion:
# - Name: SSH_PUBLIC_KEY_DEPLOY
# - Value: ssh-rsa AAAAB3NzaC1yc2EAAA... (entire line)
# - Category: Infrastructure
# - Environment: Production
# - TargetVPS: ✅
# - CanAutoRotate: ❌

# IMPORTANT: Also save private key securely!
# The private key (~/.ssh/hcw_deploy) should NEVER go into Notion
# Keep it in your password manager
```

### 5. Generate Application Passwords

```powershell
# DB Password
$dbPass = openssl rand -base64 32
Write-Host "DB_PASSWORD: $dbPass"

# n8n Encryption Key (must be hex)
$n8nKey = openssl rand -hex 32
Write-Host "N8N_ENCRYPTION_KEY: $n8nKey"

# n8n Admin Password
$n8nPass = openssl rand -base64 32
Write-Host "N8N_ADMIN_PASSWORD: $n8nPass"

# Grafana Admin Password
$grafanaPass = openssl rand -base64 32
Write-Host "GRAFANA_ADMIN_PASSWORD: $grafanaPass"

# Traefik Password
$traefikPass = openssl rand -base64 32
Write-Host "TRAEFIK_PASSWORD: $traefikPass"

# Keycloak Admin Password
$keycloakPass = openssl rand -base64 32
Write-Host "KEYCLOAK_ADMIN_PASSWORD: $keycloakPass"

# Add each to Notion with:
# - Category: Application (or Database for DB_PASSWORD)
# - Environment: Production
# - TargetVPS: ✅
# - CanAutoRotate: ✅ (for all passwords)
```

---

## Notion Database Schema Requirements

Your Notion database must have these properties:

### Required Properties:

| Property Name    | Type         | Options/Format                                                   |
| ---------------- | ------------ | ---------------------------------------------------------------- |
| `Name`           | Title        | Secret variable name (e.g., `HOSTINGER_API_TOKEN`)               |
| `Value`          | Text         | Secret value OR `[IN FILES]`                                     |
| `Files`          | Files        | Attachment (if Value = `[IN FILES]`)                             |
| `Category`       | Select       | Infrastructure, Database, Application, AI, Integration, Frontend |
| `Environment`    | Multi-Select | Production, Staging, Development                                 |
| `TargetVPS`      | Checkbox     | ✅ = Deploy to VPS                                               |
| `TargetGitHub`   | Checkbox     | ✅ = Add to GitHub Secrets                                       |
| `TargetFirebase` | Checkbox     | ✅ = Add to Firebase Secret Manager                              |
| `CanAutoRotate`  | Checkbox     | ✅ = Can be auto-rotated                                         |
| `RotationPolicy` | Select       | Monthly, Quarterly, Annually, Never                              |
| `LastRotated`    | Date         | Auto-updated by rotation script                                  |
| `NextRotation`   | Date         | Next scheduled rotation date                                     |

---

## Validation Checklist

After adding secrets to Notion:

- [ ] All **CRITICAL** secrets exist in Notion
- [ ] Secret names match exactly (case-sensitive)
- [ ] `TargetVPS` checked for all VPS-related secrets
- [ ] `TargetGitHub` checked for CI/CD secrets
- [ ] `Environment` set to `Production`
- [ ] `Category` set appropriately
- [ ] `CanAutoRotate` set correctly (external APIs = ❌, generated passwords = ✅)
- [ ] SSH **public** key in Notion (NOT private key)
- [ ] All sensitive values stored in Notion (not in plain text files)

---

## Next Steps

1. **Add missing secrets to Notion** (see above for how to get each)
2. **Run notion-to-yaml** to verify all secrets are accessible
3. **Sync to GitHub Actions**: Run workflow `secret-sync.yml`
4. **Add to Terraform Cloud**: Follow [terraform-cloud-setup.md](../archive/terraform-cloud-setup.md)

---

## Related Documentation

- [terraform-cloud-setup.md](../archive/terraform-cloud-setup.md) - How to set variables in Terraform Cloud
- [security-secrets-guide.md](../archive/security-secrets-guide.md) - Complete secrets management guide
- [agents-architecture-reference.md](../archive/agents-architecture-reference.md) - Secrets rotation and
  lifecycle

---

## Quick Reference Commands

```powershell
# Check Notion secrets
$env:NOTION_API_TOKEN = "ntn_xxx"
cd scripts
node notion-to-yaml.js --db-id $env:NOTION_SECRETS_DB_ID --filter all --output temp.yaml
Get-Content temp.yaml | Select-String "^[A-Z_]+"
Remove-Item temp.yaml

# Generate all passwords at once
Write-Host "DB_PASSWORD: $(openssl rand -base64 32)"
Write-Host "N8N_ENCRYPTION_KEY: $(openssl rand -hex 32)"
Write-Host "N8N_ADMIN_PASSWORD: $(openssl rand -base64 32)"
Write-Host "GRAFANA_ADMIN_PASSWORD: $(openssl rand -base64 32)"
Write-Host "TRAEFIK_PASSWORD: $(openssl rand -base64 32)"
Write-Host "KEYCLOAK_ADMIN_PASSWORD: $(openssl rand -base64 32)"

# Generate SSH key
ssh-keygen -t rsa -b 4096 -C "deploy@hcw" -f ~/.ssh/hcw_deploy
Get-Content ~/.ssh/hcw_deploy.pub
```
