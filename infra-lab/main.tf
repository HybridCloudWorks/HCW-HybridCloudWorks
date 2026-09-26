# =============================================================================
# main.tf — the lab host: an EXISTING Hostinger VPS, adopted, never created
#
# The owner already has this server (#661, correction 2026-09-25). In the
# hostinger/hostinger provider, creating a hostinger_vps is
# POST /api/vps/v1/virtual-machines, Hostinger's PURCHASE endpoint
# (resourceHostingerVPSCreate -> PurchaseVPS, provider v0.1.23), and
# destroying one cancels its subscription (resourceHostingerVPSDelete ->
# CancelSubscription). So this resource must only ever be imported, updated in
# place, or left alone. Every guard below exists to keep a plan from showing
# `+ create`, `-/+ replace` or `- destroy` for it.
#
# What each attribute does on a change, read from the provider source at
# v0.1.23 (hostinger/vps_resource.go):
#
#   plan               ForceNew        replace = cancel subscription + purchase
#   data_center_id     ForceNew        replace = cancel subscription + purchase
#   password           ForceNew        replace = cancel subscription + purchase
#   template_id        in-place        POST .../recreate: REINSTALLS the OS,
#                                      wiping the disk
#   hostname           in-place        PUT .../hostname, a rename only
#   ssh_key_ids        in-place        attaches keys; never detaches
#   post_install_script_id             used only by purchase and by recreate;
#                                      setting it on a running VM runs nothing
#   payment_method_id                  used only by purchase
# =============================================================================

# Adopts the server the owner already has. Kept in the configuration after the
# first apply, where it is a no-op: an import block whose address is already in
# state does nothing. It stays as the record of where this resource came from,
# and so a rebuilt workspace (new state, same server) imports again instead of
# planning a purchase.
#
# The id is a variable, which Terraform accepts in an import block from 1.6.0
# (terraform.tf pins `~> 1.6` for that reason), so the VM id is a workspace
# value rather than a committed one.
import {
  to = hostinger_vps.lab
  id = var.hostinger_vps_id
}

resource "hostinger_vps" "lab" {
  # Required by the provider schema, so they must be set, and set to what the
  # server already is. They are ignored below, which makes them descriptive
  # here: the values the owner copied from the API (README step 1).
  plan           = var.hostinger_plan
  data_center_id = var.hostinger_data_center_id
  template_id    = var.hostinger_template_id

  # hostname is deliberately not set. It is Optional + Computed, so leaving it
  # out takes whatever the server has and plans no change; setting it to
  # var.lab_hostname would be a harmless rename, but it would also turn the
  # adoption plan's "0 to change" into "1 to change", and that count is the
  # owner's signal that nothing but the import is happening.
  #
  # password, post_install_script_id and payment_method_id are not set, for
  # the reasons in the table above. In particular there is no post-install
  # script: the provider can only run one at purchase or at reinstall, never on
  # a server that already exists, so the first Ansible run is bootstrap.sh
  # over SSH (infra-lab/README.md, "First configuration run").

  # Unset (null) unless var.ssh_public_key is set, so the adoption plan has no
  # diff here. When set, the change is the attach call only, not a reinstall.
  ssh_key_ids = var.ssh_public_key == null ? null : [tonumber(hostinger_vps_ssh_key.owner[0].id)]

  lifecycle {
    # Destroying this resource cancels the Hostinger subscription. A plan that
    # would do it, including the destroy half of a replacement, fails instead.
    prevent_destroy = true

    # plan, data_center_id, password: ForceNew. A difference between config
    # and state, including a mistyped workspace variable or an import that
    # read the plan name in a different form, would plan a replacement, which
    # is a cancellation and a second purchase. Ignored so that can never be
    # planned from here; changing the plan or the data centre is an hPanel
    # operation (an upgrade or a migration), after which the workspace
    # variables are updated to match.
    #
    # template_id: an in-place change, but the update calls Hostinger's
    # recreate endpoint, which reinstalls the operating system and wipes the
    # disk. Ignored so a template change is an hPanel decision the owner makes
    # on purpose, never a side effect of an apply.
    ignore_changes = [
      plan,
      data_center_id,
      password,
      template_id,
    ]

    # ignore_changes hides a disagreement; these make it loud instead. After
    # the import, state holds what the server is, and a workspace variable
    # that does not match it is an error naming the value to set, rather
    # than a configuration that quietly describes a different server.
    postcondition {
      condition     = self.plan == var.hostinger_plan
      error_message = "hostinger_plan does not match the adopted server, whose plan is \"${coalesce(self.plan, "(empty)")}\". Set the workspace variable to exactly that value and queue the plan again. Nothing has been changed."
    }
    postcondition {
      condition     = self.data_center_id == var.hostinger_data_center_id
      error_message = "hostinger_data_center_id does not match the adopted server, whose data_center_id is ${coalesce(self.data_center_id, 0)}. Set the workspace variable to exactly that value and queue the plan again. Nothing has been changed."
    }
    postcondition {
      condition     = self.template_id == var.hostinger_template_id
      error_message = "hostinger_template_id does not match the adopted server, whose template_id is ${coalesce(self.template_id, 0)}. Set the workspace variable to exactly that value and queue the plan again. Nothing has been changed."
    }
  }
}

# The owner's SSH public key, registered in the Hostinger account and attached
# to the VM above. Absent unless var.ssh_public_key is set. Both attributes
# are ForceNew, so a new key is a replacement of this account-level key record
# only; the VM is untouched by that, and the provider never detaches the old
# key from the server (remove it from authorized_keys through Ansible).
resource "hostinger_vps_ssh_key" "owner" {
  count = var.ssh_public_key == null ? 0 : 1

  name = "hcw-lab-owner"
  key  = var.ssh_public_key
}
