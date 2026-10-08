# Docker Hub publishing — the OIDC connection

> **Status: live since 2026-09-29 (#779, closed).** The owner created the
> OIDC connection and set both repository variables, and run
> [36516945081](https://github.com/saulpatinojr/HCW-HybridCloudWorks/actions/runs/36516945081)
> published both images:
> - `hybridcloudworks/hcw-lab` and `hybridcloudworks/hcw-lab-runner` on
>   Docker Hub carry the same digests as GHCR;
> - an anonymous registry token reads their manifests;
> - `gh attestation verify oci://docker.io/hybridcloudworks/hcw-lab:latest`
>   verifies the SLSA provenance.
>
> Every later push to `main` that rebuilds the image publishes to both. Steps
> 1 to 3 below are what was done once, and what to repeat if the connection
> is ever recreated.
>
> **The rule changed on 2026-10-07.** The repository moved from the
> `HybridCloudWorks` organisation to the personal account `saulpatinojr`,
> which changes the owner half of every OIDC subject. The connection keeps
> its ID and resources; only its rule needs editing, to the value in step 1.
> See "After a repository transfer" below.

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
| This repository's OIDC subject uses GitHub's immutable-identifier form: `repo:saulpatinojr@34853639/HCW-HybridCloudWorks@1268997852:ref:refs/heads/main` on `main`. | VERIFIED: `GET /repos/saulpatinojr/HCW-HybridCloudWorks/actions/oidc/customization/sub` returned `use_immutable_subject: true` and that prefix on 2026-10-08, and the failing Azure logins after the transfer presented the same subject. Before 2026-10-07 the owner half was `HybridCloudWorks@312844660` (same call, 2026-09-28). Docker's rulesets page notes the immutable form |
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
| Rule (subject claim) | `repo:saulpatinojr@34853639/HCW-HybridCloudWorks@1268997852:ref:refs/heads/main` |
| Resources | Docker Hub repositories `hybridcloudworks/hcw-lab` and `hybridcloudworks/hcw-lab-runner`, those two only, not all repositories |
| Scopes | Read and write (push) on both. The job reads each repository back after writing to it |

Select **Create connection**, then copy the connection ID it shows. It looks
like `3f0c…` in five hyphenated groups of hex digits (a UUID). The ID is an
identifier, not a credential: without a token from this repository's `main`
it grants nothing.

Why this subject, and only this one:

- **The immutable form, because it is the one GitHub presents.** The subject
  carries the owner's and repository's numeric IDs, so a future account or
  repository that takes the name `saulpatinojr` or `HCW-HybridCloudWorks`
  cannot match it. The name form, `repo:saulpatinojr/HCW-HybridCloudWorks:ref:refs/heads/main`,
  is not what this repository's tokens carry, and adding it would only widen
  the connection.
- **`ref:refs/heads/main`, not an environment.** The job runs only on a push
  to `main` or a dispatch from `main`. A subject ending in
  `:environment:<name>` carries no branch, so it would match a dispatch from
  any branch unless a deployment-branch rule held
  ([Required inputs](../standards/required-inputs.md), §4.4). A pull request
  presents `:pull_request` and matches nothing here.
- **No wildcard.** A wildcard such as `repo:saulpatinojr@34853639/*`
  would admit every repository the account owns.

Every workflow on `main` presents this same subject, so a job elsewhere in
the repository could also exchange a token if it named the connection ID.
Reaching `main` needs a reviewed pull request past the ruleset's required
checks, and that is the boundary this relies on. Scoping by workflow as well
would need a custom subject template for the whole repository, which would
break every Azure federated credential in `infra/oidc.tf`.

## 2. Store the connection ID as a repository variable

Run this in PowerShell and, at the prompt, paste the connection ID from
step 1. It asks rather than reading the clipboard, because copying this line
from the page replaces whatever the clipboard held. It refuses anything that
is not a UUID and sets `DOCKERHUB_CONNECTION`:

```powershell
$id = (Read-Host 'Docker OIDC connection ID').Trim(); if ($id -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { gh variable set DOCKERHUB_CONNECTION --repo saulpatinojr/HCW-HybridCloudWorks --body $id } else { "That is not a connection ID (a UUID). It was: $id" }
```

Success prints `✓ Created variable DOCKERHUB_CONNECTION for saulpatinojr/HCW-HybridCloudWorks`
(`Updated` if it existed). A variable, not a secret, because it is an
identifier: GitHub shows it in logs, which is what makes a wrong one
diagnosable.

## 3. Turn the job on

```powershell
gh variable set DOCKERHUB_ENABLED --repo saulpatinojr/HCW-HybridCloudWorks --body true
```

Set the ID first and this second, so no run ever sees the switch on without
an ID. To read both back:

```powershell
gh variable get DOCKERHUB_CONNECTION --repo saulpatinojr/HCW-HybridCloudWorks; gh variable get DOCKERHUB_ENABLED --repo saulpatinojr/HCW-HybridCloudWorks
```

It prints the UUID, then `true`.

## 4. Publish

The next push to `main` that changes the lab image publishes to Docker Hub
on its own. To publish now, dispatch the workflow from `main`. The dispatch
rebuilds, smoke-tests and republishes GHCR as well, which is what the
workflow always does:

```powershell
gh workflow run publish-lab-image.yml --repo saulpatinojr/HCW-HybridCloudWorks --ref main
```

A few seconds later, once the run has appeared, follow it. This prints each
job as it finishes, and exits non-zero if the run fails:

```powershell
gh run watch (gh run list --repo saulpatinojr/HCW-HybridCloudWorks --workflow publish-lab-image.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId') --repo saulpatinojr/HCW-HybridCloudWorks --exit-status
```

The run is also listed at
<https://github.com/saulpatinojr/HCW-HybridCloudWorks/actions/workflows/publish-lab-image.yml>.

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
  gh attestation verify oci://docker.io/hybridcloudworks/hcw-lab:latest --repo saulpatinojr/HCW-HybridCloudWorks --bundle-from-oci
  ```

  The same command against `ghcr.io/hybridcloudworks/hcw-lab:latest`
  succeeded on 2026-09-28, which is the baseline.

## When it fails

| Where, and what it says | Cause | Fix |
| --- | --- | --- |
| `Publish to Docker Hub` shows as skipped | `DOCKERHUB_ENABLED` is not `true` | Step 3 |
| `DOCKERHUB_CONNECTION holds a connection ID, and both digests arrived`: `DOCKERHUB_ENABLED is true, but the repository variable DOCKERHUB_CONNECTION is not an OIDC connection ID` | The variable is missing or holds something else | Step 2 |
| `Log in to Docker Hub through the OIDC connection`: `Docker Hub API: bad status code 4xx: {…}` | Docker refused the exchange. Usually the subject did not match the ruleset, or the connection is deactivated or was deleted | The run's summary has a table, **Docker refused the token exchange**, from the step `Explain a refused Docker token exchange`. It shows the token's `sub`, `aud`, `ref` and `repository` claims (never the token) and says whether `sub` equals the rule in step 1. Then open the connection's **Edit** page in Docker Home: its **Failures** table shows each refused exchange and why. A subject mismatch means the rule is not exactly the one in step 1. A deleted connection needs a new one, and its new ID in step 2. The first real run, 36508154993 on 2026-09-29, failed here with `400 {"error":"access_denied"}` |
| The same step: `Docker Hub API: operation not permitted` | A 401 with no body from Docker | As above |
| A copy step: `unauthorized`, `insufficient_scope` or `requested access to the resource is denied` | The ruleset's resources or scopes do not include push on that repository | Edit the ruleset: both repositories, read and write |
| A copy or attest step fails as unauthorized several minutes after the login succeeded | The Docker token expired (300 seconds by default) | Re-run the failed job. If it keeps happening, the job needs `DOCKERHUB_OIDC_EXPIREIN` (300 to 3600) on the login step, a pull request |
| A copy step: `… is sha256:X on Docker Hub, but sha256:Y on GHCR.` | Something other than this job wrote the tag between the copy and the read-back | Do not re-run blindly: find what else pushes to `hybridcloudworks/hcw-lab*` |
| **Create connection** refused, or an upgrade prompt in step 1 | The organisation's subscription does not include OIDC connections | "Before you start" |

## After a repository transfer

The subject names the GitHub account that owns the repository, with its
numeric ID. Moving the repository to another account replaces both, even
though the repository's own ID stays the same. The Docker organisation
`hybridcloudworks` and its two repositories do not move, so the connection
keeps its ID and its resources. Only the rule needs changing.

1. Open the connection in Docker Home (step 1 gives the route) and select
   **Edit**.
2. In the ruleset `publish-lab-image-main`, replace the rule with the value
   in step 1. It must match exactly: there is no wildcard, and the old rule
   should not stay beside the new one, because nothing can present it any
   more.
3. Save. The repository variables from steps 2 and 3 travel with the
   repository and keep their values (`DOCKERHUB_CONNECTION` and
   `DOCKERHUB_ENABLED` were both present after the 2026-10-07 move). Their
   commands above name the current owner.
4. Publish (step 4) and check "What success looks like".

`EXPECTED_RULE` in `publish-lab-image.yml` holds the same string, and
`scripts/oidc-subjects.test.mjs` checks it against `infra/oidc.tf` and
against the repository CI runs in. A transfer therefore fails a pull request
before it fails a publish. It cannot reach Docker Home, so this edit stays a
manual step.

Done once already: on 2026-10-07 the repository moved from the
`HybridCloudWorks` organisation (owner ID `312844660`) to the personal account
`saulpatinojr` (`34853639`).

## Turning it off

Either of these stops Docker Hub publishing without touching GHCR:

```powershell
gh variable set DOCKERHUB_ENABLED --repo saulpatinojr/HCW-HybridCloudWorks --body false
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
for each. `gh attestation verify oci://docker.io/hybridcloudworks/hcw-lab:latest --repo saulpatinojr/HCW-HybridCloudWorks`
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

## Since it went live

- **The site:** `LAB_IMAGE` in `frontend/src/data/labs/catalogue.js`, which
  drives the `/education/labs` "Run it locally" commands, names
  `hybridcloudworks/hcw-lab:latest` on Docker Hub (#795). GHCR stays a
  mirror of the same digest.
- **#779:** closed on 2026-09-29, after the three checks under "What success
  looks like" passed.
- **2026-10-07, repository transfer:** the rule in step 1, `EXPECTED_RULE`
  and the commands in step 4 moved to the `saulpatinojr` owner. The
  connection's rule in Docker Home is edited by hand, as in "After a
  repository transfer". Images attested before the move were signed by the
  workflow under its old owner. Whether `gh attestation verify --repo
  saulpatinojr/HCW-HybridCloudWorks` accepts those is NOT VERIFIED. The
  first publish after the move gives a `latest` that was signed under the
  new owner.
