---
name: infrastructure-terraform
description: Manage Azure infrastructure and deployments using Terraform for the FinOps platform
---

# Infrastructure & Terraform

Use this skill to:
- Plan and apply Terraform configurations
- Deploy to Azure Container Apps
- Manage SQL Server, storage, and Key Vault
- Configure monitoring and alerts
- Manage CI/CD pipelines

## Azure Resources Managed
- **Azure Container Apps** — API and worker deployments
- **Azure SQL Server** — Serverless database instances
- **Azure Storage** — Cost data staging and backups
- **Azure Key Vault** — Secrets management
- **Azure Monitor** — Alerting and logging
- **Application Insights** — Performance monitoring

## Terraform Structure
```
infra/terraform/azure/
├── main.tf              # Provider and backend config
├── variables.tf         # Input variables
├── outputs.tf           # Output values
├── container-apps.tf    # API and worker deployments
├── sql-server.tf        # Database instances
├── storage.tf           # Storage accounts
├── keyvault.tf          # Secrets and certificates
└── monitoring.tf        # Alerts and insights
```

## Common Tasks

### Plan Infrastructure Changes
```bash
cd infra/terraform/azure
terraform init
terraform plan -out=tfplan
```

### Apply Infrastructure Changes
```bash
terraform apply tfplan
```

### Check Current State
```bash
terraform state list
terraform state show 'azurerm_container_app.api'
```

### Manage Secrets
```bash
terraform import azurerm_key_vault_secret.db_password /subscriptions/.../secretName/dbPassword
```

### Destroy (Dev Only)
```bash
terraform destroy
```

## SQL Migrations in Terraform
SQL migrations are applied post-deployment:
```bash
terraform output -raw sql_connection_string | xargs -I {} npm run migrate:up -- --connection={}
```
