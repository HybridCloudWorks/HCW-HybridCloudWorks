---
title: Publishing to Docker Hub from GitHub Actions without a token
subtitle: Docker's OIDC connections let a workflow sign in to Docker Hub with the identity GitHub already gives it. The connection, the claim it trusts, the workflow job, and the checks that prove the image on Docker Hub is the one you built.
date: 2026-10-05
track: how-to
part: 3 of 3
tags: [docker, docker-hub, github-actions, oidc, supply-chain, provenance]
reading: 14
---

A Docker Hub access token in a GitHub secret works on the first day and every
day after, which is the problem. It is tied to a person or an organisation,
not to a repository, a branch or a workflow; it is valid until someone
rotates it; and it is readable by any job that can reach the secret. The day
it leaks, nothing in its shape says where it came from.

Docker's **OIDC connections** (July 2026) replace that token with an exchange.
A workflow asks GitHub for a signed statement of what it is, Docker checks
that statement against a rule you wrote, and hands back a Docker access
token that lasts five minutes. Nothing is stored anywhere. This article sets
that up for one repository and one branch, copies an image to Docker Hub
with its digest unchanged, and verifies the result from the outside.

Part 1 of this series built the image and showed the login step in passing.
This part is the whole of that step: the claim, the rule, the exchange, and
what to read when Docker says no.

---

## What you'll have at the end

- An OIDC connection in your Docker organisation that trusts exactly one
  subject: the `main` branch of one repository, in GitHub's immutable form.
- A workflow job that signs in to Docker Hub with no password, copies an
  image from GitHub's registry to Docker Hub **by digest**, confirms the
  digest on Docker Hub equals the one it copied, and pushes a provenance
  attestation beside the image.
- Two repository variables, `DOCKERHUB_CONNECTION` and `DOCKERHUB_ENABLED`,
  and no new secret.
- Three commands that prove, from any machine, that the image on Docker Hub
  is the one the workflow built.

The worked example is this site's lab image, which has published this way
since 2026-09-29. The names in the steps are generic (`acme`,
`acme/platform`, `acme/app`); the verification at the end runs against the
real image, so you can see what success prints before you have an image of
your own.

## What it costs

Nothing per push. Docker Hub public repositories are free, the token exchange
is free, and the copy is a registry-to-registry transfer of manifests, not a
rebuild.

The one gate is the subscription. OIDC connections are a feature of Docker
Team and Business organisations, and of the Docker-Sponsored Open Source
programme. A free organisation sees an upgrade prompt where the
**Create OIDC connection** button should be. The last section has a way to
put images on Docker Hub without a stored token while you wait for either.

## Why it is built this way

### An exchange, not a secret

GitHub Actions can mint an **ID token** for any job that asks for one: a JWT
signed by GitHub, carrying claims that say which repository, branch, workflow
and event produced the run. Azure, AWS and Google have accepted those tokens
in place of stored credentials for years. Docker now does too.

The flow has three parts:

1. The job requests an ID token with the audience `https://identity.docker.com`.
2. `docker/login-action` posts that token to `https://identity.docker.com/oauth/token`
   as an RFC 8693 token exchange, naming the connection ID.
3. Docker checks the token's `sub` claim against the connection's rules and,
   if one matches, returns a Docker access token scoped to the resources the
   rule names. The action runs `docker login` with it. The token lasts 300
   seconds by default.

The rejected alternative is an organisation access token in a repository
secret. It works with the same action, today, and it would sit in that secret
until someone remembered to rotate it, usable by any job in the repository,
on any branch, from any event. The exchange gives each run a token that
nobody can copy out of a settings page because it never existed there.

### One subject, in the immutable form

GitHub's ID token has a `sub` claim that, by default, reads
`repo:acme/platform:ref:refs/heads/main`. A repository can present the
**immutable** form instead, which carries the organisation's and the
repository's numeric IDs:

```text
repo:acme@<org-id>/platform@<repo-id>:ref:refs/heads/main
```

