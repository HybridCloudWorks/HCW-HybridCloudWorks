---
title: Building a lab image you can trust
subtitle: One Dockerfile, two targets, every download checked against a pinned sum, and a provenance attestation you can verify yourself, with the image behind this site's labs as the worked example.
date: 2026-09-29
track: how-to
part: 1 of 3
tags: [docker, containers, supply-chain, provenance, github-actions]
reading: 17
---

`docker pull hybridcloudworks/hcw-lab:latest` downloads 497 MB and unpacks to
2.73 GB. Before you run anything inside it, one command tells you which
repository, which workflow and which branch produced exactly those bytes, and
fails if any of the three is not what you asked for:

```bash
gh attestation verify oci://docker.io/hybridcloudworks/hcw-lab:latest --repo saulpatinojr/HCW-HybridCloudWorks --bundle-from-oci
```

Trimmed to the verdict and the attestation it matched:

```text
Loaded digest sha256:7cb89818525b470b5bc9269481b8d8b643e142f969287a289da03db17d4fc9d0 for oci://docker.io/hybridcloudworks/hcw-lab:latest
Loaded 1 attestation from OCI registry

✓ Verification succeeded!

The following 1 attestation matched the policy criteria

- Attestation #1
  - Build repo:..... saulpatinojr/HCW-HybridCloudWorks
  - Build workflow:. .github/workflows/publish-lab-image.yml@refs/heads/main
  - Signer repo:.... saulpatinojr/HCW-HybridCloudWorks
  - Signer workflow: .github/workflows/publish-lab-image.yml@refs/heads/main
```

That digest was `latest` on 2026-10-08; yours will be whatever `latest` is on
the day you run it.

This part reads the Dockerfile behind that image, `lab-image/Dockerfile` in
this site's public repository, one decision at a time: why every base image is
pinned by digest, why one file builds two images, how the image works with the
network switched off, why it runs as uid 65534, what the smoke test refuses to
accept, and how the image reaches Docker Hub with no Docker password stored
anywhere. Then you build it, smoke-test it, and verify the published copy
yourself.

## What you'll have at the end

| Piece | Result |
| --- | --- |
| A reading of the Dockerfile | What each of its five `FROM` lines is for, and what the two images you can run carry |
| A local build | `hcw-lab:dev`, the `full` target, 2.73 GB on disk |
| A smoke test | `smoke: passed (full)`, from inside the image, with no network and a read-only mount |
| A verified pull | Exactly the digest Docker Hub serves for `latest`, with provenance that names the workflow and the branch |

## What it costs

**Nothing but disk.** Measured with Docker Desktop 4.93.0 (Docker Engine
29.8.1) on 2026-09-29, the published image is a 497 MB download and 2.73 GB on
disk, and a local build of the same target is the same size plus whatever
build cache the build leaves behind; `docker system df` shows how much. Docker
Hub serves the image publicly, so pulling needs no sign-in. Nothing in this
part touches a cloud account.

---

## Why it is built this way

### A digest, not a tag

Every `FROM` that names an image names it by digest:

```dockerfile
FROM python:3.14.7-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d AS fetch
```

A tag is a pointer its publisher can move. Official images are rebuilt when
their base or a security fix changes, so `python:3.14-slim-trixie` this week
and next month can be different bytes under the same name. A digest is the
hash of the image index itself: the build gets exactly those bytes or it
fails. The comment at the top of the Dockerfile says what the tag beside the
digest is for:

> The tag beside the digest is documentation (Docker resolves the digest and
> ignores the tag)

On 2026-09-29, `python:3.14.7-slim-trixie` and `python:3.14-slim-trixie` both
still resolved to that digest. The day either tag moves, this build does not.

The rejected alternative is the bare tag and a rebuild whenever you like. The
constraint that decided it: a lab written against Python 3.14.7 and Debian 13
has to meet Python 3.14.7 and Debian 13, and a base that changed under the same
name should be a change someone chose, in a commit, not a surprise in a
rebuild.

A pin you keep in step by hand drifts, so the value lives in one file,
`lab-image/versions.env`:

