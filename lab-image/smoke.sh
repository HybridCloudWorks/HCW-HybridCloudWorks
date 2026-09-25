#!/usr/bin/env bash
# Smoke test for the hcw-lab image. Runs INSIDE the image, with this directory
# mounted read-only at /workspace and no network:
#
#   bash:
#   docker run --rm --network none -v "$PWD/lab-image:/workspace:ro" hcw-lab-runner:dev bash /workspace/smoke.sh runner
#   docker run --rm --network none -v "$PWD/lab-image:/workspace:ro" hcw-lab:dev        bash /workspace/smoke.sh full
#
# It checks the conditions the image is built for before it checks the tools:
# that there is no network (an init that passed with network proves nothing
# about the mirror), that /workspace is read-only, and that it runs as uid
# 65534. Then each tool's version is compared with versions.env, the provider
# mirror is checked for every pinned provider in the unpacked layout, every
# vendored child module is re-hashed against its pin, and `terraform init
# -backend=false` plus `terraform validate` run with no network against four
# roots: smoke/providers-only (azurerm and random) and one generated root per
# vendored AVM pattern module, calling it by relative path with its required
# inputs. Each init must symlink its providers to the mirror and download no
# module: the job sandbox is a read-only root with a 64 MB tmpfs, so a copy
# of either would fail there (#675). Every check runs even after one fails,
# and the exit code is non-zero if any did.
set -euo pipefail

target="${1:-runner}"
case "$target" in
  runner|full) ;;
  *) echo "usage: smoke.sh [runner|full]" >&2; exit 2 ;;
esac

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=versions.env
. "$here/versions.env"

fail=0
ok()   { printf 'ok:   %s\n' "$*"; }
bad()  { printf 'FAIL: %s\n' "$*"; fail=1; }
step() { printf '\n== %s\n' "$*"; }
indent() { sed 's/^/      /'; }

# expect_version <label> <needle> <command...>: the command's output must
# contain the version versions.env names, so a binary that ran but is the
# wrong build fails here rather than passing a bare "it printed something".
expect_version() {
  local label="$1" needle="$2"; shift 2
  local out
  if out="$("$@" 2>&1)"; then
    if grep -qF -- "$needle" <<<"$out"; then
      ok "$label $(head -n1 <<<"$out")"
    else
      bad "$label ran but did not report $needle:"; printf '%s\n' "$out" | indent
    fi
  else
    bad "$label failed to run:"; printf '%s\n' "$out" | indent
  fi
}

step "sandbox conditions"
if python3 -c 'import socket,sys
try:
    socket.create_connection(("registry.terraform.io", 443), timeout=3)
except OSError:
    sys.exit(1)' 2>/dev/null; then
  bad "the network is reachable; run with --network none, or the offline init below proves nothing"
else
  ok "no network"
fi
if (: > /workspace/.smoke-write-probe) 2>/dev/null; then
  rm -f /workspace/.smoke-write-probe
  bad "/workspace is writable; mount it read-only (:ro)"
else
  ok "/workspace is read-only"
fi
if [ "$(id -u)" = 65534 ]; then ok "running as uid 65534"; else bad "running as uid $(id -u), expected 65534"; fi

step "runner tools"
expect_version terraform   "Terraform v${TERRAFORM_VERSION}" terraform version
expect_version kubeconform "v${KUBECONFORM_VERSION}"         kubeconform -v
expect_version helm        "Version:\"v${HELM_VERSION}\""     helm version
expect_version ansible     "core ${ANSIBLE_CORE_VERSION}"     ansible --version