The rule you write in Docker must match the form your repository actually
presents, character for character. Step 1 finds out which that is. Use the
immutable form when you can: a repository that is deleted and recreated under
the same name gets a new ID and stops matching, which is what you want.

Three choices in the rule, and why:

- **`ref:refs/heads/main`, not an environment.** A subject that ends in
  `:environment:production` carries no branch, so it matches a
  `workflow_dispatch` from any branch unless a deployment-branch rule on the
  environment forbids it. The branch form matches pushes to `main` and
  dispatches from `main`, and nothing else. A pull request presents
  `:pull_request` and matches nothing.
- **No wildcard.** `repo:acme@<org-id>/*` would admit every repository in the
  organisation to the resources the rule names.
- **One rule, one ruleset.** Docker allows up to five rulesets and merges the
  resources of every one that matches. One is easier to read in the
  **Failures** table later.

### The repository's `main` is the boundary

Every workflow on `main` presents the same subject, so any job on that branch
could exchange a token if it named the connection ID. Scoping by workflow as
well would need a custom subject template for the whole repository, which
would also change the subject every other federated credential (Azure's, for
instance) is waiting for. The boundary this relies on is the one you already
have: reaching `main` takes a reviewed pull request past required checks.

### Copy by digest, then read it back

The job does not rebuild for Docker Hub. It copies the manifest GitHub's
registry already holds, by digest, with `--prefer-index=false` so buildx keeps
the manifest's own bytes rather than wrapping it in a new list with a new
digest. Then it reads the digest back from Docker Hub and fails if the two
differ. The same `sha256:` in both registries is the fact everything after
this depends on: the smoke test ran against those bytes, and the attestation
names them.

### One attestation per registry

A copy does not carry the attestation across, and `actions/attest-build-provenance`
with `push-to-registry: true` takes exactly one fully qualified subject. So
the job attests the image once under its `docker.io` name and pushes that
bundle beside the image on Docker Hub. GitHub's attestation API keys on the
digest, so a verifier asking about either name finds both.

---

## Prerequisites

- A GitHub repository with a workflow that already pushes an image to
  `ghcr.io` and knows its digest. Part 1 has one; the YAML below assumes the
  publish job exposes `outputs.digest`.
- A Docker organisation (`acme` below) on a plan that includes OIDC
  connections, where you are an **owner or editor**. Members cannot create
  connections.
- The target repository on Docker Hub, `acme/app`, **already exists**. A
  ruleset can only name a repository that exists, and a public one is what
  you want for an image learners will pull anonymously.
- `gh` signed in, and `docker` with buildx (any Docker Desktop or Engine from
  2025 onwards).

What must *not* exist: a `DOCKERHUB_TOKEN` secret. If you have one from an
earlier setup, this article ends with deleting it.

---

## The steps

### 1. Find the subject your repository presents

Ask GitHub which form it uses, and build the exact string from the IDs it
returns. PowerShell or bash, the same line:

```powershell
gh api repos/acme/platform/actions/oidc/customization/sub --jq .use_immutable_subject; gh api repos/acme/platform --jq '"repo:\(.owner.login)@\(.owner.id)/\(.name)@\(.id):ref:refs/heads/main"'
```

**Verify:** two lines. `true` or `false`, then the subject. If the first line
is `true`, the second line is your rule, exactly. If it is `false`, your rule
is the name form, `repo:acme/platform:ref:refs/heads/main`, and the second
line is what it will become if you later turn the immutable form on.

To see the claim from a real token rather than infer it, add this step to
any job on `main` with `id-token: write` and read the run log. It prints the
non-secret claims of a token addressed to Docker and never the token itself:

```yaml
      - name: Print the OIDC subject this job presents
        run: |
          set -euo pipefail
          response="$(curl -fsS -H "Authorization: bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=https://identity.docker.com")"
          payload="$(jq -r '.value' <<<"$response" | cut -d. -f2 | tr '_-' '/+')"
          while [ $(( ${#payload} % 4 )) -ne 0 ]; do payload="${payload}="; done
          base64 -d <<<"$payload" | jq '{sub, aud, repository, ref, event_name, job_workflow_ref}'
```

