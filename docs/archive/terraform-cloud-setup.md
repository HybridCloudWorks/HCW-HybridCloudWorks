# Terraform Cloud Setup Guide

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 26, 2026
**Persona:** GPCA + GHE
**Status:** Active ✅

## Overview

This guide walks you through setting up Terraform Cloud for the HCW platform infrastructure
deployment, including configuring all required variables and secrets.

## Prerequisites

- [ ] Terraform Cloud account ([app.terraform.io](https://app.terraform.io))
- [ ] Hostinger API token
- [ ] Cloudflare API token and Zone ID
- [ ] SSH key pair generated
- [ ] Access to all service credentials

---

## Step 1: Create Terraform Cloud Workspace

1. **Log in to Terraform Cloud**: Visit [app.terraform.io](https://app.terraform.io)

2. **Create a new workspace**:
   - Click **"New Workspace"**
   - Select **"Version control workflow"** (recommended) or **"CLI-driven workflow"**
   - Connect to your GitHub repository: `saulpatinojr/Personal-Site_HCW`
   - Set working directory: `platform/terraform`
   - Name the workspace: `hcw-infrastructure-prod`

3. **Configure workspace settings**:
   - Go to **Settings → General**
   - Execution Mode: **Remote**
   - Terraform Version: **1.5+** (latest stable)
   - Auto Apply: **Disabled** (manual approval recommended for production)

---

## Step 2: Configure Terraform Variables

Navigate to your workspace → **Variables** tab.

### Variable Types in Terraform Cloud

- **Terraform Variables**: Input variables used in your `.tf` files (from `variables.tf`)
- **Environment Variables**: System-level variables (for provider authentication, CLI tools)

### Required Variables Configuration

#### **Category: Terraform Variables** (marked as `Terraform variable`)

Add each variable with the following settings:

| Variable Name            | Value                      | Sensitive | HCL   | Description            |
| ------------------------ | -------------------------- | --------- | ----- | ---------------------- |
| `hostinger_api_token`    | `your-hostinger-token`     | ✅ Yes    | ❌ No | Hostinger API token    |
| `cloudflare_api_token`   | `your-cloudflare-token`    | ✅ Yes    | ❌ No | Cloudflare API token   |
| `cloudflare_zone_id`     | `your-zone-id`             | ❌ No     | ❌ No | Cloudflare Zone ID     |
| `ssh_public_key`         | `ssh-rsa AAAA...`          | ❌ No     | ❌ No | Your SSH public key    |
| `vps_plan`               | `kvm4`                     | ❌ No     | ❌ No | VPS plan type          |
| `datacenter`             | `us`                       | ❌ No     | ❌ No | Datacenter location    |
| `hostname`               | `hcw-prod`                 | ❌ No     | ❌ No | VPS hostname           |
| `domain`                 | `hybridcloudworks.com`     | ❌ No     | ❌ No | Base domain            |
| `db_password`            | `generate-secure-password` | ✅ Yes    | ❌ No | PostgreSQL password    |
| `n8n_encryption_key`     | `generate-with-openssl`    | ✅ Yes    | ❌ No | n8n encryption key     |
| `n8n_admin_user`         | `admin`                    | ❌ No     | ❌ No | n8n admin username     |
| `n8n_admin_password`     | `secure-password`          | ✅ Yes    | ❌ No | n8n admin password     |
| `grafana_admin_user`     | `admin`                    | ❌ No     | ❌ No | Grafana admin username |
| `grafana_admin_password` | `secure-password`          | ✅ Yes    | ❌ No | Grafana admin password |

#### **Category: Environment Variables** (marked as `Environment variable`)

These are used by Terraform CLI and providers:

| Variable Name | Value                        | Sensitive | Description                              |
| ------------- | ---------------------------- | --------- | ---------------------------------------- |
| `TFE_TOKEN`   | `your-terraform-cloud-token` | ✅ Yes    | Terraform Cloud API token (if using CLI) |

---

## Step 3: How to Add Variables in Terraform Cloud UI

### Method 1: Web UI (Recommended for First-Time Setup)

1. **Navigate to Variables**:
   - Open your workspace
   - Click **"Variables"** in the left sidebar

2. **Add a Variable**:
   - Click **"+ Add variable"**
   - Choose type: **"Terraform variable"** or **"Environment variable"**
   - Enter variable name (exact match from table above)
   - Enter value
   - Check **"Sensitive"** if marked in table above
   - Check **"HCL"** if the value is HCL code (arrays, objects) - typically ❌ No for your use case
   - Click **"Save variable"**

3. **Repeat** for all variables in the tables above

### Method 2: Terraform Cloud API (Bulk Upload)

If you have many variables, you can use the API:

```bash
# Set your Terraform Cloud token
$TFC_TOKEN = "your-terraform-cloud-api-token"
$ORG_NAME = "your-org-name"
$WORKSPACE_NAME = "hcw-infrastructure-prod"

# Get workspace ID
$WORKSPACE_ID = (Invoke-RestMethod -Uri "https://app.terraform.io/api/v2/organizations/$ORG_NAME/workspaces/$WORKSPACE_NAME" -Headers @{"Authorization"="Bearer $TFC_TOKEN"}).data.id

# Create a variable (example)
$body = @{
  data = @{
    type = "vars"
    attributes = @{
      key = "hostinger_api_token"
      value = "your-actual-token-here"
      category = "terraform"
      sensitive = $true
    }
  }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method POST -Uri "https://app.terraform.io/api/v2/workspaces/$WORKSPACE_ID/vars" -Headers @{"Authorization"="Bearer $TFC_TOKEN"; "Content-Type"="application/vnd.api+json"} -Body $body
```

### Method 3: Terraform CLI with Variable Sets

Create reusable variable sets for shared values:

1. Go to **Organization Settings → Variable Sets**
2. Click **"Create variable set"**
3. Name it (e.g., "HCW Shared Credentials")
4. Add variables
5. Apply to selected workspaces

---

## Step 4: Generate Missing Secrets

### SSH Key Pair (if not already generated)

```powershell
# Generate SSH key pair
ssh-keygen -t rsa -b 4096 -C "terraform@hybridcloudworks.com" -f ~/.ssh/hybridcloudworks_deploy

# Display public key (copy this value)
Get-Content ~/.ssh/hybridcloudworks_deploy.pub
```

### n8n Encryption Key

```powershell
# Generate random hex key (32 bytes = 64 hex characters)
openssl rand -hex 32
```

### Secure Passwords

```powershell
# Generate secure password (PowerShell)
Add-Type -AssemblyName System.Web
[System.Web.Security.Membership]::GeneratePassword(32, 8)
```

---

## Step 5: Finding Your Values

### Hostinger API Token

1. Log in to [Hostinger](https://www.hostinger.com)
2. Go to **VPS → API**
3. Generate new API token
4. Copy token (shown only once)

### Cloudflare API Token

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Go to **My Profile → API Tokens**
3. Click **"Create Token"**
4. Use **"Edit zone DNS"** template
5. Scope to specific zone: `hybridcloudworks.com`
6. Create and copy token

### Cloudflare Zone ID

1. Open [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select domain: **hybridcloudworks.com**
3. Scroll down on Overview page
4. Find **"Zone ID"** in the right sidebar (under API section)
5. Copy the value

### VPS IPv4 & VPS ID

**Note:** These are **outputs** from Terraform, not inputs. After your first `terraform apply`:

1. VPS will be created by Terraform
2. Check **Outputs** tab in Terraform Cloud after apply
3. Or run: `terraform output vps_ipv4`

If you already have a VPS and want to import it:

```powershell
# Find VPS ID in Hostinger panel
# Import existing resource
terraform import hostinger_vps.main <vps-id>
```

---

## Step 6: Verify Configuration

### Pre-flight Checklist

Before running Terraform:

- [ ] All required variables are set in Terraform Cloud
- [ ] Sensitive variables are marked as sensitive
- [ ] SSH public key format is correct (`ssh-rsa AAAA...`)
- [ ] Cloudflare API token has DNS edit permissions
- [ ] Hostinger API token is valid and not expired
- [ ] Generated secrets are stored securely (password manager)

### Test Configuration

1. **Navigate to your workspace**
2. **Click "Actions" → "Start new plan"**
3. Review the plan output
4. Check for any missing variables (Terraform will error if required vars are missing)

---

## Step 7: Running Terraform

### Option A: Terraform Cloud UI

1. Go to your workspace
2. Click **"Actions" → "Start new plan"**
3. Review plan output
4. If approved, click **"Confirm & Apply"**

### Option B: Terraform CLI (Local)

```powershell
# Login to Terraform Cloud
terraform login

# Initialize
cd platform/terraform
terraform init

# Plan
terraform plan

# Apply
terraform apply
```

---

## Variable Management Best Practices

### Security

✅ **Do:**

- Mark all API tokens, passwords, and keys as **Sensitive**
- Use variable sets for shared credentials across workspaces
- Rotate credentials regularly (update in Terraform Cloud)
- Store backup of secrets in password manager (1Password, Bitwarden)

❌ **Don't:**

- Commit `terraform.tfvars` to version control
- Share sensitive values in plain text (Slack, email)
- Use production credentials in development workspaces

### Organization

- **Naming Convention**: Use exact variable names from `variables.tf`
- **Descriptions**: Add descriptions in Terraform Cloud UI for team members
- **Variable Sets**: Group related variables (e.g., "Cloudflare Credentials", "Database Secrets")
- **Workspaces**: Separate workspaces for `prod`, `staging`, `dev`

---

## Troubleshooting

### Error: "Required variable not set"

**Solution:** Check that variable name in Terraform Cloud exactly matches `variables.tf`:

- Variable names are case-sensitive
- Check for typos (e.g., `cloudflare_zone_id` vs `cloudflare_zone_ID`)

### Error: "Invalid SSH key format"

**Solution:** Ensure you copied the **public key** (`.pub` file), not private key:

```powershell
# Correct format starts with:
ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQ...
```

### Error: "Cloudflare authentication failed"

**Solution:** Verify token permissions:

1. Token must have **Zone:DNS:Edit** permission
2. Token must be scoped to correct zone
3. Check token hasn't expired

### Error: "Hostinger API authentication failed"

**Solution:**

1. Verify token is valid in Hostinger panel
2. Check token hasn't been revoked
3. Ensure API access is enabled for your account

---

## Next Steps

After Terraform Cloud is configured:

1. **Run Initial Plan**: `terraform plan` to verify configuration
2. **Review Resources**: Check what will be created before applying
3. **Apply Changes**: `terraform apply` to provision infrastructure
4. **Configure DNS**: Cloudflare DNS records will be created automatically
5. **Deploy Application**: Proceed with deployment workflows

---

## Related Documentation

- [pipeline-deployment-guide.md](../archive/pipeline-deployment-guide.md) - Full deployment pipeline
- [architecture-infrastructure-complete.md](../archive/architecture-infrastructure-complete.md) -
  Infrastructure overview
- Platform Terraform configuration: `platform/terraform/`

---

## Quick Reference Card

### Essential Commands

```powershell
# Initialize Terraform
terraform init

# Validate configuration
terraform validate

# Plan changes
terraform plan

# Apply changes
terraform apply

# Show outputs
terraform output

# List workspaces
terraform workspace list

# Select workspace
terraform workspace select prod
```

### Terraform Cloud URLs

- **Dashboard**: https://app.terraform.io
- **Your Org**: https://app.terraform.io/app/YOUR_ORG/workspaces
- **API Docs**: https://developer.hashicorp.com/terraform/cloud-docs/api-docs

---

**Questions? Issues?**
Refer to [Terraform Cloud Documentation](https://developer.hashicorp.com/terraform/cloud-docs) or
check the workspace run logs for detailed error messages.
