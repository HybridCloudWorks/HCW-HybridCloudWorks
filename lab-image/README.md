# hcw-lab image

One Dockerfile, two targets, published to GHCR by
[`publish-lab-image.yml`](../.github/workflows/publish-lab-image.yml) on every
push to `main` that touches this directory (issue #658, Phase 1 in #674,
Phase 2 in #675).

| Target   | Image                                     | Carries                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runner` | `ghcr.io/hybridcloudworks/hcw-lab-runner` | terraform, kubeconform, helm, ansible-core; a Terraform provider filesystem mirror at `/opt/terraform/mirror`; the AVM pattern modules and every registry module they call at `/opt/avm/<name>@<version>`; one release of the Kubernetes JSON schemas at `/opt/kubeconform/schemas`; the three capability commands in [`bin/`](bin/). Runs as uid 65534 (`nobody`) with `/workspace` mounted read-only. This is what `vps-agent` runs jobs in. |
| `full`   | `ghcr.io/hybridcloudworks/hcw-lab`        | Everything in `runner`, plus Azure CLI, kubectl, git, curl, jq and the three packages code-server needs (`ca-certificates`, `libatomic1`, `procps`); uid 65534's shell is `bash` and its home `/tmp/home`, because Coder runs everything through the passwd shell (#693). `CMD` is `bash`. This is what a lab page tells a learner to pull, and the base of the Coder template.                                                            |

Both targets are built on the official `python:3.14.7-slim-trixie` image,
pinned by index digest: CPython 3.14.7 on Debian 13 (trixie). ansible-core,
`hcw-terraform-validate` and the build-time vendoring all run on that
Python; no Debian `python3` package is installed, and the image carries no
`pip` command. [`versions.env`](versions.env) says why every stage, the
build-only ones included, uses the one base.

Every version and checksum is in [`versions.env`](versions.env); the
Dockerfile repeats none of them except the base image reference, which a
`FROM` line cannot read from a file. The workflow fails the build if any
`FROM` that is not an earlier stage differs from `BASE_IMAGE@BASE_DIGEST`
there, and checks the sandbox template's `FROM` against
`SANDBOX_BASE_IMAGE@SANDBOX_BASE_DIGEST` the same way.

## Sizes

Measured on 2026-09-25 with Docker 29.8.0 (`docker image ls`, which since
Docker 29 reports both the unpacked size on disk and the compressed size a
pull transfers), on the Python 3.14.7 / Debian 13 base:

| Target   | On disk | Compressed (what a pull downloads) |
| -------- | ------- | ---------------------------------- |
| `runner` | 1.71 GB | 319 MB                             |
| `full`   | 2.73 GB | 497 MB                             |

On the Debian 12 base with its Python 3.11 the same day, the two measured
1.70 GB / 319 MB and 2.69 GB / 491 MB. The runner stays level because the
python image (135 MB) replaces both bookworm-slim and the apt layer that
added Debian's python3 and ansible-core's dependencies (150 MB together);
what grows is the ansible venv (52 MB against 22 MB), which now carries its
own dependency wheels, cryptography's statically linked OpenSSL among them,
instead of reusing Debian's packages. The wheels are bind-mounted into the
one `RUN` that installs them, so they add no layer of their own.

Phase 1 measured 880 MB / 311 MB and 1.88 GB / 484 MB. The on-disk growth is
the provider mirror, now unpacked (931 MB of binaries where the zips were
191 MB) so that `terraform init` symlinks providers instead of extracting
them; see "What works offline". The pull size barely moved, because a layer
is compressed in transit whichever form the binaries take on disk. The
vendored module tree is 6 MB and the Kubernetes schemas 62 MB on disk.

## Run the toolchain locally

The `full` image is the follow-along toolchain for the lab pages. Pull it,
then run it with the current directory mounted at `/workspace`; both
commands drop into `bash` there as `nobody`. Anonymous pulls work once the
owner has made both packages public at
<https://github.com/orgs/HybridCloudWorks/packages> (the owner step in #674);
until then `docker login ghcr.io` with a token holding `read:packages` is
needed first.

PowerShell:

```powershell
docker pull ghcr.io/hybridcloudworks/hcw-lab:latest
```

```powershell
docker run --rm -it -v "${PWD}:/workspace" ghcr.io/hybridcloudworks/hcw-lab:latest
```

bash:

```bash
docker pull ghcr.io/hybridcloudworks/hcw-lab:latest
```

```bash
docker run --rm -it -v "$PWD:/workspace" ghcr.io/hybridcloudworks/hcw-lab:latest
```

A successful run prints a `nobody@<container id>:/workspace$` prompt, and
`terraform version` there reports the version in `versions.env`. Add `:ro`
to the mount to run the way the job sandbox does. For anything automated,
pin the digest rather than the tag, exactly as
[`vps-agent/lib/capabilities.js`](../vps-agent/lib/capabilities.js) does:
the publish workflow writes each pushed image's digest to its job summary,
and that is the first-party place to copy it from.

## What works offline

The runner is built so that a lab job needs no network at all, because
`vps-agent` runs every job under `--network none` on a read-only root with
one 64 MB tmpfs at `/tmp/run`. Precisely:

- **Providers: yes, and symlinked.** `TF_CLI_CONFIG_FILE` points at a
  `provider_installation { filesystem_mirror { ... } }` block with no
  `direct` fallback, so Terraform installs from `/opt/terraform/mirror` and
  nowhere else. The mirror holds azurerm 5.7.0 and 4.81.0, azapi 2.12.0, alz
  0.22.0, random 3.9.1, modtm 0.4.0 and time 0.14.2, each zip verified after
  mirroring against the SHA256 the registry publishes for it and then
  unpacked into the directory layout. Unpacked matters: from a packed mirror
  `terraform init` extracts the provider into `.terraform/providers` (225 MB
  for azurerm, more than the job's tmpfs), from an unpacked one it creates a
  symlink and copies nothing (a 40 KB `.terraform`, measured). A provider
  that is not in the mirror fails `init` immediately with `provider
  registry.terraform.io/hashicorp/azuread was not found in any of the search
  locations: /opt/terraform/mirror` instead of hanging on a registry that is
  unreachable. azurerm is mirrored twice because the vendored AVM modules
  still constrain to `~> 4.0` / `~> 4.35` while new code targets 5.x.
- **The three AVM pattern modules and everything they call: yes.**
  `/opt/avm/avm-ptn-alz@0.21.0`, `/opt/avm/avm-ptn-alz-management@0.9.0` and
  `/opt/avm/avm-ptn-alz-connectivity-hub-and-spoke-vnet@0.17.5` are the
  release source tarballs of the three `Azure/terraform-azurerm-avm-ptn-alz*`
  repositories. Terraform has a provider mirror but no module mirror, and
  measured in #686 `avm-ptn-alz` calls one registry module and the
  connectivity module thirteen, some from inside its own nested modules, so
  Phase 1 could init only the management module offline. Phase 2 (#675)
  vendors those children too: [`vendor-avm.sh`](vendor-avm.sh) runs
  `terraform get` on each pattern module at build time, copies each distinct
  child once to `/opt/avm/<name>@<version>` (sixteen `name@version` pairs
  across fourteen modules; two are called at two versions), and rewrites
  every `module` block inside the vendored copies from
  `source = "Azure/<name>/azurerm"` plus a `version` to the child's
  **relative** path, `../<name>@<version>`, with the `version` line
  commented out. Relative because Terraform uses `./` and `../` paths in
  place and treats an absolute path as a `file://` source it copies onto
  the tmpfs. Each child is pinned by a tree hash in `versions.env`
  (`AVM_CHILD_MODULES`); the build fails on a mismatch, an unpinned child or
  an unused pin, and then proves with a second `terraform get` that nothing
  in the rewritten tree reaches the registry. `smoke.sh` inits and validates
  each of the three from a generated root with no network. The fourth
  module the issue names,
  `avm-ptn-alz-application-landing-zone-identity-and-access`, is still not
  vendored: on 2026-09-25 its repository had no release and no tag.
- **A learner's or the builder's root: yes, through the rewrite.** The
  `terraform-validate` job runs [`bin/hcw-terraform-validate`](bin/hcw-terraform-validate),
  which copies the payload to `/tmp/run/src` and rewrites each `module`
  block whose `source` is an Azure Verified Module and whose `version`
  constraint a vendored version satisfies (Terraform's own operators; the
  highest satisfying version wins) to that copy's relative path, then runs
  `init -backend=false` and `validate`. A registry module the image does not
  vendor, or a constraint no vendored version satisfies, is left exactly as
  written and `init` fails loudly on it. The learner's files are never
  changed (ADR 0032, decision 5): the zip and the payload keep their
  registry sources and init anywhere with network.
  [`smoke/terraform-validate-payload`](smoke/terraform-validate-payload/main.tf)
  is a root shaped like the builder's output, calling all three pattern
  modules by registry source, and the smoke test validates it offline.
- **Helm and kubeconform: yes.** [`bin/hcw-helm-template`](bin/hcw-helm-template)
  renders one chart (its `Chart.yaml` at `/workspace` or one level down;
  dependencies must already be under `charts/`).
  [`bin/hcw-kubeconform`](bin/hcw-kubeconform) validates manifests with
  `-strict` against `/opt/kubeconform/schemas/v1.37.1-standalone-strict`,
  one directory of `yannh/kubernetes-json-schema` at a pinned commit and tree
  hash, in the layout kubeconform's own location template expects. A kind
  with no schema (a CRD) is an error, not a skip.

Three consequences of the sandbox:

- `terraform init` writes `.terraform.lock.hcl` beside the configuration,
  and a read-only `/workspace` refuses it, so every command copies its root
  to `/tmp/run` first. `TF_DATA_DIR` is `/tmp/run/.terraform`; give each root
  its own when a session inits more than one, as `smoke.sh` does.
- `TMPDIR=/tmp/run`. A Terraform provider is a go-plugin subprocess that
  opens a Unix socket in `TMPDIR` before it prints anything; with `TMPDIR` on
  the read-only root every provider died silently and `validate` reported
  "Failed to read any lines from plugin's stdout" for all six, after `init`
  had succeeded (measured in #675). Everything else that writes to a home
  directory (`az`, `helm`, `ansible`) is pointed at `/tmp/home` or
  `/tmp/run` through `HOME`, `HELM_*_HOME` and `ANSIBLE_LOCAL_TEMP`.
- The tmpfs the agent mounts is `uid=65534,gid=65534,mode=0700`
  (`RUN_TMPFS` in `capabilities.js`): Docker mounts a tmpfs root-owned by
  default, and the bare `--tmpfs /tmp/run:rw,size=64m` Phase 1 used gave
  `Permission denied` on the first write.

To use the registry instead of the mirror for one session (the `full` image
online, a provider the mirror does not carry), disable the config file:

bash, inside the container:

```bash
TF_CLI_CONFIG_FILE=/dev/null terraform init
```

## Smoke test

[`smoke.sh`](smoke.sh) runs inside the image with this directory mounted at
`/workspace` read-only and no network. It refuses to pass if the network is
reachable or the mount is writable, because an offline init that had network
would prove nothing; then it checks each tool's version against
`versions.env`, that every mirrored provider is present in the unpacked
layout, that every vendored child hashes to its pin, that `terraform init
-backend=false` and `terraform validate` succeed with no network for
[`smoke/providers-only`](smoke/providers-only/main.tf) and for a generated
root per pattern module (symlinking every provider and downloading no
module), that the three capability commands succeed on their fixtures under
[`smoke/`](smoke/) and that kubeconform rejects an unknown field, and, for
the `full` target, the extra tools and uid 65534's shell. The workflow runs
it on every pull request.

[`sandbox-check.mjs`](sandbox-check.mjs) is the second half: it runs each
runner-image capability the way the agent does, through
`vps-agent/lib/docker-runner.js` itself (`prepareJobDir`, `buildDockerArgs`,
so the exact sandbox flags, the tmpfs, the label and a `tar` payload), against
a locally built image, and expects the exit codes the job would report. The
smoke test runs inside a container that is not `--read-only`; this one is,
and it is what caught both the tmpfs ownership and the `TMPDIR` failures.
The workflow runs it after the smoke tests.

Locally, from the repository root. PowerShell:

```powershell
docker build --target runner -t hcw-lab-runner:dev lab-image
```

```powershell
docker run --rm --network none -v "${PWD}\lab-image:/workspace:ro" hcw-lab-runner:dev bash /workspace/smoke.sh runner
```

```powershell
node lab-image/sandbox-check.mjs hcw-lab-runner:dev
```

```powershell
docker build --target full -t hcw-lab:dev lab-image
```

```powershell
docker run --rm --network none -v "${PWD}\lab-image:/workspace:ro" hcw-lab:dev bash /workspace/smoke.sh full
```

bash (Git Bash needs `MSYS_NO_PATHCONV=1` so `/workspace` is not rewritten
to a Windows path):

```bash
docker build --target runner -t hcw-lab-runner:dev lab-image
```

```bash
MSYS_NO_PATHCONV=1 docker run --rm --network none -v "$(pwd -W 2>/dev/null || pwd)/lab-image:/workspace:ro" hcw-lab-runner:dev bash /workspace/smoke.sh runner
```

```bash
node lab-image/sandbox-check.mjs hcw-lab-runner:dev
```

A passing run ends with `smoke: passed (runner)` or `smoke: passed (full)`
and exits 0; any failing check prints `FAIL:` with the tool's output beneath
it and the script exits 1 after running every remaining check.
`sandbox-check.mjs` ends with `sandbox-check: passed` and exits 0, or prints
the job's output and exits 1.

## Updating a version

Edit the `_VERSION` line and the `_SHA256` beside it in `versions.env`, open a
pull request, and the workflow rebuilds both targets and runs the smoke test
against them; a wrong sum fails the build at the download, a wrong version
fails the smoke test's version comparison. On merge the same workflow pushes
and attests. Where each sum comes from:

- terraform: `terraform_<version>_SHA256SUMS` on releases.hashicorp.com,
  the `linux_amd64.zip` line.
- kubeconform: the `CHECKSUMS` asset on the GitHub release.
- helm: `https://get.helm.sh/helm-v<version>-linux-amd64.tar.gz.sha256sum`.
- kubectl: `https://dl.k8s.io/release/v<version>/bin/linux/amd64/kubectl.sha256`.
- ansible-core: the wheel's `sha256` digest in PyPI's JSON API
  (`https://pypi.org/pypi/ansible-core/<version>/json`). Check the new
  line's controller Python range in the
  [ansible-core support matrix](https://docs.ansible.com/projects/ansible/latest/reference_appendices/release_and_maintenance.html)
  covers `BASE_PYTHON_VERSION` (2.21 is 3.12 to 3.14).
- ansible-core's dependencies (`ANSIBLE_CORE_DEPS`): one
  `name==version --hash=sha256:<sum>` line each, the sum of the wheel pip
  selects for CPython 3.14 on linux x86_64 from the same PyPI JSON API
  (`https://pypi.org/pypi/<name>/<version>/json`). The build runs pip in
  hash-checking mode, so a dependency a new ansible-core adds fails the
  fetch stage with `In --require-hashes mode, all requirements must have
  their versions pinned with ==. These do not:` and its name, and a wrong
  sum fails with `THESE PACKAGES DO NOT MATCH THE HASHES FROM THE
  REQUIREMENTS FILE` and the `Expected` and `Got` sums (both measured on
  2026-09-25).
- Azure CLI: `AZURE_CLI_VERSION` is the upstream release, the newest package
  `Version` in
  `https://packages.microsoft.com/repos/azure-cli/dists/bookworm/main/binary-amd64/Packages`
  without its `-1~bookworm` suffix (no sum; apt verifies the package against
  the signed repository, and the signing key's own sum is
  `MICROSOFT_APT_KEY_SHA256`). `AZURE_CLI_SUITE` is `bookworm` because
  packages.microsoft.com has no `trixie` suite and Microsoft's
  [install page](https://learn.microsoft.com/cli/azure/install-azure-cli-linux?pivots=apt)
  says to use the latest Debian suite when a distribution has no package;
  move it to `trixie` once
  <https://packages.microsoft.com/repos/azure-cli/dists/> lists one. The
  sandbox template installs the same release from `dists/resolute`, its
  base's own suite, so check the version is published there too.
- Providers: `shasum` from
  `https://registry.terraform.io/v1/providers/<namespace>/<name>/<version>/download/linux/amd64`.
- AVM pattern modules: `sha256sum` of the downloaded
  `https://github.com/Azure/terraform-azurerm-<name>/archive/refs/tags/v<version>.tar.gz`.
  These lines are normally moved for you: `.github/workflows/update-avm-versions.yml`
  (#671) checks the builder's pins in `frontend/src/lib/landingZone/avmVersions.js`
  against the Terraform Registry every Tuesday and, when a module has a newer
  release, opens one pull request that bumps the pin, these two lines and the
  HCL snapshots together, with the sum computed from the same tarball.

  The workflow does not refresh the child modules, so do that by hand: a bump usually changes what a pattern module
  calls, and the build fails until `AVM_CHILD_MODULES` matches. Print the
  new block and paste it over the old one. bash:

  ```bash
  docker build --target vendor --build-arg AVM_PRINT_PINS=1 --progress=plain lab-image 2>&1 | sed -n "/^#[0-9]* [0-9.]* AVM_CHILD_MODULES='/,/^#[0-9]* [0-9.]* '$/p" | sed -E 's/^#[0-9]+ [0-9.]+ //'
  ```

  Each line is `<name>@<version> <tree hash>`; the hash is what
  `find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`
  prints inside the vendored directory.
- Kubernetes schemas: `KUBERNETES_JSON_SCHEMA_COMMIT` is the commit of
  `yannh/kubernetes-json-schema` to take the directory from,
  `KUBERNETES_JSON_SCHEMA_DIR` the directory (bump it with
  `KUBECTL_VERSION`), and the SHA256 the same tree hash over that directory.
- Base image: the image index digest from the registry's
  `Docker-Content-Digest` header, by the method documented at the top of
  [`vps-agent/lib/capabilities.js`](../vps-agent/lib/capabilities.js)
  (repository `library/python`, tag `3.14-slim-trixie`), cross-checked with
  `docker buildx imagetools inspect python:3.14-slim-trixie`, whose
  `org.opencontainers.image.version` annotation names the patch release.
  Update `BASE_IMAGE`, `BASE_DIGEST`, `BASE_PYTHON_VERSION` and every
  external `FROM` line in the Dockerfile together; the sandbox template's
  base is `SANDBOX_BASE_IMAGE` / `SANDBOX_BASE_DIGEST` and its one `FROM`
  line, by the same method.

The provider mirror and the vendored tree are rebuilt from scratch on every
build (neither is cached between versions), so a provider bump is a version
and a sum and nothing else.
