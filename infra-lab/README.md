# infra-lab

Terraform for the Hostinger lab host (#661, Phase 1 of #656, on the
decisions in [ADR 0032](../docs/decisions/0032-learner-labs-platform.md)).
It adopts the VPS the owner already has and writes the lab's public names
into the `hybridcloudworks.com` Cloudflare zone. Everything on the host after
that is `lab-host/` (Ansible).

It is its own root module in its own HCP Terraform workspace, `hcw/hcw-lab`.
Nothing here reads `hcw-azure`, and nothing in `infra/` reads this.

## What it manages

| Resource | What it is | Notes |
| --- | --- | --- |
| `hostinger_vps.lab` | The existing VPS, **imported, never created** | See "Why it is only ever imported" below |
| `cloudflare_dns_record.lab` | `lab.hybridcloudworks.com`, A, the VPS's IPv4 address | DNS-only |
| `cloudflare_dns_record.lab_alias["wildcard"]` | `*.lab.hybridcloudworks.com`, CNAME to `lab` | DNS-only |
| `cloudflare_dns_record.lab_alias["coder"]` | `coder.lab.hybridcloudworks.com`, CNAME to `lab` | DNS-only. Needed because `*.coder.lab` makes `coder.lab` an empty non-terminal, and Cloudflare (RFC 4592) does not answer a wildcard for one |
| `cloudflare_dns_record.lab_alias["coder_wildcard"]` | `*.coder.lab.hybridcloudworks.com`, CNAME to `lab` | DNS-only. Coder's workspace apps |
| `hostinger_vps_ssh_key.owner` | The owner's SSH public key | Only when `ssh_public_key` is set, as a separate, later plan |

There are no `_acme-challenge` records. There is no dedicated lab zone yet
(owner decision 2026-09-25), so Caddy's runtime token edits this production
zone directly. ADR 0032 records that as an accepted interim risk.

## Why it is only ever imported

In the `hostinger/hostinger` provider (0.1.23), **creating** a
`hostinger_vps` calls Hostinger's purchase endpoint, and **destroying** one
cancels the subscription. A plan that says `will be created` would buy a
second server. A plan that says `must be replaced` would cancel this one and
buy another.

| Attribute | On a change | Guard in `main.tf` |
| --- | --- | --- |
| `plan`, `data_center_id`, `password` | Replace (cancel and purchase) | `ignore_changes`, plus `prevent_destroy` |
| `template_id` | Reinstall the OS (wipes the disk) | `ignore_changes` |
| `hostname` | Rename only | Not set, so there is no change |
| `post_install_script_id` | Runs only at purchase or reinstall | Not set |
| `ssh_key_ids` | Attach only | Set only through `ssh_public_key` |

`ignore_changes` would hide a mistyped variable, so each of the three
identity values also has a postcondition. A value that does not match the
server stops the plan with an error that names the right value.

`infra-lab/tests/adopt.tftest.hcl` checks all of this offline against mocked
providers. CI runs it on every change here.

## Owner steps

Do these after this directory is on `main`. The workspace reads `main`, and
until the merge `infra-lab/` exists only on the pull request branch.

### 1. Read the server's id, plan, data centre and template

