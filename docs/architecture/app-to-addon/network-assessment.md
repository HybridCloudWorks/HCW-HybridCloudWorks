# Network assessment: `HCW-NetworkEyes_App` and `HCW-NetworkEyes_AddOn`

The second pair of the [App-to-AddOn program](README.md). Its catalogue row
is `coming` since 2026-10-10: the page at `/tools/network-assessment` renders
the explainer, nothing is framed, and no app setting, `group_vars` row or CSP
entry exists for it yet.

| Fact | Value |
| --- | --- |
| Catalogue id | `network-assessment` |
| Site route | `/tools/network-assessment` (not in the Tools menu while `coming`) |
| AddOn origin (reserved) | `https://network-assessment.lab.hybridcloudworks.com` |
| Image (reserved) | `docker.io/hybridcloudworks/hcw-addon-network-assessment` |
| Lab host port (reserved) | `127.0.0.1:18082` |
| Row status | `coming`; capabilities to be granted `navigate`, `downloads` |
| Status proxy | `GET /api/public/addons/network-assessment/status`, reading `ADDON_NETWORK_ASSESSMENT_URL` (not declared until the row is `available`; the proxy answers `{ configured: false }`) |
| Health `edition` | `lab` |
| Vault key (reserved) | `vault_addon_network_assessment_turnstile_secret` |
| Pull request | App: <https://github.com/saulpatinojr/HCW-NetworkEyes_App/pull/179> (the `REFACTOR_APP.md` refactoring) |

## What the App keeps

The Cloud Network Assessment core and its Azure appliance edition, which
reads a tenant's network estate under a managed identity. The retired
`HCW-NetworkEyes_App` repository's history lives in `Work-Cloud_Network_Core`;
the appliance work is in the per-cloud appliance repositories.

## What the AddOn will be

A Python lab edition: an uploaded Azure Resource Graph export of network
resources, assessed for topology, segmentation and exposure, held in memory
for two hours, with no cloud SDK in the image and a startup refusal under any
identity endpoint. It follows the standard's health envelope, headers, pane
protocol, limits and hardening, with the `NA_` environment prefix.

## Flipping the row to `available`

One pull request: the row's `status`, `ADDON_NETWORK_ASSESSMENT_URL` in
`infra/functionapp.tf`, a `group_vars` row with the image digest and the
widget's site key, the origin in `frame-src`, and the owner's widget and vault
key, as the [migration record](migration.md) and the
[runbook](../../runbooks/labs-host.md) describe.
