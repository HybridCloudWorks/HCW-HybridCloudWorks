# =============================================================================
# dns.tf — the lab host's public names in the hybridcloudworks.com zone
#
# Same resource type and v5 conventions as infra/frontend.tf: `name` is the
# full record name, and `ttl` is a real value because `1` (automatic) is only
# accepted on proxied records.
#
# All four are DNS-only (proxied = false). A second-level wildcard such as
# *.coder.lab is outside Cloudflare's Universal SSL, and Caddy on the host
# terminates TLS for every lab name with its own certificate (ADR 0032), so
# Cloudflare must hand out the host's address rather than its own.
#
# Why four records and not three. Cloudflare follows RFC 4592: a wildcard does
# not answer for a name that is an empty non-terminal, and the *.coder.lab
# record below makes coder.lab exactly that. Without its own record,
# coder.lab.hybridcloudworks.com (Coder's URL, the CODER-URL value in Key
# Vault) would return no address even though *.lab exists
# (developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records).
#
# No _acme-challenge records, on purpose. ADR 0032 chooses DNS-01 by CNAME
# delegation into a dedicated lab zone, and that zone does not exist yet
# (owner decision 2026-09-25: no separate lab zone for now). Until it does,
# Caddy's runtime token has DNS edit on this production zone and writes its
# TXT challenges here directly, which is the interim risk the ADR accepts:
# docs/decisions/0032-learner-labs-platform.md, Consequences, the bullet on
# zone-scoped Cloudflare tokens. When the lab zone exists, the two
# _acme-challenge CNAMEs are added in this file and the runtime token is
# re-issued against the lab zone.
# =============================================================================

locals {
  # Everything below points at the one A record, so moving the host is a
  # change to one address.
  lab_records = {
    wildcard       = "*.${var.lab_hostname}"
    coder          = "coder.${var.lab_hostname}"
    coder_wildcard = "*.coder.${var.lab_hostname}"
  }
}

resource "cloudflare_dns_record" "lab" {
  zone_id = var.cloudflare_zone_id
  name    = var.lab_hostname
  content = hostinger_vps.lab.ipv4_address
  type    = "A"
  proxied = false
  ttl     = 300
  comment = "HCW lab host (Hostinger VPS), managed by infra-lab"

  lifecycle {
    # The provider sets ipv4_address to "" when the API lists no IPv4 address.
    # Fail the plan with a reason rather than send Cloudflare an empty A record.
    precondition {
      condition     = can(regex("^((25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\\.){3}(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])$", hostinger_vps.lab.ipv4_address))
      error_message = "The adopted Hostinger VM reports no IPv4 address, so the lab A record cannot be written. Check the VM in hPanel; nothing has been changed."
    }
  }
}

resource "cloudflare_dns_record" "lab_alias" {
  for_each = local.lab_records

  zone_id = var.cloudflare_zone_id
  name    = each.value
  content = cloudflare_dns_record.lab.name
  type    = "CNAME"
  proxied = false
  ttl     = 300
  comment = "HCW lab host alias, managed by infra-lab"
}