```sh
BASE_IMAGE=python:3.14.7-slim-trixie
BASE_DIGEST=sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d
BASE_PYTHON_VERSION=3.14.7
```

A `FROM` line cannot read a file, so the digest is necessarily written twice,
and the first step of the publishing workflow fails the build when the two
disagree. Each `FROM` must be either an earlier stage of the same file or
exactly `BASE_IMAGE@BASE_DIGEST`; a bare tag, a different digest or an unpinned
image fails. That step's script, run against `main` on 2026-09-29, trimmed to
this Dockerfile's lines (it checks a second Dockerfile in the directory the
same way):

```text
ok    Dockerfile: FROM python:3.14.7-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d
ok    Dockerfile: FROM fetch (earlier stage)
ok    Dockerfile: FROM fetch (earlier stage)
ok    Dockerfile: FROM python:3.14.7-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d
ok    Dockerfile: FROM runner (earlier stage)
Dockerfile: 5 FROM line(s), 2 pinned to python:3.14.7-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d
```

`BASE_PYTHON_VERSION` is for the smoke test further down: it compares
`python3 --version` with that line, so a digest bump that quietly moves Python
fails until someone moves the line as well.

### Every download against a checksum

The same rule applies to everything the build downloads. `versions.env` holds
a version and a SHA256 for each tool, and each `RUN` sources the file and
checks the download before it unpacks anything:

```dockerfile
    curl --proto '=https' --tlsv1.2 -fsSLo terraform.zip \
      "https://releases.hashicorp.com/terraform/${TERRAFORM_VERSION}/terraform_${TERRAFORM_VERSION}_linux_amd64.zip"; \
    echo "${TERRAFORM_SHA256}  terraform.zip" | sha256sum -c -; \
```

The `RUN` starts with `set -eu`, so a sum that does not match stops the build
there. In the words of the comment above it: "`sha256sum -c` exits non-zero on
a mismatch, and `set -e` turns that into a failed build rather than an
unverified binary."

Python packages follow the same rule by a different mechanism. ansible-core and
every wheel it depends on are listed as `name==version --hash=sha256:...`, and
pip runs with `--require-hashes`, which refuses a wheel whose sum differs and
also refuses any dependency the list does not name. The Azure CLI comes from
Microsoft's apt repository, whose signing key is itself checked by SHA256
before apt is allowed to trust it.

The alternative is an install script piped to a shell, or a package manager's
current version. Either gives you different bytes on a different day with no
record of which. Here a changed download is a failed build, and a new version
is a one-line change to `versions.env` in a pull request.

### Five stages, two you can run

The Dockerfile has five stages, and only the last two are images anyone runs:

| Stage | Built from | What it does | Ships |
| --- | --- | --- | --- |
| `fetch` | the pinned Python base | Downloads and verifies every tool, wheel and module tarball into `/out` | No |
| `vendor` | `fetch` | Vendors the modules those modules call, and points their sources at local copies | No |
| `mirror` | `fetch` | Builds the Terraform provider mirror and unpacks it | No |
| `runner` | the pinned Python base, again | terraform, kubeconform, helm and ansible-core, the provider mirror and the vendored modules. The site's own lab jobs run in this one | Yes |
| `full` | `runner` | Everything in `runner`, plus the Azure CLI, kubectl, git, curl and jq. `CMD` is `bash`. This is the image you pull | Yes |

`runner` starts again from the clean base and takes only what it needs from
the build stages:

```dockerfile
COPY --from=vendor /out/avm/ /opt/avm/
COPY --from=fetch /out/kubeconform/ /opt/kubeconform/
COPY --from=mirror /out/mirror/ /opt/terraform/mirror/
```

So the `curl`, `unzip` and `git` that `fetch` installs to do its downloading
never reach an image anyone runs, and `runner` has no apt layer at all. The
comment on `fetch` puts it in one line: "Nothing from this stage ships except
what later stages COPY out of /out."

One less obvious case. The ansible-core wheels are needed for one `RUN` and
never again, and copying them in then deleting them would leave them in the
earlier layer. So `runner` bind-mounts them from `fetch` for that one command:

