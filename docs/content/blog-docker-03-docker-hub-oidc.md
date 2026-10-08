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
token that lasts minutes. Nothing is stored anywhere. This article sets
that up for one repository and one branch, pushes an image to Docker Hub and
reads its digest back, and verifies the result from the outside.

Part 1 of this series built the image and showed the login step in passing.
This part is the whole of that step: the claim, the rule, the exchange, and
what to read when Docker says no.

---

## What you'll have at the end

- An OIDC connection in your Docker organisation that trusts exactly one
  subject: the `main` branch of one repository, in GitHub's immutable form.
- A workflow job that builds and smoke-tests an image, signs in to Docker Hub
  with no password, pushes **exactly the bytes it tested**, reads the digest
  back from Docker Hub, and pushes a provenance attestation beside the image.
- Two repository variables, `DOCKERHUB_CONNECTION` and `DOCKERHUB_ENABLED`,
  and no new secret.
- Three commands that prove, from any machine, that the image on Docker Hub
  is the one the workflow built.

The worked example is this site's lab image, which has signed in to Docker
Hub this way since 2026-09-29. The names in the steps are generic (`acme`,
`acme/platform`, `acme/app`); the verification at the end runs against the
real image, so you can see what success prints before you have an image of
your own.

## What it costs

Nothing per push. Docker Hub public repositories are free, and so is the
token exchange.

The one gate is the subscription. OIDC connections are a feature of Docker
Team and Business organisations, and of the Docker-Sponsored Open Source
programme. A free organisation sees an upgrade prompt where the
**Create OIDC connection** button should be. Until it has one or the other,
the job in step 4 stays skipped, and nothing is published.

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

### Push what was tested, then read it back

A job cannot take another job's Docker state, so the publishing job builds the
image itself (a layer cache can make that fast), runs the smoke test on what it
built, and pushes those same bytes with `docker push`. The image that passed
the test is the image on Docker Hub, by identity rather than by rebuilding
something that should match. The build sets `provenance: false`, so the image
stays one plain manifest whose digest is the one `docker pull` reports. Then
the job reads that digest back from Docker Hub, by the tag it has just pushed,
rather than working it out locally. That one `sha256:` is the fact everything
after this depends on: the attestation names it, and anyone who pins the image
pins it.

### The attestation beside the image

`actions/attest-build-provenance` with `push-to-registry: true` takes exactly
one fully qualified subject and stores the signed bundle in that subject's
registry. So the job attests the image under its `docker.io` name, the form
the action documents for Docker Hub, and the bundle lands on Docker Hub beside
the image. GitHub's attestation API keeps a copy keyed on the digest, so a
verifier can read either one: the bundle on Docker Hub, or the API.

---

## Prerequisites

- A GitHub repository with a Dockerfile, and a workflow whose `build` job
  builds and tests the image on every pull request with a read-only token.
  Part 1 has one. The YAML below adds the job that publishes; it assumes the
  Dockerfile is at the repository root and that `test/smoke.sh` tests the
  image from inside it.
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

A second job, after `build`, that runs only from `main`, so nothing a pull
request can change ever runs with a token that can publish. It builds the
image again, because a job cannot take another job's Docker state, tests what
it built, and pushes exactly that. Every action is pinned to a commit SHA; the
comments carry the version each SHA is.

```yaml
  publish:
    name: Publish to Docker Hub
    needs: build
    if: vars.DOCKERHUB_ENABLED == 'true' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-26.04
    permissions:
      contents: read
      id-token: write # the Docker token exchange, and Sigstore's signing certificate
      attestations: write # store the provenance attestation
      artifact-metadata: write # the attestation's storage record in GitHub
    env:
      DOCKERHUB_ORG: acme
      IMAGE: docker.io/acme/app
    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
        with:
          persist-credentials: false

      - name: DOCKERHUB_CONNECTION holds a connection ID
        env:
          CONNECTION_ID: ${{ vars.DOCKERHUB_CONNECTION }}
        run: |
          set -euo pipefail
          uuid='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          if [[ ! "$CONNECTION_ID" =~ $uuid ]]; then
            echo "::error::DOCKERHUB_ENABLED is true, but the repository variable DOCKERHUB_CONNECTION is not an OIDC connection ID (a UUID)."
            exit 1
          fi

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1

      - name: Build
        uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
        with:
          context: .
          load: true
          push: false
          provenance: false
          tags: app:ci

      - name: Smoke test what was built
        run: docker run --rm --network none -v "${GITHUB_WORKSPACE}/test:/workspace:ro" app:ci sh /workspace/smoke.sh

      - name: Log in to Docker Hub through the OIDC connection
        id: dockerhub-login
        uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0
        env:
          DOCKERHUB_OIDC_CONNECTIONID: ${{ vars.DOCKERHUB_CONNECTION }}
          DOCKERHUB_OIDC_EXPIREIN: '900'
        with:
          registry: docker.io
          username: ${{ env.DOCKERHUB_ORG }}

      - name: Push, and read the digest back
        id: push
        env:
          SHA: ${{ github.sha }}
        run: |
          set -euo pipefail
          docker tag app:ci "${IMAGE}:${SHA}"
          docker tag app:ci "${IMAGE}:latest"
          docker push "${IMAGE}:${SHA}"
          docker push "${IMAGE}:latest"
          digest="$(docker buildx imagetools inspect "${IMAGE}:${SHA}" --format '{{.Manifest.Digest}}')"
          test -n "$digest"
          echo "digest=${digest}" >> "$GITHUB_OUTPUT"

      - name: Attest provenance on Docker Hub
        uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2
        with:
          subject-name: ${{ env.IMAGE }}
          subject-digest: ${{ steps.push.outputs.digest }}
          push-to-registry: true

      - name: Published digest on Docker Hub
        env:
          SHA: ${{ github.sha }}
          DIGEST: ${{ steps.push.outputs.digest }}
        run: |
          set -euo pipefail
          {
            echo "## Published to Docker Hub"
            echo
            echo '```'
            echo "${IMAGE}:${SHA}@${DIGEST}"
            echo '```'
          } | tee -a "$GITHUB_STEP_SUMMARY"
