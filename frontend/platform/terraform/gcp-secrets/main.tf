# ============================================================================
# HCW Container Stack - Google Secret Manager Integration
# ============================================================================
# Creates secrets in Google Secret Manager for production use.
# Secrets can be accessed by Firebase Functions, Cloud Run, and GKE.
#
# Usage:
#   terraform init
#   terraform plan -var-file="secrets.auto.tfvars"
#   terraform apply -var-file="secrets.auto.tfvars"
# ============================================================================

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

# ============================================================================
# Variables
# ============================================================================

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

# Secret values - passed via tfvars or environment
variable "cloudflare_api_token" {
  description = "Cloudflare DNS API Token"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL database password"
  type        = string
  sensitive   = true
}

variable "n8n_encryption_key" {
  description = "n8n encryption key"
  type        = string
  sensitive   = true
}

variable "n8n_admin_password" {
  description = "n8n admin password"
  type        = string
  sensitive   = true
}

variable "grafana_admin_password" {
  description = "Grafana admin password"
  type        = string
  sensitive   = true
}

variable "openai_api_key" {
  description = "OpenAI API key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "perplexity_api_key" {
  description = "Perplexity API key"
  type        = string
  sensitive   = true
  default     = ""
}

variable "anthropic_api_key" {
  description = "Anthropic/Claude API key"
  type        = string
  sensitive   = true
  default     = ""
}

# ============================================================================
# Provider Configuration
# ============================================================================

provider "google" {
  project = var.project_id
  region  = var.region
}

# ============================================================================
# Enable Secret Manager API
# ============================================================================

resource "google_project_service" "secretmanager" {
  project = var.project_id
  service = "secretmanager.googleapis.com"

  disable_on_destroy = false
}

# ============================================================================
# Infrastructure Secrets (for VPS/Docker)
# ============================================================================

resource "google_secret_manager_secret" "cloudflare_token" {
  secret_id = "cloudflare-dns-api-token"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = "production"
    component   = "infrastructure"
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "cloudflare_token" {
  secret      = google_secret_manager_secret.cloudflare_token.id
  secret_data = var.cloudflare_api_token
}

resource "google_secret_manager_secret" "db_password" {
  secret_id = "postgres-db-password"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = "production"
    component   = "database"
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = var.db_password
}

resource "google_secret_manager_secret" "n8n_encryption_key" {
  secret_id = "n8n-encryption-key"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = "production"
    component   = "automation"
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "n8n_encryption_key" {
  secret      = google_secret_manager_secret.n8n_encryption_key.id
  secret_data = var.n8n_encryption_key
}

resource "google_secret_manager_secret" "n8n_admin_password" {
  secret_id = "n8n-admin-password"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = "production"
    component   = "automation"
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "n8n_admin_password" {
  secret      = google_secret_manager_secret.n8n_admin_password.id
  secret_data = var.n8n_admin_password
}

resource "google_secret_manager_secret" "grafana_admin_password" {
  secret_id = "grafana-admin-password"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = "production"
    component   = "monitoring"
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "grafana_admin_password" {
  secret      = google_secret_manager_secret.grafana_admin_password.id
  secret_data = var.grafana_admin_password
}

# ============================================================================
# AI API Keys (for Firebase Functions)
# ============================================================================

resource "google_secret_manager_secret" "openai_key" {
  count     = var.openai_api_key != "" ? 1 : 0
  secret_id = "openai-api-key"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = "production"
    component   = "ai"
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "openai_key" {
  count       = var.openai_api_key != "" ? 1 : 0
  secret      = google_secret_manager_secret.openai_key[0].id
  secret_data = var.openai_api_key
}

resource "google_secret_manager_secret" "perplexity_key" {
  count     = var.perplexity_api_key != "" ? 1 : 0
  secret_id = "perplexity-api-key"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = "production"
    component   = "ai"
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "perplexity_key" {
  count       = var.perplexity_api_key != "" ? 1 : 0
  secret      = google_secret_manager_secret.perplexity_key[0].id
  secret_data = var.perplexity_api_key
}

resource "google_secret_manager_secret" "anthropic_key" {
  count     = var.anthropic_api_key != "" ? 1 : 0
  secret_id = "anthropic-api-key"
  project   = var.project_id

  replication {
    auto {}
  }

  labels = {
    environment = "production"
    component   = "ai"
  }

  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "anthropic_key" {
  count       = var.anthropic_api_key != "" ? 1 : 0
  secret      = google_secret_manager_secret.anthropic_key[0].id
  secret_data = var.anthropic_api_key
}

# ============================================================================
# IAM - Grant Firebase Functions access to secrets
# ============================================================================

data "google_project" "current" {
  project_id = var.project_id
}

# Grant Cloud Functions service account access to secrets
resource "google_secret_manager_secret_iam_member" "functions_access" {
  for_each = toset([
    google_secret_manager_secret.db_password.secret_id,
    google_secret_manager_secret.n8n_encryption_key.secret_id,
  ])

  project   = var.project_id
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

# ============================================================================
# Outputs
# ============================================================================

output "secret_ids" {
  description = "Created secret IDs"
  value = {
    cloudflare_token       = google_secret_manager_secret.cloudflare_token.secret_id
    db_password            = google_secret_manager_secret.db_password.secret_id
    n8n_encryption_key     = google_secret_manager_secret.n8n_encryption_key.secret_id
    n8n_admin_password     = google_secret_manager_secret.n8n_admin_password.secret_id
    grafana_admin_password = google_secret_manager_secret.grafana_admin_password.secret_id
  }
}

output "secret_access_command" {
  description = "Command to access secrets"
  value       = "gcloud secrets versions access latest --secret=SECRET_ID --project=${var.project_id}"
}