```dockerfile
RUN --mount=type=bind,from=fetch,source=/out/wheels,target=/tmp/wheels \
    python3 -m venv /opt/ansible \
```

The comment beside it records what the other way cost: "a COPY and a later rm
kept 8.6 MB of them in the image". The same `RUN` then uninstalls pip and
proves it has gone, so the image carries exactly what `versions.env` names and
no way to add to it:

```dockerfile
 && test -z "$(command -v pip pip3 || true)"
```

Why two targets in one file, rather than two Dockerfiles? Because `full` has to
be `runner` plus tools, not a sibling that drifts from it. `FROM runner AS full`
makes every byte of `runner` part of `full` by construction, and
`--target` picks which one you build. The lab image's README measured the two
on 2026-09-27: `runner` 1.71 GB on disk and 319 MB to pull, `full` 2.73 GB and
497 MB.

### Offline by construction

The site's lab jobs run with no network, a read-only root filesystem and one
64 MB scratch directory. That constraint shaped two parts of the image.

**A provider mirror.** `terraform init` normally asks the Terraform registry
for every provider. The image points `TF_CLI_CONFIG_FILE` at a file with a
filesystem mirror and no fallback, written in the `runner` stage:

```dockerfile
 && printf '%s\n' \
      'provider_installation {' \
      '  filesystem_mirror {' \
      '    path    = "/opt/terraform/mirror"' \
      '    include = ["registry.terraform.io/*/*"]' \
      '  }' \
      '}' > /etc/terraform/terraformrc
```

With no `direct {}` block, a provider the mirror does not carry fails `init`
at once, naming the mirror, instead of hanging on a registry that cannot
answer. The `mirror` stage runs `terraform providers mirror`, checks every zip
against the SHA256 in `versions.env`, and then unpacks them all. Unpacked,
because of how `init` treats each layout: from zips it extracts each provider
into `.terraform`, and azurerm alone is a 225 MB copy, more than three times
the lab job's scratch space; from an unpacked mirror it creates a symlink. The
cost is disk, not download: 931 MB of binaries unpacked against 191 MB of zips,
and a layer is compressed in transit whichever form its files take.

