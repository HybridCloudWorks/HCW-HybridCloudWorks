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
# 65534. Then each tool's version is compared with versions.env, and
# `terraform init -backend=false` runs against two roots: smoke/providers-only
# (azurerm and random) and the vendored avm-ptn-alz-management module, the one
# vendored module whose init needs nothing outside the mirror. Every check
# runs even after one fails, and the exit code is non-zero if any did.
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
      bad "$label ran but did not report $needle:"; printf '%s\n' "$out" | sed 's/^/      /'
    fi
  else
    bad "$label failed to run:"; printf '%s\n' "$out" | sed 's/^/      /'
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

step "provider mirror"
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
  zip="$mirror/$provider/terraform-provider-${provider#*/}_${version}_linux_amd64.zip"
  if [ -f "$zip" ] && [ -f "$mirror/$provider/${version}.json" ]; then
    ok "$provider $version"
  else
    bad "$provider $version is missing from the mirror"
  fi
done

# init_offline <label> <source dir>: copy the root to a writable place (init
# writes .terraform.lock.hcl beside the configuration, which a read-only
# /workspace refuses), give it its own data dir, init without a backend.
init_offline() {
  local label="$1" src="$2" work
  work="/tmp/run/smoke/$label"
  rm -rf "$work" && mkdir -p "$work" && cp -R "$src/." "$work/"
  local out
  if out="$(cd "$work" && TF_DATA_DIR="$work/.terraform" terraform init -backend=false -input=false -no-color 2>&1)"; then
    ok "terraform init -backend=false ($label)"
    grep -E '^- (Installing|Using) ' <<<"$out" | sed 's/^/      /' || true
  else
    bad "terraform init -backend=false ($label):"; printf '%s\n' "$out" | sed 's/^/      /'
  fi
}

step "terraform init with no network"
init_offline providers-only "$here/smoke/providers-only"
if out="$(cd /tmp/run/smoke/providers-only && TF_DATA_DIR=/tmp/run/smoke/providers-only/.terraform terraform validate -no-color 2>&1)"; then
  ok "terraform validate (providers-only)"
else
  bad "terraform validate (providers-only):"; printf '%s\n' "$out" | sed 's/^/      /'
fi

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
# The management module is the only one of the three with no registry module
# of its own (README, "What works offline"), so it is the one whose offline
# init the image can promise.
init_offline avm-ptn-alz-management "/opt/avm/avm-ptn-alz-management@${AVM_PTN_ALZ_MANAGEMENT_VERSION}"

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
