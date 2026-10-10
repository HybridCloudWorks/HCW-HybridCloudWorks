# Cloud assessment: `HCW-CloudAssessor_App` and `HCW-CloudAssessor_AddOn`

The third pair of the [App-to-AddOn program](README.md). Its catalogue row is
`coming` since 2026-10-10: the page at `/tools/cloud-assessment` renders the
explainer, nothing is framed, and no app setting, `group_vars` row or CSP
entry exists for it yet.

| Fact | Value |
| --- | --- |
| Catalogue id | `cloud-assessment` |
| Site route | `/tools/cloud-assessment` (not in the Tools menu while `coming`) |
| AddOn origin (reserved) | `https://cloud-assessment.lab.hybridcloudworks.com` |
| Image (reserved) | `docker.io/hybridcloudworks/hcw-addon-cloud-assessment` |
| Lab host port (reserved) | `127.0.0.1:18083` |
| Row status | `coming`; capabilities to be granted `navigate`, `downloads` |
| Status proxy | `GET /api/public/addons/cloud-assessment/status`, reading `ADDON_CLOUD_ASSESSMENT_URL` (not declared until the row is `available`; the proxy answers `{ configured: false }`) |
| Health `edition` | `lab` |
| Vault key (reserved) | `vault_addon_cloud_assessment_turnstile_secret` |
| Pull request | App: <https://github.com/saulpatinojr/HCW-CloudAssessor_App/pull/5> (the `REFACTOR_APP.md` refactoring) |

## What the App keeps

The Cloud Assessor's Azure appliance edition. The assessment engine
(`packages/cloud-assessor-core`: a declarative criteria catalogue, severity
and pillar weights, evaluator kinds, with unknown lowering coverage and never
score) is seeded in the AddOn repository and moves upstream unchanged (the
AddOn's ADR-0001).

## What the AddOn will be

A Python 3.14 FastAPI lab edition: an uploaded Azure Resource Graph export
assessed against the criteria catalogue, scored by pillar, held in memory for
at most 120 minutes with owner-token isolation, with no cloud SDK in the
image and a startup refusal under any identity endpoint, and a
`NOT-AN-AUDIT.md` in every bundle. It follows the standard's health envelope,
headers, pane protocol, limits and hardening, with the `CA_` environment
prefix.

## Flipping the row to `available`

One pull request: the row's `status`, `ADDON_CLOUD_ASSESSMENT_URL` in
`infra/functionapp.tf`, a `group_vars` row with the image digest and the
widget's site key, the origin in `frame-src`, and the owner's widget and vault
key, as the [migration record](migration.md) and the
[runbook](../../runbooks/labs-host.md) describe.