**Verify:** the log shows a JSON object whose `sub` equals the line from the
command above and whose `aud` is `https://identity.docker.com`.

### 2. Create the connection in Docker Home

Open <https://app.docker.com/>, pick **acme** in the organisation switcher at
the top left, then **Identity & auth**, then **OIDC connections**, then
**Create OIDC connection**. Docker Home is behind sign-in, so the deep link
is whatever the address bar shows once you are on that page; keep it.

Fill the form with these values and add no second ruleset:

| Field | Value |
| --- | --- |
| Name or description, where the form offers one | `github-platform-publish` |
| Ruleset label | `publish-main` |
| Rule (subject claim) | The subject from step 1, pasted whole |
| Resources | Docker Hub repository `acme/app`, that one only, not all repositories |
| Scopes | Read and write (push). The job reads the repository back after writing to it |

Select **Create connection** and copy the **connection ID** it shows: a UUID,
five hyphenated groups of hex digits. It is an identifier, not a credential.
Without a token from your repository's `main` it grants nothing, which is why
it goes in a variable rather than a secret.

**Verify:** the OIDC connections list shows the connection as active, with
one ruleset. Nothing in the repository has changed yet, and nothing can
sign in yet, because no workflow names the ID.

### 3. Store the ID, then turn the job on

The ID first and the switch second, so no run ever sees the switch on
without an ID. PowerShell; it asks for the ID rather than reading the
clipboard, because copying this line replaces what the clipboard held:

```powershell
$id = (Read-Host 'Docker OIDC connection ID').Trim(); if ($id -match '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { gh variable set DOCKERHUB_CONNECTION --repo acme/platform --body $id } else { "That is not a connection ID (a UUID). It was: $id" }
```

Then:

```powershell
gh variable set DOCKERHUB_ENABLED --repo acme/platform --body true
```

**Verify:**

```powershell
gh variable get DOCKERHUB_CONNECTION --repo acme/platform; gh variable get DOCKERHUB_ENABLED --repo acme/platform
```

prints the UUID, then `true`. Variables, not secrets, on purpose: GitHub
prints variables in logs, which is what makes a wrong one diagnosable.

### 4. Add the job

A separate job after the one that publishes to `ghcr.io`, so the first
registry never waits on the second and **Re-run failed jobs** repeats only
the copy. Pinned to the commit SHAs of the two actions; the comments carry
the version each SHA is.

```yaml
  publish-dockerhub:
    name: Publish to Docker Hub
    needs: publish
    if: vars.DOCKERHUB_ENABLED == 'true'
    runs-on: ubuntu-26.04
    permissions:
      contents: read
      id-token: write # the Docker token exchange, and Sigstore's signing certificate
      attestations: write # store the provenance attestation
    env:
      DOCKERHUB_ORG: acme
      GHCR_IMAGE: ghcr.io/acme/app
      DOCKERHUB_IMAGE: docker.io/acme/app
      DIGEST: ${{ needs.publish.outputs.digest }}
    steps:
      - name: DOCKERHUB_CONNECTION holds a connection ID, and the digest arrived
        env:
          CONNECTION_ID: ${{ vars.DOCKERHUB_CONNECTION }}
        run: |
          set -euo pipefail
          uuid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          if [[ ! "$CONNECTION_ID" =~ $uuid ]]; then
            echo "::error::DOCKERHUB_ENABLED is true, but the repository variable DOCKERHUB_CONNECTION is not an OIDC connection ID (a UUID)."
            exit 1
          fi
          if [ -z "$DIGEST" ]; then
            echo "::error::The publish job passed no digest, so there is nothing to copy."
            exit 1
          fi

      - name: Log in to Docker Hub through the OIDC connection
        id: dockerhub-login
        uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0
        env:
          DOCKERHUB_OIDC_CONNECTIONID: ${{ vars.DOCKERHUB_CONNECTION }}
        with:
          registry: docker.io
          username: ${{ env.DOCKERHUB_ORG }}

      - name: Copy to Docker Hub by digest
        env:
          SHA: ${{ github.sha }}
        run: |
          set -euo pipefail
          docker buildx imagetools create --prefer-index=false \
            --tag "${DOCKERHUB_IMAGE}:${SHA}" \
            --tag "${DOCKERHUB_IMAGE}:latest" \
            "${GHCR_IMAGE}@${DIGEST}"
          got="$(docker buildx imagetools inspect "${DOCKERHUB_IMAGE}:${SHA}" --format '{{.Manifest.Digest}}')"
          if [ "$got" != "$DIGEST" ]; then
            echo "::error::${DOCKERHUB_IMAGE}:${SHA} is ${got} on Docker Hub, but ${DIGEST} on GHCR."
            exit 1
          fi

      - name: Attest provenance on Docker Hub
        uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2
        with:
          subject-name: ${{ env.DOCKERHUB_IMAGE }}
          subject-digest: ${{ env.DIGEST }}
          push-to-registry: true

      - name: Published digest on Docker Hub
        env:
          SHA: ${{ github.sha }}
        run: |
          set -euo pipefail
          {
            echo "## Published to Docker Hub"
            echo
            echo '```'
            echo "${DOCKERHUB_IMAGE}:${SHA}@${DIGEST}"
            echo '```'
          } | tee -a "$GITHUB_STEP_SUMMARY"