The id is the number in the address bar on the server's hPanel page (the
list is at https://hpanel.hostinger.com/vps). The other three need to be
exact values from the API. This PowerShell line asks for your API token
(create one at https://hpanel.hostinger.com/api), then prints them:

```powershell
$s = Read-Host -AsSecureString 'Hostinger API token'; Invoke-RestMethod -Uri https://developers.hostinger.com/api/vps/v1/virtual-machines -Headers @{ Authorization = 'Bearer ' + [System.Net.NetworkCredential]::new('', $s).Password } | Select-Object id, plan, data_center_id, @{n='template_id';e={$_.template.id}}, @{n='template_name';e={$_.template.name}}, hostname, state | Format-List
```

**Success looks like** one block per server, with a whole number for `id`,
`data_center_id` and `template_id`, text such as `KVM 4` for `plan`, and
`running` for `state`. A `401` means the token was mistyped or has expired.

**Stop here if `template_name` is not Ubuntu 24.04.** `lab-host/bootstrap.sh`
refuses any other OS. Reinstalling wipes the disk, so it is an hPanel
decision and never a Terraform change. After a reinstall, run the line again
and use the new `template_id`.

### 2. Create the workspace

Open https://app.terraform.io/app/hcw/workspaces/new and choose:

- **Version control workflow**, GitHub, repository
  `HybridCloudWorks/HCW-HybridCloudWorks`.
- Name **`hcw-lab`**. `infra-lab/backend.tf` names it, so the spelling
  must match.
- Under **Advanced options**, set Terraform working directory to
  **`infra-lab`** and leave apply method on **Manual apply**.

Then check that **Auto-apply** is off at
https://app.terraform.io/app/hcw/workspaces/hcw-lab/settings/general and
that the Terraform version is 1.6 or later.

### 3. Set the variables

Add these at https://app.terraform.io/app/hcw/workspaces/hcw-lab/variables.
They are all category **Terraform variable**, with HCL unticked.

| Key | Sensitive | Value |
| --- | --- | --- |
| `hostinger_api_token` | **yes** | A token from https://hpanel.hostinger.com/api (it can be the one from step 1) |
| `cloudflare_api_token` | **yes** | A **new** token from https://dash.cloudflare.com/profile/api-tokens, "Create Custom Token", with permissions *Zone / Zone / Read* and *Zone / DNS / Edit*, zone resources *Include / Specific zone / hybridcloudworks.com*, and nothing else |
| `cloudflare_zone_id` | no | The value `cloudflare_zone_id` already has at https://app.terraform.io/app/hcw/workspaces/hcw-azure/variables |
| `hostinger_vps_id` | no | `id` from step 1 |
| `hostinger_plan` | no | `plan` from step 1, exactly, including spaces and case |
| `hostinger_data_center_id` | no | `data_center_id` from step 1 |
| `hostinger_template_id` | no | `template_id` from step 1 |

Leave `lab_hostname` unset. It defaults to `lab.hybridcloudworks.com`.
Leave `ssh_public_key` unset for now. It is a separate plan (step 6).

### 4. Queue the plan and read it before anything else

At https://app.terraform.io/app/hcw/workspaces/hcw-lab/runs, choose
**New run**, then **Plan only**. A plan-only run cannot be applied, so
reading it is safe.

**Success looks like exactly this summary line:**

```text
Plan: 1 to import, 4 to add, 0 to change, 0 to destroy.
```

And in the resource list:

- `hostinger_vps.lab` **will be imported**, with no attribute lines marked
  `~`, `+` or `-` under it.
- Four `cloudflare_dns_record` resources **will be created**:
  `lab`, `lab_alias["wildcard"]`, `lab_alias["coder"]` and
  `lab_alias["coder_wildcard"]`.

**Anything else means stop, and do not apply.** In particular:

- `hostinger_vps.lab will be created` means the import did not happen, and
  applying would **buy a second server**.
- `must be replaced` means cancel and re-purchase. `prevent_destroy` should
  already have turned this into an error.
- `will be updated in-place` on `hostinger_vps.lab` is not expected either.

An error that says a `hostinger_*` variable "does not match the adopted
server" is the postcondition doing its job. Set the variable to the value
the message names and queue the plan again. Nothing has been changed.

### 5. Apply, then check DNS

When the plan-only run matches, start a **New run** with **Plan and apply**,
check the same summary line again, and choose **Confirm & apply**.

**Success looks like** `Apply complete! Resources: 1 imported, 4 added,
0 changed, 0 destroyed.`

Then, in PowerShell, this line prints `True` when the public name resolves to
the server:

```powershell
(Resolve-DnsName lab.hybridcloudworks.com -Type A -Server 1.1.1.1).IPAddress -contains (Resolve-DnsName coder.lab.hybridcloudworks.com -Type A -Server 1.1.1.1 | Where-Object { $_.Type -eq 'A' }).IPAddress
```

`True` means `lab` has an address and `coder.lab` reaches the same one
through its CNAME. A `DNS name does not exist` error in the first minutes
after the apply is propagation. Wait five minutes and run it again before
treating it as a failure.

### 6. Put your SSH key on the server (only if it has none)

The first Ansible run copies root's `authorized_keys` to the `hcwadmin`
user, then turns off root and password login. So root must have your key
before step 7. If you already added one in hPanel, skip this step.

Otherwise, this prints your public key. Copy the one line it prints:

```powershell
Get-Content $HOME\.ssh\id_ed25519.pub
```

If that file does not exist, `ssh-keygen -t ed25519` creates it. The
provider refuses ECDSA keys.

Add it as `ssh_public_key` (not sensitive) on the variables page from step 3.
Then queue a plan-only run as in step 4. **Success looks like**
`Plan: 1 to add, 1 to change, 0 to destroy.`: `hostinger_vps_ssh_key.owner`
will be created, and `hostinger_vps.lab` will be updated in-place with only
`ssh_key_ids` changing. Any other attribute under `hostinger_vps.lab` means
stop. If it matches, apply it as in step 5.

### 7. First configuration run

The provider cannot run a post-install script on a server that already
exists. It only runs one at purchase or reinstall. So the first Ansible run
happens over SSH. This PowerShell line clones the repository onto the host
as root and runs the bootstrap:

```powershell
ssh root@lab.hybridcloudworks.com "apt-get update -q && apt-get install -y -q git && git clone https://github.com/HybridCloudWorks/HCW-HybridCloudWorks.git /opt/hcw-src && /opt/hcw-src/lab-host/bootstrap.sh"
```

**Success looks like** a final `PLAY RECAP` line for `localhost` with
`failed=0` and `unreachable=0`. After it, root login is off. Every later run
is as `hcwadmin`, the command `lab-host/README.md` documents:

```powershell
ssh hcwadmin@lab.hybridcloudworks.com sudo /opt/hcw-src/lab-host/bootstrap.sh
```

## Local checks

Git Bash, from the repository root. None of these needs a credential or
reaches HCP Terraform:

```bash
terraform -chdir=infra-lab fmt -check -recursive && terraform -chdir=infra-lab init -backend=false && terraform -chdir=infra-lab validate && terraform -chdir=infra-lab test
```

## Changing the provider version

`hostinger/hostinger` is pinned exactly in `terraform.tf`, because the
provider is pre-1.0 and the resource it manages is a paid server. A bump is
its own pull request. Its plan in `hcw-lab` must read
`No changes. Your infrastructure matches the configuration.` before anything
else merges on top of it.