```

Five things worth noticing:

- **No `password`.** With `registry: docker.io`, no password and
  `DOCKERHUB_OIDC_CONNECTIONID` set, the action (v4.5.0 and later) does the
  exchange. The returned token is masked in the log and used by the steps
  that follow.
- **`id-token: write` on this job only.** The build job needs nothing but
  `contents: read`. Grant the token where it is used.
- **The variable is checked before anything is built.** The action checks it
  too, but only at the login, after the build, and its message cannot say
  that the fix is a repository variable. A failed run that names the variable
  costs one read; one that says `bad status code 400` costs a search.
- **The job pushes what it tested.** The smoke test runs on `app:ci`, and the
  pushes are tags of that same image, so the bytes on Docker Hub are the bytes
  that passed. The digest comes back from Docker Hub, and the attestation
  names it. Nothing in this job reads a tag it did not just write.
- **The login waits for the test, and asks for 900 seconds.** A Docker token
  lasts 300 seconds by default, and a push uploads every new layer from the
  runner. Signing in only after the build and the test, with
  `DOCKERHUB_OIDC_EXPIREIN` (300 to 3600) raised, spends the token on the
  pushes and the attestation alone. The variable is in the action's source
  rather than its README.

Push the workflow to `main`, or dispatch it from `main`. A dispatch from
another branch skips the job, and if the condition were ever dropped, Docker
would still refuse it at the login step, because it presents a different
`ref`. That is the rule working on its own.

**Verify:** the run shows the publish job green, and its summary carries a
`Published to Docker Hub` block naming `docker.io/acme/app`, the commit's SHA
and a `sha256:` digest.

### 5. Verify the image and its provenance from the outside

Two checks that need no access to the workflow, run against this site's
image so the output is the real thing. Substitute `acme/app` once yours has
published.

Read the digest Docker Hub serves for `latest`, then pull exactly that
digest, anonymously. A pull by digest gets those bytes or fails; a tag could
have moved in between, a digest cannot. PowerShell:

```powershell
$d = docker buildx imagetools inspect docker.io/hybridcloudworks/hcw-lab:latest --format '{{.Manifest.Digest}}'; $d; docker pull "hybridcloudworks/hcw-lab@$d"
```

bash:

```bash
d=$(docker buildx imagetools inspect docker.io/hybridcloudworks/hcw-lab:latest --format '{{.Manifest.Digest}}'); echo "$d"; docker pull "hybridcloudworks/hcw-lab@$d"
```

**Verify:** the first line is the digest, and the output ends with a
`Digest: sha256:…` line equal to it and `Status: Downloaded newer image for …`
or `Image is up to date`.

Then read the attestation stored on Docker Hub itself, not the copy in
GitHub's API, and check it against the repository and the branch you expect:

```powershell
gh attestation verify oci://docker.io/hybridcloudworks/hcw-lab:latest --repo saulpatinojr/HCW-HybridCloudWorks --bundle-from-oci --source-ref refs/heads/main
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

- **The run:** the publish job is green, and its summary carries the image,
  the commit's SHA and the `sha256:` it read back from Docker Hub.
- **Docker Hub:** `https://hub.docker.com/r/acme/app/tags` lists `latest` and
  the commit's full SHA.
- **The published bytes:** a pull by the digest in the summary succeeds
  against Docker Hub, as the pull in step 5 does for this site's image.
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

**A push step fails with `unauthorized`, `insufficient_scope` or
`requested access to the resource is denied`.** The exchange succeeded and
the token's scope does not cover what the step tried. The ruleset's resources
do not include this repository, or its scopes stop at read. Edit the ruleset;
no workflow change.

**A push or attest step fails as `unauthorized` minutes after the login
succeeded.** The Docker token expired: 900 seconds in the job above, 300 by
default. Re-run the failed job. If it keeps happening because the push is
large, raise `DOCKERHUB_OIDC_EXPIREIN` in the login step's `env`, up to 3600.

**`Create OIDC connection` is missing, or the form refuses to save.** The
organisation's plan does not include the feature, or you are a member rather
than an owner or editor. Nothing in the repository needs changing; the job
stays skipped while `DOCKERHUB_ENABLED` is unset.

---

## What's next

The lab image this article verifies is built in
[part 1](https://hybridcloudworks.com/docker/building-images) and run locally
in [part 2](https://hybridcloudworks.com/docker/desktop). The labs that use it
are at <https://hybridcloudworks.com/education/labs>, and more on Docker is on
the [Docker page](https://hybridcloudworks.com/docker).