**Vendored modules under `/opt/avm`.** Terraform has a provider mirror but no
module mirror. So the image vendors every Azure Verified Module the
[Landing Zone Builder](https://hybridcloudworks.com/tools/landing-zone) emits,
from each module's release tarball and checked by SHA256, into
`/opt/avm/<name>@<version>`. Then it vendors every registry module those call,
each pinned by a hash of its whole directory tree, and rewrites their `source`
lines to local paths. On 2026-09-29 that was four builder modules and seventeen
children. A command in the image, `hcw-terraform-validate`, copies your folder
to scratch space, points each module call a vendored copy satisfies at that
copy, and only then runs `init` and `validate`, on the copy. Your own files keep
their registry sources and are never changed. The Terraform lab series on this
site takes a landing zone through that step by step.

### uid 65534, and nothing written to /workspace

Both targets end the same way:

```dockerfile
USER 65534:65534
WORKDIR /workspace
```

uid 65534 is Debian's `nobody`, and the build gives it exactly two
directories of its own, `/tmp/home` and `/tmp/run`. The lab jobs mount
`/workspace` read-only, so the image sends everything its tools write to
`/tmp`, image-wide:

```dockerfile
ENV TF_CLI_CONFIG_FILE=/etc/terraform/terraformrc \
    TF_DATA_DIR=/tmp/run/.terraform \
    TF_IN_AUTOMATION=1 \
    CHECKPOINT_DISABLE=1 \
    TMPDIR=/tmp/run \
    HOME=/tmp/home \
    ANSIBLE_LOCAL_TEMP=/tmp/run/ansible \
    HELM_CACHE_HOME=/tmp/run/helm/cache \
    HELM_CONFIG_HOME=/tmp/run/helm/config \
    HELM_DATA_HOME=/tmp/run/helm/data
```

`TMPDIR` is the line with a story. A Terraform provider is a plugin process
that opens a Unix socket in `TMPDIR` before it prints anything. With `TMPDIR`
on the read-only root, every provider died silently, and `terraform validate`
reported the symptom rather than the cause: `Failed to read any lines from
plugin's stdout`, for all six providers, after an `init` that had succeeded.
Nothing in that message mentions a temporary directory.

`CHECKPOINT_DISABLE=1` turns off Terraform's version check, the one network
request `terraform init` would otherwise still make.

The `full` target changes one thing for people. Debian ships `nobody` with no
login shell and a home of `/nonexistent`: right for `runner`, where nothing
ever opens a shell, and wrong for an interactive workspace, whose terminal runs
through the user's login shell. So `full` gives uid 65534 bash and a home, and
checks its own change in the same `RUN`:

```dockerfile
RUN usermod -s /bin/bash -d /tmp/home nobody \
 && test "$(getent passwd 65534 | cut -d: -f6,7)" = "/tmp/home:/bin/bash"
```

### A smoke test that refuses to pass for the wrong reason

`lab-image/smoke.sh` runs inside the image, with the `lab-image` directory
mounted at `/workspace`. Its header says what it checks first:

> It checks the conditions the image is built for before it checks the tools:
> that there is no network (an init that passed with network proves nothing
> about the mirror), that /workspace is read-only, and that it runs as uid
> 65534.

Then it compares every tool's version with `versions.env`, checks every
mirrored provider is present unpacked, re-hashes every vendored module against
its pin, and runs `terraform init -backend=false` and `terraform validate`
with no network against a small root and one root per builder module. Each
`init` must symlink every provider and download no module. Every check runs
even after one fails, and the script exits non-zero if any did.

The publishing workflow runs it on every pull request that touches the image,
and again in the publish job, on the exact image it is about to push.

### Provenance from the workflow, not from a laptop

`.github/workflows/publish-lab-image.yml` has four jobs, and the first two keep
building and publishing apart:

- **Build and smoke** runs first on every trigger, including every pull
  request that touches the image. It builds both targets, smoke-tests them and
  holds a read-only token and nothing else, because a pull request can edit
  the workflow and run any shell step in it.
- **Publish to Docker Hub** runs only on a push to `main`, or a manual run
  from `main`. It builds again, smoke-tests what it built, pushes those exact
  images to Docker Hub with `docker push`, and attests them. It holds what the
  build job does not:

```yaml
    permissions:
      contents: read
      id-token: write # the Docker token exchange, and Sigstore's signing certificate
      attestations: write
      artifact-metadata: write
```

- **The last two** run after a publish. The site's labs run each image by its
  digest, never by a tag, so these read the new digests back from Docker Hub
  and open a pull request that moves the pins to them. A publish changes what
  `latest` names at once, and what the labs run only when that pull request
  is merged.

`artifact-metadata: write` lets the attestation step record where the image is
stored on the repository's linked artifacts page. The attestation step names
the image and the digest that was just pushed:

```yaml
      - name: Attest full provenance
        uses: actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2
        with:
          subject-name: ${{ env.FULL_IMAGE }}
          subject-digest: ${{ steps.push-full.outputs.digest }}
          push-to-registry: true
```

`id-token: write` lets the job ask GitHub for an OIDC token that says which
repository, workflow, branch and commit it is running. That identity goes into
a short-lived signing certificate, the certificate signs a SLSA provenance
statement about the digest, and `push-to-registry` stores the signed bundle in
the registry beside the image. That is what `gh attestation verify` read at the
top of this page. It proves where the bytes came from. It does not prove the
code that built them is free of bugs; that is what the smoke test and code
review are for.

The build steps set `provenance: false` on `docker/build-push-action`, which
looks backwards until you see what a local build does by default. Building the
`full` target on Docker Desktop 4.93.0 ended with these lines:

```text
#31 exporting manifest sha256:ce4dff030044154d3cf3c01ec202697b02c07b560bd0a741a4d38896cacc5daf done
#31 exporting config sha256:c53a1540f8bba3865266c0c53a7387588f60d3d8e75bf666623d5c711270fac3 done
#31 exporting attestation manifest sha256:2563693cf8562293dc66681d93f6bac359bc1cde1e3a189b86fa1f27d9a55df7 0.1s done
#31 exporting manifest list sha256:aa9c6ecd01c528f286c12462e270fb034366db02ef06ea162d9398cc5b37e732 0.0s done
```

BuildKit attached its own attestation and wrapped the image in a manifest list,
so the ID you see locally is the list's digest, not the image's. The workflow
turns that off. The pushed image stays one plain manifest whose digest is the
one `docker pull` reports, and the provenance comes from
`actions/attest-build-provenance` instead, signed by the workflow's identity.

### Straight to Docker Hub, no Docker token

The publish job signs in to Docker Hub after the builds and the smoke tests,
and with no password:

```yaml
      - name: Log in to Docker Hub through the OIDC connection
        id: dockerhub-login
        uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0
        env:
          DOCKERHUB_OIDC_CONNECTIONID: ${{ vars.DOCKERHUB_CONNECTION }}
          DOCKERHUB_OIDC_EXPIREIN: '900'
        with:
          registry: docker.io
          username: ${{ env.DOCKERHUB_ORG }}
```

The missing `password` line is the point. The action asks GitHub for an OIDC
token addressed to Docker, exchanges it with Docker for an access token, and
logs in with that. The token lasts 300 seconds by default; this job asks for
900, because its pushes upload every new layer from the runner, and signing in
only after the tests means that time is spent on the pushes and the
attestations alone.

On Docker's side, an OIDC connection trusts one subject, this repository's
`main` branch in GitHub's immutable form:

```text
repo:saulpatinojr@34853639/HCW-HybridCloudWorks@1268997852:ref:refs/heads/main
```

The numbers are the owner's and the repository's IDs, so a future repository
reusing either name cannot match it. The connection ID in
`vars.DOCKERHUB_CONNECTION` is an identifier, not a secret; without a token
from that branch it grants nothing.

The rejected alternative is an organisation access token in a GitHub secret.
It would work with the same action today, and it would sit there until someone
rotated it, tied to no repository, branch or workflow.

Then the job pushes the image it smoke-tested, under the commit's SHA and
`latest`, and reads the digest back from Docker Hub rather than working it out
locally:

```yaml
          docker tag hcw-lab:ci "${FULL_IMAGE}:${TAG}"
          docker tag hcw-lab:ci "${FULL_IMAGE}:latest"
          docker push "${FULL_IMAGE}:${TAG}"
          docker push "${FULL_IMAGE}:latest"
          digest="$(docker buildx imagetools inspect "${FULL_IMAGE}:${TAG}" --format '{{.Manifest.Digest}}')"
```

`FULL_IMAGE` is `docker.io/hybridcloudworks/hcw-lab`, with `docker.io` as the
registry part because that is the form the attestation action documents for
Docker Hub. Because the build set `provenance: false`, `docker push` writes one
plain manifest, so the digest read back is the one `docker pull` reports. The
attestation step takes that digest and pushes its bundle to Docker Hub beside
the image, which is where `--bundle-from-oci` found it at the top of this page.

---

## Prerequisites

The commands in this article are also kept as a reference page, checked against
the repository, at <https://hybridcloudworks.com/docker/building-images>.

- Docker, with the `buildx` plugin, which Docker Desktop includes and Docker's
  Linux packages provide as `docker-buildx-plugin`. Checked with Docker
  Desktop 4.93.0 and Docker Engine 29.8.1. Part 2 covers installing Docker
  Desktop.
- git.
- The GitHub CLI, signed in: `gh auth status` names your account. Checked with
  gh 2.102.0 while signed in; not tried signed out.
- Disk for two 2.73 GB images, the one you build and the one you pull, plus
  the build cache.
- No registry login, no cloud account.

On Windows, run the PowerShell lines. The bash lines are for macOS, Linux and
the shell inside a WSL distribution.

Every output quoted in this part was measured on Windows 11, from a checkout
of the repository's `main` branch: the provenance checks on 2026-10-08 with gh
2.102.0, and everything else on 2026-09-29 with Docker Desktop 4.93.0.

---

## The steps

### 1. Get the source and find the pins

PowerShell or bash:

```bash
git clone --depth 1 https://github.com/saulpatinojr/HCW-HybridCloudWorks.git
```

```bash
cd HCW-HybridCloudWorks
```

Every command from here runs in that folder. List the `FROM` lines.

PowerShell:

```powershell
Select-String -Path lab-image/Dockerfile -Pattern '^FROM'
```

bash:

```bash
grep '^FROM' lab-image/Dockerfile
```

**Verify:** five lines. Two name `python:3.14.7-slim-trixie@sha256:51dafde8…`,
and the other three name earlier stages:

```text
FROM python:3.14.7-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d AS fetch
FROM fetch AS vendor
FROM fetch AS mirror
FROM python:3.14.7-slim-trixie@sha256:51dafde81dbdb6ebde285137a295cf18a47ca95234fe388a343719cb97305b3d AS runner
FROM runner AS full
```

PowerShell prints the same lines, each prefixed with the file name and line
number.

### 2. Build the full target

PowerShell or bash:

```bash
docker build --target full -t hcw-lab:dev lab-image
```

The first build downloads every tool, provider and module and checks each
against its sum; a rebuild with nothing changed comes from the cache. The
first, uncached build was not timed for this article.

**Verify:**

```bash
docker image ls hcw-lab:dev
```

```text
IMAGE         ID             DISK USAGE   CONTENT SIZE   EXTRA
hcw-lab:dev   aa9c6ecd01c5       2.73GB          497MB
```

Your ID will differ. It is the digest of the manifest list BuildKit wrapped
around the image, as described above, and this article makes no claim that a
local build reproduces the published digest byte for byte. The provenance is
the evidence for the published image, not a rebuild you would have to match.

### 3. Run the smoke test with the network off

PowerShell:

```powershell
docker run --rm --network none -v "${PWD}\lab-image:/workspace:ro" hcw-lab:dev bash /workspace/smoke.sh full
```

bash:

```bash
docker run --rm --network none -v "$PWD/lab-image:/workspace:ro" hcw-lab:dev bash /workspace/smoke.sh full
```

`--network none` and `:ro` are not optional here: the script checks for both
and fails without them. Trimmed to the conditions and the verdict:

```text
== sandbox conditions
ok:   no network
ok:   /workspace is read-only
ok:   running as uid 65534

== runner tools
ok:   python3 Python 3.14.7
ok:   terraform Terraform v1.16.4
ok:   kubeconform v0.8.0
…
ok:   4 builder modules vendored
…
ok:   17 vendored child modules pinned
…
smoke: passed (full)
```

**Verify:** the last line is `smoke: passed (full)`, and the exit code is 0:
`$LASTEXITCODE` in PowerShell, `echo $?` in bash.

### 4. Pull the published image, by the digest Docker Hub serves

This asks Docker Hub for the digest of `latest`, prints it, then pulls exactly
that digest. A tag can move between two commands; a digest cannot, so what
you pull is the image whose digest you just read.

PowerShell:

```powershell
$d = docker buildx imagetools inspect docker.io/hybridcloudworks/hcw-lab:latest --format '{{.Manifest.Digest}}'; $d; docker pull "hybridcloudworks/hcw-lab@$d"
```

bash:

```bash
d=$(docker buildx imagetools inspect docker.io/hybridcloudworks/hcw-lab:latest --format '{{.Manifest.Digest}}'); echo "$d"; docker pull "hybridcloudworks/hcw-lab@$d"
```

**Verify:** the first line is a `sha256:` digest, and the output ends with a
`Digest:` line holding the same value and
`Status: Downloaded newer image for hybridcloudworks/hcw-lab@sha256:…` or, if
you already had it, `Status: Image is up to date for …`.

### 5. Verify the provenance

PowerShell or bash:

```bash
gh attestation verify oci://docker.io/hybridcloudworks/hcw-lab:latest --repo saulpatinojr/HCW-HybridCloudWorks --bundle-from-oci
```

`--bundle-from-oci` reads the attestation stored beside the image on Docker
Hub, rather than asking GitHub's API for it. On 2026-10-08 it loaded one, for
the digest `latest` named and from the workflow run that pushed it, and printed
the policy it enforced before the verdict:

```text
The following policy criteria will be enforced:
- Predicate type must match:................ https://slsa.dev/provenance/v1
- Source Repository Owner URI must match:... https://github.com/saulpatinojr
- Source Repository URI must match:......... https://github.com/saulpatinojr/HCW-HybridCloudWorks
- Subject Alternative Name must match regex: (?i)^https://github\.com/saulpatinojr/HCW-HybridCloudWorks/
- OIDC Issuer must match:................... https://token.actions.githubusercontent.com

✓ Verification succeeded!
```

That policy accepts any workflow in the repository, on any branch. To insist on
the one workflow and on `main`, which is what `gh attestation verify --help`
recommends for the signer workflow, add two flags:

```bash
gh attestation verify oci://docker.io/hybridcloudworks/hcw-lab:latest --repo saulpatinojr/HCW-HybridCloudWorks --bundle-from-oci --signer-workflow saulpatinojr/HCW-HybridCloudWorks/.github/workflows/publish-lab-image.yml --source-ref refs/heads/main
```

**Verify:** `✓ Verification succeeded!`, with the policy now listing
`Source repo ref must match:............... refs/heads/main` and a Subject
Alternative Name regex that names `publish-lab-image\.yml`.

---

## How to know it worked

- `grep` or `Select-String` shows five `FROM` lines, two of them pinned to the
  same digest.
- `docker image ls hcw-lab:dev` shows 2.73GB on disk and 497MB of content.
- `smoke.sh` ends `smoke: passed (full)` and exits 0, with the network off and
  the mount read-only.
- The pull by digest succeeds, and its `Digest:` line holds the digest Docker
  Hub reported for `latest`.
- `gh attestation verify` ends `✓ Verification succeeded!`, naming
  `.github/workflows/publish-lab-image.yml@refs/heads/main`.

The smoke test and the verification answer different questions. The smoke test
says the image does what it claims when nothing outside it can help. The
verification says the image you pulled is the one that workflow built from
that branch. Neither stands in for the other.

---

## When it doesn't work

**`FAIL: the network is reachable; run with --network none, or the offline init below proves nothing`**,
then `smoke: FAILED (full)` at the end. You left out `--network none`. Every
other check still runs and may well pass, which is the point of the refusal: an
offline `init` that had a network proves nothing about the mirror. The script
has the same kind of line for a writable mount,
`FAIL: /workspace is writable; mount it read-only (:ro)`.

**`terraform.zip: FAILED` and `sha256sum: WARNING: 1 computed checksum did NOT match`**
during the build. A download no longer matches the sum in `versions.env`. The
build stopped where it should. Do not edit the sum to match what arrived; find
out why the file changed, and take the new sum from the publisher's own
checksum file if the change is a real release.

**`✗ Policy verification failed`**, then a line such as
`Error: expected SourceRepositoryRef to be refs/heads/dev, got refs/heads/main`.
The attestation is valid but does not match the policy you asked for; the
error names the field and both values. Here the command asked for `dev` and
the image was built from `main`. Check the flags before suspecting the image.

**`bash: C:/Program Files/Git/workspace/smoke.sh: No such file or directory`**,
exit code 127. You ran the bash line of step 3 in Git Bash on Windows, which
rewrites arguments that look like Unix paths into Windows paths before Docker
sees them: `/workspace/smoke.sh` became a path under Git's own install folder.
The error names a file that was never meant to exist. Use the PowerShell line
on Windows.

---

## What's next

Part 2, "Docker Desktop for the labs", installs Docker Desktop on Windows or
macOS, sizes it for this image, and runs the labs' follow-along command in your
own folder. More on Docker is on the
[Docker page](https://hybridcloudworks.com/docker).

The labs that run in this image are at
<https://hybridcloudworks.com/education/labs>.