```

Four things worth noticing:

- **No `password`.** With `registry: docker.io`, no password and
  `DOCKERHUB_OIDC_CONNECTIONID` set, the action (v4.5.0 and later) does the
  exchange. The returned token is masked in the log and used by the steps
  that follow.
- **`id-token: write` on this job only.** The build job needs nothing but
  `contents: read`. Grant the token where it is used.
- **The first step checks the variable before anything else runs.** The
  action checks it too, but its message cannot say that the fix is a
  repository variable. A failed run that names the variable costs one read;
  one that says `bad status code 400` costs a search.
- **The copy and the attestation both take the digest from the publish job.**
  Nothing in this job reads a tag it did not just write.

Push the workflow to `main`, or dispatch it from `main`. A dispatch from
another branch presents a different `ref` and is refused at the login step,
which is the rule working.

**Verify:** the run shows the new job green, and its summary carries a
`Published to Docker Hub` block whose `sha256:` equals the one in the GHCR
job's summary.

### 5. Verify the image and its provenance from the outside

Two checks that need no access to the workflow, run against this site's
image so the output is the real thing. Substitute `acme/app` once yours has
published.

Pull from Docker Hub, anonymously, the exact digest GitHub's registry holds
for `latest`. A pull by digest succeeds only if Docker Hub has that
manifest. PowerShell:

```powershell
$d = docker buildx imagetools inspect ghcr.io/hybridcloudworks/hcw-lab:latest --format '{{.Manifest.Digest}}'; docker pull "hybridcloudworks/hcw-lab@$d"
```

bash:

```bash
d=$(docker buildx imagetools inspect ghcr.io/hybridcloudworks/hcw-lab:latest --format '{{.Manifest.Digest}}'); docker pull "hybridcloudworks/hcw-lab@$d"
```

**Verify:** the output ends with a `Digest: sha256:…` line equal to `$d` and
`Status: Downloaded newer image for …` or `Image is up to date`.

Then read the attestation stored on Docker Hub itself, not the copy in
GitHub's API, and check it against the repository and the branch you expect:

```powershell
gh attestation verify oci://docker.io/hybridcloudworks/hcw-lab:latest --repo HybridCloudWorks/HCW-HybridCloudWorks --bundle-from-oci --source-ref refs/heads/main
```

**Verify:** `✓ Verification succeeded!`, then a block naming the build
workflow `.github/workflows/publish-lab-image.yml@refs/heads/main`. Drop
`--bundle-from-oci` and the same command succeeds from GitHub's API instead,
because the API looks the digest up and finds the attestation either way.

### 6. Delete the token you no longer need

If an earlier setup left a Docker token in the repository:

```powershell
gh secret delete DOCKERHUB_TOKEN --repo acme/platform
```

and revoke it in Docker Home under the organisation's access tokens. A token
that still works is a token that can still be used.

**Verify:** `gh secret list --repo acme/platform` no longer lists it, and the
next run of the workflow publishes to Docker Hub anyway.

---

## How to know it worked

- **The run:** the Docker Hub job is green, and the `sha256:` in its summary
  equals the one in the GHCR job's summary.
- **Docker Hub:** `https://hub.docker.com/r/acme/app/tags` lists `latest` and
  the commit's full SHA.
