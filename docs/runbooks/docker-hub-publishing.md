# Docker Hub publishing — the OIDC connection

> **Status: the workflow is ready; the connection is not created yet (#779).**
> `publish-lab-image.yml` has a `Publish to Docker Hub` job that stays
> skipped until the owner creates a Docker OIDC connection and sets two
> repository variables (steps 1 to 3 below). The two Docker Hub repositories
> already exist, public and empty: Docker Hub's public API listed
> `hybridcloudworks/hcw-lab` and `hybridcloudworks/hcw-lab-runner` with
> `is_private: false` and nothing pushed, created at 00:19 and 00:20 UTC on
> 2026-09-29.

The lab images, `hcw-lab` and `hcw-lab-runner`, are published to GHCR on
every push to `main` that changes them. This page turns on the second
registry, Docker Hub, under the organisation `hybridcloudworks`. No Docker
password, personal access token or organisation access token is stored
anywhere. GitHub Actions proves which workflow is running with its own OIDC
token, and Docker exchanges that for a Docker access token that lasts a few
minutes and is used once.

## What the workflow does

`publish-lab-image.yml` has three jobs. `build` and `publish` are unchanged:
`publish` pushes both images to GHCR and attests them. The new third job,
`publish-dockerhub`, runs only after `publish` succeeds and only while the
repository variable `DOCKERHUB_ENABLED` is `true`:

1. Checks that `DOCKERHUB_CONNECTION` holds a connection ID (a UUID), and
   fails with a message naming the variable if it does not.
2. Signs in to Docker Hub through the OIDC connection, with
   `docker/login-action` v4.6.0.
3. Copies each image from GHCR to Docker Hub **by digest**
   (`docker buildx imagetools create --prefer-index=false`). The copy keeps
   the manifest's own bytes, so each image has the same digest in both
   registries. The job reads the digest back from Docker Hub and fails if it
   differs from GHCR's.
4. Attests each image's provenance under its Docker Hub name, and pushes the
   attestation to Docker Hub beside the image.
5. Writes the two Docker Hub references, with their digests, to the run
   summary.

A separate job, rather than more steps in `publish`, so that GHCR never
waits on Docker Hub. A Docker Hub failure turns the run red after GHCR has
already published and attested. **Re-run failed jobs** repeats only the
Docker Hub job, against the same two digests.

## How the sign-in works

| Fact | Status and source |
| --- | --- |
| An OIDC connection is created in Docker Home: select the organisation, then **Identity & auth**, then **OIDC connections**, then **Create OIDC connection**. Rulesets and subject claims are required, and "Other values are optional". The connection ID is copied after **Create connection**. | VERIFIED: [Create and manage OIDC connections](https://docs.docker.com/security/authentication/oidc-connections/create-manage/) |
| Only organisation owners and editors can create one. | VERIFIED: same page, "Organization owners and editors create and manage OIDC connections"; [core roles](https://docs.docker.com/security/roles-and-permissions/core-roles/) lists "Manage OIDC connections" for editor and owner, not member |
| GitHub is the only supported issuer. | VERIFIED: same page, "OIDC connections support only GitHub as a trusted third party." |
| The feature needs a Docker Team, Business or Hardened Images subscription, or the Docker-Sponsored Open Source programme. | VERIFIED: [Docker's announcement, 2026-07-31](https://www.docker.com/blog/docker-oidc-connections-for-github-actions-available-for-docker-orgs/); the docs' summary bar reads `subscription: [Team, Business]`. **Whether `hybridcloudworks` qualifies is NOT VERIFIED**: its plan is visible only when signed in. See "Before you start" |
| A ruleset has a label, rules (subject claim strings), resources (Docker Hub repositories or Docker Build Cloud) and scopes ("such as read or write access"). There can be 1 to 5 rulesets, and when several match, their resources are merged. | VERIFIED: [Rulesets and subject claims](https://docs.docker.com/security/authentication/oidc-connections/rulesets-claims/) |
| Rules match the `sub` claim. `*` is a wildcard. | VERIFIED: same page |
| The exact on-screen labels for resources and scopes. | NOT VERIFIED: the form is behind sign-in, and Docker's pages describe the fields without naming the controls |
| `docker/login-action` added Docker Hub OIDC in v4.5.0. This repository pins v4.6.0 (`dbcb8138…`). The workflow grants `id-token: write`, passes the organisation name as `username`, omits `password`, and sets `DOCKERHUB_OIDC_CONNECTIONID`. | VERIFIED: [v4.5.0 release notes](https://github.com/docker/login-action/releases/tag/v4.5.0); the [README at v4.6.0](https://github.com/docker/login-action/blob/v4.6.0/README.md#docker-hub) |
| The exchange: the action requests a GitHub ID token with the audience `https://identity.docker.com`, then posts it to `https://identity.docker.com/oauth/token` as an RFC 8693 token exchange (`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token_type=urn:ietf:params:oauth:token-type:id_token`, plus `connection_id` and `expires_in`). It masks the returned access token and runs `docker login` with it. `expires_in` defaults to 300 seconds; the environment variable `DOCKERHUB_OIDC_EXPIREIN` accepts 300 to 3600. | VERIFIED: [`src/dockerhub.ts` at v4.6.0](https://github.com/docker/login-action/blob/v4.6.0/src/dockerhub.ts). `DOCKERHUB_OIDC_EXPIREIN` is in the source, not the README, and the workflow does not set it |
| This repository's OIDC subject uses GitHub's immutable-identifier form: `repo:HybridCloudWorks@312844660/HCW-HybridCloudWorks@1268997852:ref:refs/heads/main` on `main`. | VERIFIED: `GET /repos/HybridCloudWorks/HCW-HybridCloudWorks/actions/oidc/customization/sub` returned `use_immutable_subject: true` and that prefix on 2026-09-28; `infra/oidc.tf` records the same subject from a real token (2026-08-20). Docker's rulesets page notes the same change |
| A single-image copy keeps its digest only with `--prefer-index=false`. | VERIFIED by measurement, 2026-09-28, buildx v0.37.1 (the runner's version): `ghcr.io/hybridcloudworks/hcw-lab-runner@sha256:c02d87ac…` copied to a local registry kept `sha256:c02d87ac…`. Without the flag, buildx wraps the image in a new manifest list with a new digest. [imagetools create reference](https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/) |
| The copy does not carry GHCR's attestation across. | VERIFIED by the same measurement: the destination had no attestation tag afterwards |
| `actions/attest` pushes to Docker Hub when the subject name uses `docker.io` as its registry part. | VERIFIED: [actions/attest README](https://github.com/actions/attest#container-image), "When pushing to Docker Hub, please use "docker.io" as the registry portion of the image name." |
| A `docker push` to a missing repository creates it with the namespace's default privacy. | VERIFIED: [Docker Hub settings](https://docs.docker.com/docker-hub/settings/#configure-default-repository-privacy). Not relied on: both repositories already exist and are public |

## Before you start

- **You are an owner or editor of `hybridcloudworks` on Docker.**
- **The organisation's subscription allows OIDC connections.** Team,
  Business, Hardened Images, or acceptance into Docker-Sponsored Open Source
  (#678). If step 1 shows an upgrade prompt instead of the form, or refuses
  **Create connection**, stop there. Nothing in the repository needs
  changing: the Docker Hub job stays skipped until `DOCKERHUB_ENABLED` is
  set. "If the organisation cannot create a connection yet", below, is the
  way to put the images on Docker Hub in the meantime without storing a
  token.
- **The repositories exist.** They do (see the status note above). If one is
  ever deleted, recreate it as **Public** at
  <https://hub.docker.com/orgs/hybridcloudworks/repositories>, because a
  ruleset can only name a repository that exists.

## 1. Create the OIDC connection in Docker Home

Open <https://app.docker.com/>, choose **hybridcloudworks** in the
organisation switcher at the top left, then select **Identity & auth** and
**OIDC connections**. That is the page with the empty list and the
**Create OIDC connection** button. Docker Home is behind sign-in, so its
address for that page could not be read from outside it. Once you are on
the page, the address bar holds the deep link.

Select **Create OIDC connection** and fill the form with exactly these
values. Add no second ruleset.

| Field | Value |
| --- | --- |
| Name or description, if the form offers one (optional) | `github-hcw-publish-lab-image` |
| Ruleset label | `publish-lab-image-main` |
| Rule (subject claim) | `repo:HybridCloudWorks@312844660/HCW-HybridCloudWorks@1268997852:ref:refs/heads/main` |
| Resources | Docker Hub repositories `hybridcloudworks/hcw-lab` and `hybridcloudworks/hcw-lab-runner`, those two only, not all repositories |
| Scopes | Read and write (push) on both. The job reads each repository back after writing to it |

Select **Create connection**, then copy the connection ID it shows. It looks
like `3f0c…` in five hyphenated groups of hex digits (a UUID). The ID is an
identifier, not a credential: without a token from this repository's `main`
it grants nothing.

Why this subject, and only this one:

- **The immutable form, because it is the one GitHub presents.** The subject
  carries the organisation's and repository's numeric IDs, so a future
  organisation or repository that takes the name `HybridCloudWorks` cannot
  match it. The name form, `repo:HybridCloudWorks/HCW-HybridCloudWorks:ref:refs/heads/main`,
  is not what this repository's tokens carry, and adding it would only widen
  the connection.
- **`ref:refs/heads/main`, not an environment.** The job runs only on a push
  to `main` or a dispatch from `main`. A subject ending in
  `:environment:<name>` carries no branch, so it would match a dispatch from
  any branch unless a deployment-branch rule held
  ([Required inputs](../standards/required-inputs.md), §4.4). A pull request
  presents `:pull_request` and matches nothing here.
- **No wildcard.** A wildcard such as `repo:HybridCloudWorks@312844660/*`
  would admit every repository in the organisation.

Every workflow on `main` presents this same subject, so a job elsewhere in
the repository could also exchange a token if it named the connection ID.
Reaching `main` needs a reviewed pull request past the ruleset's required
checks, and that is the boundary this relies on. Scoping by workflow as well
would need a custom subject template for the whole repository, which would
break every Azure federated credential in `infra/oidc.tf`.

## 2. Store the connection ID as a repository variable

Copy the connection ID to the clipboard (step 1), then run this in
PowerShell. It reads the clipboard, refuses anything that is not a UUID, and
sets `DOCKERHUB_CONNECTION`:

```powershell
$id = ([string](Get-Clipboard -Raw)).Trim(); if ($id -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { gh variable set DOCKERHUB_CONNECTION --repo HybridCloudWorks/HCW-HybridCloudWorks --body $id } else { "The clipboard does not hold a connection ID. It holds: $id" }
```

Success prints `✓ Created variable DOCKERHUB_CONNECTION for HybridCloudWorks/HCW-HybridCloudWorks`
(`Updated` if it existed). A variable, not a secret, because it is an
identifier: GitHub shows it in logs, which is what makes a wrong one
diagnosable.

## 3. Turn the job on

```powershell
gh variable set DOCKERHUB_ENABLED --repo HybridCloudWorks/HCW-HybridCloudWorks --body true
```

Set the ID first and this second, so no run ever sees the switch on without
an ID. To read both back:

```powershell
gh variable get DOCKERHUB_CONNECTION --repo HybridCloudWorks/HCW-HybridCloudWorks; gh variable get DOCKERHUB_ENABLED --repo HybridCloudWorks/HCW-HybridCloudWorks
```

It prints the UUID, then `true`.

## 4. Publish

The next push to `main` that changes the lab image publishes to Docker Hub
on its own. To publish now, dispatch the workflow from `main`. The dispatch
rebuilds, smoke-tests and republishes GHCR as well, which is what the
workflow always does:

```powershell
gh workflow run publish-lab-image.yml --repo HybridCloudWorks/HCW-HybridCloudWorks --ref main
```

A few seconds later, once the run has appeared, follow it. This prints each
job as it finishes, and exits non-zero if the run fails:

```powershell
gh run watch (gh run list --repo HybridCloudWorks/HCW-HybridCloudWorks --workflow publish-lab-image.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId') --repo HybridCloudWorks/HCW-HybridCloudWorks --exit-status
```

The run is also listed at
<https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/actions/workflows/publish-lab-image.yml>.

## What success looks like

- **The run:** three green jobs: `Build and smoke`, `Publish to GHCR` and
  `Publish to Docker Hub`. The summary has a `Published` block with the two
  GHCR references, and a `Published to Docker Hub` block with the two
  `docker.io/hybridcloudworks/…` references. The `sha256:` values are the
  same in both blocks.
- **Docker Hub:** <https://hub.docker.com/r/hybridcloudworks/hcw-lab/tags>
  and <https://hub.docker.com/r/hybridcloudworks/hcw-lab-runner/tags> each
  list `latest` and the commit's full SHA as tags.
- **The same bytes.** These pull from Docker Hub, anonymously, the exact
  digest GHCR holds for `latest`. A pull by digest succeeds only if Docker
  Hub has that manifest:

  ```powershell
  $d = docker buildx imagetools inspect ghcr.io/hybridcloudworks/hcw-lab:latest --format '{{.Manifest.Digest}}'; docker pull "hybridcloudworks/hcw-lab@$d"
  ```

  ```powershell
  $r = docker buildx imagetools inspect ghcr.io/hybridcloudworks/hcw-lab-runner:latest --format '{{.Manifest.Digest}}'; docker pull "hybridcloudworks/hcw-lab-runner@$r"
  ```

  Each ends with a `Digest: sha256:…` line and `Status: Downloaded newer image for …`,
  or `Image is up to date`.
- **The provenance.** This reads the attestation stored on Docker Hub, not
  the copy in GitHub's API, and prints `✓ Verification succeeded!`, naming
  `.github/workflows/publish-lab-image.yml@refs/heads/main`:

  ```powershell
  gh attestation verify oci://docker.io/hybridcloudworks/hcw-lab:latest --repo HybridCloudWorks/HCW-HybridCloudWorks --bundle-from-oci
  ```

  The same command against `ghcr.io/hybridcloudworks/hcw-lab:latest`
  succeeded on 2026-09-28, which is the baseline.

## When it fails

| Where, and what it says | Cause | Fix |
| --- | --- | --- |
| `Publish to Docker Hub` shows as skipped | `DOCKERHUB_ENABLED` is not `true` | Step 3 |
| `DOCKERHUB_CONNECTION holds a connection ID, and both digests arrived`: `DOCKERHUB_ENABLED is true, but the repository variable DOCKERHUB_CONNECTION is not an OIDC connection ID` | The variable is missing or holds something else | Step 2 |
| `Log in to Docker Hub through the OIDC connection`: `Docker Hub API: bad status code 4xx: {…}` | Docker refused the exchange. Usually the subject did not match the ruleset, or the connection is deactivated or was deleted | Open the connection's **Edit** page in Docker Home: its **Failures** table shows each refused exchange. A subject mismatch means the rule is not exactly the one in step 1. A deleted connection needs a new one, and its new ID in step 2 |
| The same step: `Docker Hub API: operation not permitted` | A 401 with no body from Docker | As above |
| A copy step: `unauthorized`, `insufficient_scope` or `requested access to the resource is denied` | The ruleset's resources or scopes do not include push on that repository | Edit the ruleset: both repositories, read and write |
| A copy or attest step fails as unauthorized several minutes after the login succeeded | The Docker token expired (300 seconds by default) | Re-run the failed job. If it keeps happening, the job needs `DOCKERHUB_OIDC_EXPIREIN` (300 to 3600) on the login step, a pull request |
| A copy step: `… is sha256:X on Docker Hub, but sha256:Y on GHCR.` | Something other than this job wrote the tag between the copy and the read-back | Do not re-run blindly: find what else pushes to `hybridcloudworks/hcw-lab*` |
| **Create connection** refused, or an upgrade prompt in step 1 | The organisation's subscription does not include OIDC connections | "Before you start" |

## Turning it off

Either of these stops Docker Hub publishing without touching GHCR:

```powershell
gh variable set DOCKERHUB_ENABLED --repo HybridCloudWorks/HCW-HybridCloudWorks --body false
```

In Docker Home, **Deactivate** on the connection's row pauses it too, but
then the job runs and fails at the login step. Setting the variable to
`false` is the quiet way. Images already on Docker Hub stay there.

## If the organisation cannot create a connection yet

The Docker-Sponsored Open Source application (#678) wants the images on
Docker Hub, and OIDC connections may need that programme first. To break the
loop without storing a token anywhere, copy the current images once, from
your own machine, as yourself. This is a manual step, and the next workflow
run does not repeat it.

Sign in to Docker Hub interactively (a browser device-code prompt):

```powershell
docker login
```

Then copy each image by its GHCR digest, which keeps the digest:

```powershell
$d = docker buildx imagetools inspect ghcr.io/hybridcloudworks/hcw-lab:latest --format '{{.Manifest.Digest}}'; docker buildx imagetools create --prefer-index=false --tag docker.io/hybridcloudworks/hcw-lab:latest "ghcr.io/hybridcloudworks/hcw-lab@$d"
```

```powershell
$r = docker buildx imagetools inspect ghcr.io/hybridcloudworks/hcw-lab-runner:latest --format '{{.Manifest.Digest}}'; docker buildx imagetools create --prefer-index=false --tag docker.io/hybridcloudworks/hcw-lab-runner:latest "ghcr.io/hybridcloudworks/hcw-lab-runner@$r"
```

Success prints `pushing sha256:… to docker.io/hybridcloudworks/hcw-lab:latest`
for each. `gh attestation verify oci://docker.io/hybridcloudworks/hcw-lab:latest --repo HybridCloudWorks/HCW-HybridCloudWorks`
(without `--bundle-from-oci`) then succeeds, because GitHub's attestation
API looks the image up by digest and finds the GHCR attestation. No
attestation is stored on Docker Hub itself until the workflow publishes
there.

## Why not an organisation access token

Docker's organisation access tokens work with `docker/login-action` today,
but one would sit in a GitHub secret until someone rotates it, with no tie
to a repository, a branch or a workflow. The OIDC connection stores nothing,
matches one subject, and issues a token that expires minutes after the run
asks for it. That is the same reasoning that keeps every Azure login in this
repository on federated credentials
([Variables and secrets](../standards/variables-and-secrets.md), "Why OIDC
federation means zero long-lived cloud credentials in GitHub").

## Follow-ups once it is live

- The site still names only GHCR: `LAB_IMAGE` in
  `frontend/src/data/labs/catalogue.js` (the `/education/labs` "Run it
  locally" commands) and the Docker provider pages under
  `frontend/src/pages/docker/`. They mention Docker Hub once a run has
  published there, not before.
- Close #779 when the three checks under "What success looks like" pass.
