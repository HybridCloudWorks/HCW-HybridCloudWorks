# =============================================================================
# outputs.tf — HCW K8s Infrastructure Outputs
# =============================================================================

output "vps_ipv4" {
  description = "KVM4 VPS public IPv4 address"
  value       = var.vps_ipv4
}

output "ssh_key_id" {
  description = "Hostinger SSH key resource ID"
  value       = hostinger_vps_ssh_key.deploy_key.id
}

output "ssh_connection" {
  description = "SSH connection command"
  value       = "ssh -i ~/.ssh/hybridcloudworks_deploy root@${var.vps_ipv4}"
}

output "dns_records" {
  description = "Cloudflare DNS record IDs"
  value = merge(
    { for k, v in cloudflare_record.proxied : k => v.id },
    { for k, v in cloudflare_record.direct  : k => v.id },
    { "root" = cloudflare_record.root.id }
  )
}

output "service_urls" {
  description = "Service URLs (available after Ansible + ArgoCD deployment)"
  value = {
    api        = "https://api.${var.domain}"
    auth       = "https://auth.${var.domain}"
    argocd     = "https://argocd.${var.domain}"
    monitoring = "https://monitoring.${var.domain}"
    vault      = "https://vault.${var.domain}"
  }
}

output "ansible_inventory" {
  description = "Ansible inventory entry — reflects current TF Cloud vps_ipv4 value"
  value       = <<-EOT
    all:
      children:
        k8s_nodes:
          hosts:
            kvm4:
              ansible_host: ${var.vps_ipv4}
              ansible_user: root
              ansible_ssh_private_key_file: ~/.ssh/hybridcloudworks_deploy
  EOT
}

output "next_steps" {
  description = "Next steps after Terraform apply"
  value       = <<-EOT

    ✅ Terraform apply complete!

    VPS IP: ${var.vps_ipv4}

    Next steps:
    1. Run Ansible bootstrap:
       cd platform/ansible
       ansible-playbook site.yml

    2. After Ansible completes, ArgoCD takes over at:
       https://argocd.${var.domain}

    3. Verify all services:
       https://api.${var.domain}/health
       https://vault.${var.domain}
       https://monitoring.${var.domain}

  EOT
}