step "provider mirror (unpacked layout)"
mirror=/opt/terraform/mirror/registry.terraform.io
for entry in \
  "hashicorp/azurerm ${PROVIDER_AZURERM_VERSION}" \
  "hashicorp/azurerm ${PROVIDER_AZURERM_V4_VERSION}" \
  "azure/azapi ${PROVIDER_AZAPI_VERSION}" \
  "azure/alz ${PROVIDER_ALZ_VERSION}" \
  "hashicorp/random ${PROVIDER_RANDOM_VERSION}" \
  "azure/modtm ${PROVIDER_MODTM_VERSION}" \
  "hashicorp/time ${PROVIDER_TIME_VERSION}"; do
  provider="${entry% *}"; version="${entry#* }"
  dir="$mirror/$provider/$version/linux_amd64"
  if [ -d "$dir" ] && [ -n "$(find "$dir" -maxdepth 1 -type f -name "terraform-provider-${provider#*/}_v${version}*" -perm -u+x | head -n1)" ]; then
    ok "$provider $version"
  else
    bad "$provider $version is missing from the mirror at $dir"
  fi
done
zips="$(find /opt/terraform/mirror -name '*.zip' | wc -l)"
if [ "$zips" -eq 0 ]; then ok "no packed archives left in the mirror"; else bad "$zips zip(s) still in the mirror; init would extract them onto the tmpfs"; fi

# init_validate <label> <root dir>: init without a backend, then validate,
# both with the root's own data dir. A passing init must have symlinked every
# provider to the mirror (no copy) and downloaded no module (every source
# resolved to a directory that already exists).
init_validate() {
  local label="$1" root="$2" out data
  data="$root/.terraform"
  if out="$(cd "$root" && TF_DATA_DIR="$data" terraform init -backend=false -input=false -no-color 2>&1)"; then
    ok "terraform init -backend=false ($label)"
    grep -E '^- (Installing|Using) ' <<<"$out" | indent || true
  else
    bad "terraform init -backend=false ($label):"; printf '%s\n' "$out" | indent
    return
  fi
  # .terraform/providers/registry.terraform.io/<ns>/<name>/<version>/linux_amd64
  # is the symlink; a real directory at that depth is an extracted copy.
  local copied linked
  copied="$( (find "$data/providers" -mindepth 5 -maxdepth 5 -type d 2>/dev/null || true) | wc -l)"
  linked="$( (find "$data/providers" -mindepth 5 -maxdepth 5 -type l 2>/dev/null || true) | wc -l)"
  if [ "$copied" -eq 0 ] && [ "$linked" -gt 0 ]; then
    ok "every provider is a symlink to the mirror ($label, $linked linked)"
  else
    bad "$copied provider director(y/ies) copied instead of symlinked, $linked linked ($label):"
    (find "$data/providers" -mindepth 5 -maxdepth 5 2>/dev/null || true) | indent
  fi
  local downloaded
  downloaded="$( (find "$data/modules" -mindepth 1 -maxdepth 1 -type d 2>/dev/null || true) | wc -l)"
  if [ "$downloaded" -eq 0 ]; then
    ok "no module was downloaded or copied ($label)"
  else
    bad "$downloaded module director(y/ies) under .terraform/modules ($label):"
    (find "$data/modules" -mindepth 1 -maxdepth 1 -type d 2>/dev/null || true) | indent
  fi
  if out="$(cd "$root" && TF_DATA_DIR="$data" terraform validate -no-color 2>&1)"; then
    ok "terraform validate ($label)"
  else
    bad "terraform validate ($label):"; printf '%s\n' "$out" | indent
  fi
}

step "terraform init and validate with no network"
work=/tmp/run/smoke
rm -rf "$work" && mkdir -p "$work/providers-only" && cp -R "$here/smoke/providers-only/." "$work/providers-only/"
init_validate providers-only "$work/providers-only"

step "vendored AVM modules"
for entry in \
  "avm-ptn-alz ${AVM_PTN_ALZ_VERSION}" \
  "avm-ptn-alz-management ${AVM_PTN_ALZ_MANAGEMENT_VERSION}" \
  "avm-ptn-alz-connectivity-hub-and-spoke-vnet ${AVM_PTN_ALZ_CONNECTIVITY_HUB_AND_SPOKE_VNET_VERSION}"; do
  name="${entry% *}"; version="${entry#* }"
  if [ -f "/opt/avm/${name}@${version}/main.tf" ]; then
    ok "/opt/avm/${name}@${version}"
  else
    bad "/opt/avm/${name}@${version}/main.tf is missing"
  fi
done

# Every child vendor-avm.sh pinned is present and still hashes to its pin
# (the same coreutils pipeline versions.env documents), and nothing in
# /opt/avm still names a registry module in a file Terraform would load.
children=0
while read -r child pin; do
  [ -n "$child" ] || continue
  children=$((children + 1))
  dir="/opt/avm/$child"
  if [ ! -d "$dir" ]; then
    bad "pinned child $child is not vendored"
    continue
  fi
  actual="$(cd "$dir" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1)"
  if [ "$actual" = "$pin" ]; then ok "$child matches its pin"; else bad "$child hashes $actual, versions.env pins $pin"; fi
done < <(printf '%s\n' "$AVM_CHILD_MODULES" | sed '/^[[:space:]]*$/d')
if [ "$children" -gt 0 ]; then ok "$children vendored child modules pinned"; else bad "AVM_CHILD_MODULES is empty"; fi
# One generated root per pattern module, calling it by a RELATIVE path (an
# absolute path is a file:// source Terraform copies onto the tmpfs) with the
# inputs it requires and nothing else. "no module was downloaded" on each is
# the proof that no registry source survived the rewrite: a grep for
# `source = "Azure/..."` would also match the worked example in avm-ptn-alz's
# variables.tf, which Terraform never loads as a module block.
avm_root() {
  local label="$1" name="$2" version="$3"; shift 3
  local root="$work/$label" rel
  mkdir -p "$root"
  rel="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "/opt/avm/${name}@${version}" "$root")"
  {
    printf 'module "m" {\n  source = "%s"\n' "$rel"
    printf '  %s\n' "$@"
    printf '}\n'
  } > "$root/main.tf"
  init_validate "$label" "$root"
}
avm_root avm-ptn-alz avm-ptn-alz "${AVM_PTN_ALZ_VERSION}" \
  'architecture_name  = "alz"' \
  'location           = "centralus"' \
  'parent_resource_id = "root"'
avm_root avm-ptn-alz-management avm-ptn-alz-management "${AVM_PTN_ALZ_MANAGEMENT_VERSION}" \
  'location                = "centralus"' \
  'resource_group_name     = "rg-alz-management"' \
  'automation_account_name = "aa-alz-management"'
avm_root avm-ptn-alz-connectivity-hub-and-spoke-vnet avm-ptn-alz-connectivity-hub-and-spoke-vnet "${AVM_PTN_ALZ_CONNECTIVITY_HUB_AND_SPOKE_VNET_VERSION}"

# The three capability commands (bin/), each against the payload it would
# receive from the agent, with HCW_WORKSPACE pointing at the fixture instead
# of /workspace (which is this directory) and HCW_RUN_DIR under /tmp/run.
step "capability commands with no network"
tfv="$work/terraform-validate"
if out="$(HCW_WORKSPACE="$here/smoke/terraform-validate-payload" HCW_RUN_DIR="$tfv" hcw-terraform-validate 2>&1)"; then
  if grep -q 'Success! The configuration is valid.' <<<"$out" && [ "$(grep -c '^  rewrote ' <<<"$out")" -eq 3 ]; then
    ok "hcw-terraform-validate rewrote 3 registry sources and validated the builder-shaped payload"
    grep '^  rewrote ' <<<"$out" | indent
  else
    bad "hcw-terraform-validate exited 0 but did not report 3 rewrites and a valid configuration:"; printf '%s\n' "$out" | indent
  fi
else
  bad "hcw-terraform-validate (builder-shaped payload):"; printf '%s\n' "$out" | indent
fi
if out="$(HCW_WORKSPACE="$here/smoke/helm-payload" hcw-helm-template 2>&1)"; then
  if grep -q '^kind: Deployment' <<<"$out" && grep -q 'name: hcw-hcw-smoke' <<<"$out"; then
    ok "hcw-helm-template rendered smoke/helm-payload/hcw-smoke"
  else
    bad "hcw-helm-template exited 0 without the expected Deployment:"; printf '%s\n' "$out" | indent
  fi
else
  bad "hcw-helm-template:"; printf '%s\n' "$out" | indent
fi
if out="$(HCW_WORKSPACE="$here/smoke/kubeconform-payload/valid" hcw-kubeconform 2>&1)"; then
  if grep -q 'Valid: 2, Invalid: 0, Errors: 0' <<<"$out"; then ok "hcw-kubeconform accepts the valid manifests"; else bad "hcw-kubeconform summary unexpected:"; printf '%s\n' "$out" | indent; fi
else
  bad "hcw-kubeconform (valid):"; printf '%s\n' "$out" | indent
fi
if out="$(HCW_WORKSPACE="$here/smoke/kubeconform-payload/invalid" hcw-kubeconform 2>&1)"; then
  bad "hcw-kubeconform accepted an invalid manifest:"; printf '%s\n' "$out" | indent
else
  if grep -q "'replicaz' not allowed" <<<"$out"; then ok "hcw-kubeconform rejects the unknown field under -strict"; else bad "hcw-kubeconform failed for another reason:"; printf '%s\n' "$out" | indent; fi
fi
schemas="$(find /opt/kubeconform/schemas -mindepth 1 -maxdepth 1 -type d -name "${KUBERNETES_JSON_SCHEMA_DIR}" | wc -l)"
if [ "$schemas" -eq 1 ]; then ok "/opt/kubeconform/schemas/${KUBERNETES_JSON_SCHEMA_DIR}"; else bad "/opt/kubeconform/schemas/${KUBERNETES_JSON_SCHEMA_DIR} is missing"; fi

if [ "$target" = full ]; then
  step "full tools"
  expect_version az      "\"azure-cli\": \"${AZURE_CLI_VERSION%%-*}\"" az version --output json
  expect_version kubectl "Client Version: v${KUBECTL_VERSION}"          kubectl version --client
  expect_version git     "git version"                                   git --version
  expect_version jq      "jq-"                                           jq --version
  expect_version curl    "curl "                                         curl --version
  for pkg in ca-certificates libatomic1 procps; do
    if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q 'install ok installed'; then
      ok "code-server prerequisite $pkg"
    else
      bad "code-server prerequisite $pkg is not installed"
    fi
  done
fi

printf '\n'
if [ "$fail" -ne 0 ]; then
  echo "smoke: FAILED ($target)"
  exit 1
fi
echo "smoke: passed ($target)"
