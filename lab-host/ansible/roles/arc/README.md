# arc

Onboards the lab host to Azure Arc (ADR 0032 decision 3, #663): the Azure
Connected Machine agent from Microsoft's apt repository at a pinned version,
connected to `rg-lab-hybrid-prod-cus` by a service principal that holds only
**Azure Connected Machine Onboarding** on that group (`infra/lab-hybrid.tf`).
It runs straight after `hardening` in `site.yml`, because the agent needs
nothing the later roles install and the host should appear in Azure even when
a later role fails.

Off by default: `arc_enabled` is `false` in `group_vars/all.yml`. The owner's
procedure, from creating the service principal to reading back **Connected**,
is [docs/runbooks/labs-host.md](../../../../docs/runbooks/labs-host.md).

## What it does

With `arc_enabled: false`, nothing. It does not install the agent, and it
does not disconnect a machine that is already connected: disconnecting
deletes the Azure resource, so it is a runbook step, never the side effect of
a switch.

With `arc_enabled: true`:

1. Asserts no `arc_tags` name or value contains a comma, an equals sign or a
   space, because `azcmagent` takes them as `Name=Value,Name=Value`.
2. Fetches Microsoft's signing key to `/etc/apt/keyrings/microsoft.asc`,
   refusing it unless its SHA256 matches `arc_apt_key_checksum` (the key that
   signs `dists/noble/InRelease`, so it is the root of trust for the version
   pin), and adds `https://packages.microsoft.com/ubuntu/24.04/prod` as a
   deb822 source with `Signed-By`.
3. Installs `azcmagent` at `arc_agent_version` and holds it, the same pattern
   as the `docker` role; `allow_change_held_packages` lets a pin bump move it.
   The package drops `/etc/cron.d/azcmagent_autoupgrade`, which does nothing
   unless automatic upgrade is enabled, and this role never enables it: the
   version moves when the pin moves.
4. Reads `azcmagent show --json`. When `status` is `Connected` it stops
   there, and the vault values are not needed, which is what lets the
   runbook delete the secret after onboarding (ADR 0032: the credential is
   never on the host after onboarding).
5. Otherwise it fails closed unless all four `vault_arc_*` values are
   present and the application, tenant and subscription ids are GUIDs, then
   writes them with the target group, region, resource name and tags into a
   root-only `0600` temporary file and runs `azcmagent connect --config
   <file>`. The secret is never on a command line, where it would sit in the
   process table; the file is deleted in an `always:` whether connect
   succeeds or not. Microsoft recommends `--config` over
   `--service-principal-secret` for exactly this reason.
6. Reads `azcmagent show --json` again and fails unless it reports
   `Connected`. The success line reads `Connected to Azure Arc as
   arcs-lab-hybrid-prod-cus-01 in rg-lab-hybrid-prod-cus.`

What it does **not** do: install the Azure Monitor Agent, or associate the
data collection rule. Both are Azure-side operations on the machine resource,
which exists only after step 5, and the onboarding role cannot install an
extension. The owner runs the two `az` commands in the runbook once the
machine is Connected.

## Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `arc_enabled` | required (`false` in `group_vars`) | Onboard the host |
| `arc_agent_version` | required | apt version of `azcmagent`, four-part |
| `arc_apt_key_checksum` | required | `sha256:<hex>` the fetched key must match |
| `arc_resource_group` | required | `rg-lab-hybrid-prod-cus` |
| `arc_location` | required | `centralus` |
| `arc_resource_name` | required | `arcs-lab-hybrid-prod-cus-01`; fixed, because it cannot change without a disconnect |
| `arc_tags` | required | Tags on the machine resource; `infra/`'s tag set with `managedBy: ansible` |
| `arc_apt_key_url` | `https://packages.microsoft.com/keys/microsoft.asc` | Signing key source |
| `arc_apt_key_path` | `/etc/apt/keyrings/microsoft.asc` | Signing key location |
| `arc_apt_repository_url` | `https://packages.microsoft.com/ubuntu/24.04/prod` | Repository base |
| `arc_azcmagent_path` | `/opt/azcmagent/bin/azcmagent` | The CLI |
| `arc_cloud` | `AzureCloud` | Azure cloud |
| `arc_service_principal_id` | `vault_arc_service_principal_id` | Application (client) id of the onboarding principal |
| `arc_service_principal_secret` | `vault_arc_service_principal_secret` | Its client secret |
| `arc_tenant_id` | `vault_arc_tenant_id` | Entra tenant id |
| `arc_subscription_id` | `vault_arc_subscription_id` | Application subscription id |

To bump the agent, read the versions the repository offers and change
`arc_agent_version` in `group_vars/all.yml`. Bash, from anywhere with
network access; the last line printed is the newest:

```bash
curl -s https://packages.microsoft.com/ubuntu/24.04/prod/dists/noble/main/binary-amd64/Packages | awk '/^Package: azcmagent$/{p=1} p&&/^Version:/{print $2; p=0}' | sort -V | tail -3
```

The key checksum, bash:

```bash
curl -sL https://packages.microsoft.com/keys/microsoft.asc | sha256sum
```

Microsoft supports agent versions released in the last year, so a pin older
than that is a finding.

## Handlers

None. The agent's services are started by its package and by `connect`.

## Check mode

Safe. The status read runs in check mode because it is read-only; connect
and the temporary file are skipped.

## Validated

On 2026-09-25, against a systemd Ubuntu 24.04 container: the key checksum
matched, `azcmagent 1.68.03532.1399` installed and held, a second run
reported the install tasks unchanged, `azcmagent show --json` returned
`Disconnected`, the role failed closed with the vault absent, and with
placeholder GUIDs `connect` read the `--config` file (it named the tenant
from it in the error) and the file was gone afterwards.
