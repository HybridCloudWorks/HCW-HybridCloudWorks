# hcw-lab image

One Dockerfile, two targets, published to GHCR by
[`publish-lab-image.yml`](../.github/workflows/publish-lab-image.yml) on every
push to `main` that touches this directory (issue #658, Phase 1 in #674).

| Target   | Image                                     | Carries                                                                                                                                                                                                                                                                 |
| -------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runner` | `ghcr.io/hybridcloudworks/hcw-lab-runner` | terraform, kubeconform, helm, ansible-core; a Terraform provider filesystem mirror at `/opt/terraform/mirror`; the AVM pattern modules at `/opt/avm/<name>@<version>`. Runs as uid 65534 (`nobody`) with `/workspace` mounted read-only. This is what `vps-agent` runs jobs in. |
| `full`   | `ghcr.io/hybridcloudworks/hcw-lab`        | Everything in `runner`, plus Azure CLI, kubectl, git, curl, jq and the three packages code-server needs (`ca-certificates`, `libatomic1`, `procps`). `CMD` is `bash`. This is what a lab page tells a learner to pull, and the base of the Coder template.                       |

Every version and checksum is in [`versions.env`](versions.env); the
Dockerfile repeats none of them except the base image digest, which a `FROM`
line cannot read from a file (the workflow fails the build if the two copies
disagree).

## Sizes

Measured on 2026-09-25 with Docker 29.8.0 (`docker image ls`, which since
Docker 29 reports both the unpacked size on disk and the compressed size a
pull transfers):

| Target   | On disk | Compressed (what a pull downloads) |
| -------- | ------- | ---------------------------------- |
| `runner` | 880 MB  | 311 MB                             |
| `full`   | 1.88 GB | 484 MB                             |

The issue estimated 400 MB for `runner` with the provider mirror dominating.
Measured, the mirror is 191 MB (azurerm alone is 115 MB, because it is
mirrored at both 5.x and 4.x, see below) and the tool binaries are 200 MB
(terraform 115 MB, helm 63 MB, kubeconform 14 MB); Debian plus Python 3.11
and ansible-core's dependencies is 150 MB; ansible-core itself 22 MB. The
`full` target adds 1 GB, almost all of it the Azure CLI package, which bundles
its own Python and every Azure SDK.

## Pull and run

Anonymous pulls work once the owner has made both packages public at
<https://github.com/orgs/HybridCloudWorks/packages> (the owner step in #674);
until then `docker login ghcr.io` with a token holding `read:packages` is
needed first.

PowerShell:

```powershell
docker pull ghcr.io/hybridcloudworks/hcw-lab:latest
```

```powershell
docker run --rm -it -v "${PWD}:/workspace:ro" ghcr.io/hybridcloudworks/hcw-lab:latest
```

bash:

```bash
docker pull ghcr.io/hybridcloudworks/hcw-lab:latest
```

```bash
docker run --rm -it -v "$PWD:/workspace:ro" ghcr.io/hybridcloudworks/hcw-lab:latest
```

Both drop into `bash` in `/workspace` as `nobody`. For anything automated, pin
the digest rather than the tag, exactly as
[`vps-agent/lib/capabilities.js`](../vps-agent/lib/capabilities.js) does:
the publish workflow writes each pushed image's digest to its job summary,
and that is the first-party place to copy it from.

## What works offline, and what does not

The runner is built so that `terraform init` needs no network for the
providers the labs use, because `vps-agent` runs every job under
`--network none`. Precisely:

- **Providers: yes.** `TF_CLI_CONFIG_FILE` points at a
  `provider_installation { filesystem_mirror { ... } }` block with no
  `direct` fallback, so Terraform installs from `/opt/terraform/mirror` and
  nowhere else. The mirror holds azurerm 5.7.0 and 4.81.0, azapi 2.12.0, alz
  0.22.0, random 3.9.1, modtm 0.4.0 and time 0.14.2, each zip verified after
  mirroring against the SHA256 the registry publishes for it. A provider that
  is not in the mirror fails `init` immediately with `provider
  registry.terraform.io/hashicorp/azuread was not found in any of the search
  locations: /opt/terraform/mirror` (measured with azuread, which is not
  mirrored) instead of hanging on a registry that is unreachable.
  azurerm is mirrored twice because the vendored AVM modules still constrain
  to `~> 4.0` / `~> 4.35` while new code targets 5.x. modtm and time were not
  in the issue's list, but every vendored module requires modtm and
  `avm-ptn-alz` requires time, so without them no vendored module could init.
- **Vendored module sources: present.** `/opt/avm/avm-ptn-alz@0.21.0`,
  `/opt/avm/avm-ptn-alz-management@0.9.0` and
  `/opt/avm/avm-ptn-alz-connectivity-hub-and-spoke-vnet@0.17.5` are the
  release source tarballs of the three `Azure/terraform-azurerm-avm-ptn-alz*`
  repositories, unpacked. A root module reaches one with a local path:
  `source = "/opt/avm/avm-ptn-alz-management@0.9.0"`. The fourth module the
  issue names, `avm-ptn-alz-application-landing-zone-identity-and-access`,
  is not vendored: on 2026-09-25 its repository had no release and no tag and
  its `main` was still the unmodified AVM template.
- **Transitive registry modules: no.** Terraform has a provider mirror but no
  module mirror, so a module that itself calls a registry module needs the
  registry at `init` time. Measured against the three vendored modules:
  `avm-ptn-alz-management` calls none, and `smoke.sh` proves it inits with
  no network; `avm-ptn-alz` calls one (`Azure/avm-utl-interfaces/azure`
  0.5.0); `avm-ptn-alz-connectivity-hub-and-spoke-vnet` calls thirteen
  distinct ones across twenty-one `module` blocks (`avm-res-network-*`,
  `avm-utl-*`, `avm-ptn-network-private-link-private-dns-zones`), ten of
  those calls from inside its own nested modules, and each of those has
  children of its own. So today, of the builder's
  output, the management module inits offline and the other two do not.
  Making them do so means vendoring those child modules and rewriting the
  `source` lines inside the vendored copies to local paths, which is a
  deliberate change to the modules rather than a vendoring step, and is left
  for a later phase.

Two consequences of the read-only workspace:

- `terraform init` writes `.terraform.lock.hcl` beside the configuration, and
  a read-only `/workspace` refuses it. Copy the root to `/tmp/run` and init
  there, as `smoke.sh` does. `TF_DATA_DIR` is already `/tmp/run/.terraform`,
  so the provider and module cache never lands in the mount either; give each
  root its own `TF_DATA_DIR` when a session inits more than one.
- Everything else that writes to a home directory (`az`, `helm`, `ansible`)
  is pointed at `/tmp/home` or `/tmp/run` through `HOME`, `HELM_*_HOME` and
  `ANSIBLE_LOCAL_TEMP`.

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
`versions.env`, that every mirrored provider is present, that `terraform init
-backend=false` succeeds with no network for [`smoke/providers-only`](smoke/providers-only/main.tf)
(azurerm and random) and for the vendored management module, and, for the
`full` target, the extra tools. The workflow runs it on every pull request.

Locally, from the repository root. PowerShell:

```powershell
docker build --target runner -t hcw-lab-runner:dev lab-image
```

```powershell
docker run --rm --network none -v "${PWD}\lab-image:/workspace:ro" hcw-lab-runner:dev bash /workspace/smoke.sh runner
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

A passing run ends with `smoke: passed (runner)` or `smoke: passed (full)`
and exits 0; any failing check prints `FAIL:` with the tool's output beneath
it and the script exits 1 after running every remaining check.

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
  (`https://pypi.org/pypi/ansible-core/<version>/json`). Stay on 2.19.x while
  the base is bookworm; 2.20 and later need Python 3.12.
- Azure CLI: the package `Version` in
  `https://packages.microsoft.com/repos/azure-cli/dists/bookworm/main/binary-amd64/Packages`
  (no sum; apt verifies the package against the signed repository, and the
  signing key's own sum is `MICROSOFT_APT_KEY_SHA256`).
- Providers: `shasum` from
  `https://registry.terraform.io/v1/providers/<namespace>/<name>/<version>/download/linux/amd64`.
- AVM modules: `sha256sum` of the downloaded
  `https://github.com/Azure/terraform-azurerm-<name>/archive/refs/tags/v<version>.tar.gz`.
  These lines are normally moved for you: `.github/workflows/update-avm-versions.yml`
  (#671) checks the builder's pins in `frontend/src/lib/landingZone/avmVersions.js`
  against the Terraform Registry every Tuesday and, when a module has a newer
  release, opens one pull request that bumps the pin, these two lines and the
  HCL snapshots together, with the sum computed from the same tarball.
- Base image: the `Docker-Content-Digest` header from the registry, by the
  method documented at the top of
  [`vps-agent/lib/capabilities.js`](../vps-agent/lib/capabilities.js); update
  `DEBIAN_DIGEST` and every `FROM debian:` line in the Dockerfile together.

The provider mirror is rebuilt from scratch on every build (it is not cached
between versions), so a provider bump is a version and a sum and nothing
else.