- **The same bytes:** the pull by digest in step 5 succeeds against Docker
  Hub.
- **The provenance:** `gh attestation verify … --bundle-from-oci` succeeds
  and names your workflow on `refs/heads/main`.
- **Nothing stored:** `gh secret list --repo acme/platform` shows no Docker
  entry, and the connection's **Failures** table in Docker Home stays empty.

## When it doesn't work

**`Log in to Docker Hub through the OIDC connection` fails with
`Docker Hub API: bad status code 400: {"error":"access_denied"}`.** Docker
refused the exchange and says no more than that. It does not name the rule
that failed, which is why step 1 exists. Compare the `sub` your job presents
with the rule in the connection, character by character: the immutable form
against the name form is the usual mismatch, followed by a dispatch from a
branch other than `main`. Then open the connection's **Edit** page in Docker
Home: its **Failures** table lists each refused exchange with the reason. A
connection that was deactivated or deleted fails the same way; a deleted one
needs a new ID in step 3.

The first real run of this site's job ended here, with exactly that body.
The job now has an extra step that runs only when the login fails, requests
an ID token the same way the action did, and writes the token's `sub`, `aud`,
`ref` and `repository` claims (never the token) to the run summary beside
the rule the connection should hold. Add it to yours; it turns a search
into a comparison.

**A copy step fails with `unauthorized`, `insufficient_scope` or
`requested access to the resource is denied`.** The exchange succeeded and
the token's scope does not cover what the step tried. The ruleset's resources
do not include this repository, or its scopes stop at read. Edit the ruleset;
no workflow change.

**A copy or attest step fails as `unauthorized` minutes after the login
succeeded.** The Docker token expired: 300 seconds by default. Re-run the
failed job. If it keeps happening because the copy is large, set
`DOCKERHUB_OIDC_EXPIREIN` (300 to 3600) in the login step's `env`. The
variable is in the action's source rather than its README.

**`… is sha256:X on Docker Hub, but sha256:Y on GHCR.`** Something else
wrote the tag between the copy and the read-back. Do not re-run blindly:
find what else pushes to that repository.

**`Create OIDC connection` is missing, or the form refuses to save.** The
organisation's plan does not include the feature, or you are a member rather
than an owner or editor. Nothing in the repository needs changing; the job
stays skipped while `DOCKERHUB_ENABLED` is unset.

## If the organisation cannot create a connection yet

To put the current image on Docker Hub once, without storing a token
anywhere, copy it from your own machine as yourself. Sign in interactively
(`docker login` opens a device-code prompt), then copy by the digest GitHub's
registry holds, which keeps the digest:

```powershell
$d = docker buildx imagetools inspect ghcr.io/acme/app:latest --format '{{.Manifest.Digest}}'; docker buildx imagetools create --prefer-index=false --tag docker.io/acme/app:latest "ghcr.io/acme/app@$d"
```

**Verify:** `pushing sha256:… to docker.io/acme/app:latest`, and
`gh attestation verify oci://docker.io/acme/app:latest --repo acme/platform`
(without `--bundle-from-oci`) succeeds, because GitHub's API finds the GHCR
attestation by digest. No attestation sits on Docker Hub itself until the
workflow publishes there, which is the one thing this shortcut does not do.

---

## What's next

The lab image this article verifies is built in
[part 1](https://hybridcloudworks.com/docker/building-images) and run locally
in [part 2](https://hybridcloudworks.com/docker/desktop). The labs that use it
are at <https://hybridcloudworks.com/education/labs>, and more on Docker is on
the [Docker page](https://hybridcloudworks.com/docker).
