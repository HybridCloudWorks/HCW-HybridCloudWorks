#!/usr/bin/env bash
# Bootstrap the HCW lab host. Re-runnable: the owner runs it first as root over
# SSH on the adopted Ubuntu 26.04 LTS host (infra-lab/README.md, step 7; the
# Hostinger provider cannot attach a post-install script to a server that
# already exists), and re-runs it after changing the pinned ref or the vault. Everything the host ends up
# running is declared under ansible/; this script only gets Ansible there.
#
# The vault is optional on purpose. Without /etc/hcw/ansible/vault.yml the
# playbook still hardens the host, installs Docker, node_exporter and Caddy
# (serving plain HTTP) and installs the agent unit without starting it. With
# it, Caddy holds the wildcard certificate and the agent runs.
#
# Python. Ansible's control side (ansible-playbook, templating, the vault)
# runs on CPython from uv, not on the distribution's python3. Owner rule
# 2026-09-26: Python is on the newest release line and no more than two patch
# releases behind that line's newest, and Ubuntu 26.04 ships python3 3.14.3,
# below that floor. uv comes from its GitHub release asset, checked against
# UV_SHA256 before it runs (no curl | sh), and uv checks the interpreter it
# downloads against the SHA256 it carries for that build, so the two pins
# below fix the interpreter's bytes too. The one recorded exception: modules
# still EXECUTE on the host's /usr/bin/python3 (ansible_python_interpreter in
# ansible/inventory/localhost.yml), because python3-apt, python3-debian and
# python3-docker, which the apt, deb822_repository and community.docker
# modules import, are distribution packages built for the distribution's
# Python and cannot be loaded by another interpreter.
set -euo pipefail

# Tool versions, each checked 2026-09-26. A bump is an edit here and a re-run.
# uv 0.12.19, the newest release; UV_SHA256 is the sha256sum of
# uv-x86_64-unknown-linux-gnu.tar.gz from
# https://github.com/astral-sh/uv/releases/tag/0.12.19, equal to the
# release's own .sha256 asset, and `gh attestation verify --repo astral-sh/uv`
# traces the file to that repository's release workflow.
UV_VERSION=0.12.19
UV_SHA256=23bf5552d220e0842b65c862097b2ebaeba0064b74eda5e565e77fd25969d8c8
# CPython 3.14.7, the newest release of the newest line. uv 0.12.19 pins its
# python-build-standalone 20260924 build by SHA256.
PYTHON_VERSION=3.14.7
# ansible-core 2.21.4, the newest GA release (2.22.0b1 is a beta). It supports
# Python 3.12 to 3.14 on the control side and runs modules on 26.04's 3.14 and
# 24.04's 3.12 alike, so one pin serves both accepted releases. 2.22 needs
# 3.13 or later on the TARGET too, which 24.04 does not have: when 2.22 is GA,
# move this pin and drop 24.04 rather than hold 26.04 back.
ANSIBLE_CORE_VERSION=2.21.4

HCW_REPO_URL="${HCW_REPO_URL:-https://github.com/HybridCloudWorks/HCW-HybridCloudWorks.git}"
HCW_REPO_REF="${HCW_REPO_REF:-04aa9e36a2c16813dcbabb838f5c2b86d3370d96}"
HCW_SRC_DIR="${HCW_SRC_DIR:-/opt/hcw-src}"
HCW_ANSIBLE_STATE_DIR=/etc/hcw/ansible
HCW_VAULT_FILE="${HCW_ANSIBLE_STATE_DIR}/vault.yml"
HCW_VAULT_PASSWORD_FILE="${HCW_ANSIBLE_STATE_DIR}/vault-password"

# uv, its interpreters and the ansible-core environment live under /opt/uv,
# outside root's home; the ansible-* commands are linked into /usr/local/bin,
# where the README's ansible-vault lines expect them.
UV_BIN=/usr/local/bin/uv
export UV_PYTHON_INSTALL_DIR=/opt/uv/python
export UV_TOOL_DIR=/opt/uv/tools
export UV_TOOL_BIN_DIR=/usr/local/bin
export UV_CACHE_DIR=/var/cache/uv
export DEBIAN_FRONTEND=noninteractive

log() {
  printf '[bootstrap] %s\n' "$*"
}

if [ "$(id -u)" -ne 0 ]; then
  echo "bootstrap.sh must run as root" >&2
  exit 1
fi

# 26.04 LTS is the target (owner decision 2026-09-26: the VPS runs it). 24.04
# LTS is accepted as a fallback and says so; anything else stops here. site.yml
# checks the same two releases (lab_host_ubuntu_releases in group_vars/all.yml),
# because the roles' per-release pins exist for these two and no others.
# shellcheck source=/dev/null
os_id="$(. /etc/os-release && printf '%s' "${ID:-}")"
# shellcheck source=/dev/null
os_version="$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")"
case "${os_id} ${os_version}" in
  "ubuntu 26.04") ;;
  "ubuntu 24.04")
    log "Ubuntu 24.04 is accepted, but the lab host's target is Ubuntu 26.04 LTS"
    ;;
  *)
    echo "bootstrap.sh is written for Ubuntu 26.04 LTS (and accepts 24.04 LTS); this host is not either" >&2
    grep '^PRETTY_NAME=' /etc/os-release >&2
    exit 1
    ;;
esac

# The uv asset, and every Docker, Arc and Node.js pin, is amd64.
if [ "$(uname -m)" != "x86_64" ]; then
  echo "bootstrap.sh is written for an x86_64 host and this one is $(uname -m)" >&2
  exit 1
fi

log "installing prerequisites"
apt-get update -q
apt-get install -y -q --no-install-recommends git python3 python3-apt ca-certificates curl sudo

if ! "${UV_BIN}" --version 2>/dev/null | grep -qx "uv ${UV_VERSION}\( .*\)\?"; then
  log "installing uv ${UV_VERSION} from its GitHub release, SHA256-verified"
  uv_tmp="$(mktemp -d)"
  trap 'rm -rf "${uv_tmp}"' EXIT
  uv_archive=uv-x86_64-unknown-linux-gnu.tar.gz
  curl -fsSL --proto '=https' --tlsv1.2 -o "${uv_tmp}/${uv_archive}" \
    "https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${uv_archive}"
  if [ "$(sha256sum "${uv_tmp}/${uv_archive}" | cut -d ' ' -f 1)" != "${UV_SHA256}" ]; then
    echo "refusing to install uv: ${uv_archive} does not match UV_SHA256" >&2
    exit 1
  fi
  tar -xzf "${uv_tmp}/${uv_archive}" -C "${uv_tmp}"
  install -m 0755 -o root -g root "${uv_tmp}/uv-x86_64-unknown-linux-gnu/uv" "${UV_BIN}"
  rm -rf "${uv_tmp}"
  trap - EXIT
fi

log "installing CPython ${PYTHON_VERSION} with uv"
"${UV_BIN}" python install --no-bin "${PYTHON_VERSION}"

# Reinstalled when either pin moves, so a Python bump rebuilds the environment
# rather than leaving ansible-core on the interpreter before it.
if ! "${UV_TOOL_BIN_DIR}/ansible-playbook" --version 2>/dev/null | grep -q "core ${ANSIBLE_CORE_VERSION}]" \
  || ! "${UV_TOOL_BIN_DIR}/ansible-playbook" --version 2>/dev/null | grep -qF "python version = ${PYTHON_VERSION} ("; then
  log "installing ansible-core ${ANSIBLE_CORE_VERSION} on CPython ${PYTHON_VERSION} with uv"
  "${UV_BIN}" tool install --force --managed-python --python "${PYTHON_VERSION}" "ansible-core==${ANSIBLE_CORE_VERSION}"
fi
"${UV_TOOL_BIN_DIR}/ansible-playbook" --version | sed -n '1p;/python version/p'

if [ -d "${HCW_SRC_DIR}/.git" ]; then
  log "fetching ${HCW_REPO_URL}"
  git -C "${HCW_SRC_DIR}" fetch --quiet origin
else
  log "cloning ${HCW_REPO_URL} into ${HCW_SRC_DIR}"
  git clone --quiet "${HCW_REPO_URL}" "${HCW_SRC_DIR}"
fi
log "checking out ${HCW_REPO_REF}"
git -C "${HCW_SRC_DIR}" checkout --quiet --detach "${HCW_REPO_REF}"

cd "${HCW_SRC_DIR}/lab-host/ansible"

log "installing collections from requirements.yml"
"${UV_TOOL_BIN_DIR}/ansible-galaxy" collection install -r requirements.yml

extra_args=()
if [ -f "${HCW_VAULT_FILE}" ] && [ -f "${HCW_VAULT_PASSWORD_FILE}" ]; then
  log "using the vault at ${HCW_VAULT_FILE}"
  extra_args+=(--vault-password-file "${HCW_VAULT_PASSWORD_FILE}" -e "@${HCW_VAULT_FILE}")
elif [ -f "${HCW_VAULT_FILE}" ] || [ -f "${HCW_VAULT_PASSWORD_FILE}" ]; then
  echo "refusing to run: one of ${HCW_VAULT_FILE} and ${HCW_VAULT_PASSWORD_FILE} exists and the other does not" >&2
  echo "a half-present vault would be treated as no vault, turning TLS off and stopping the agent; restore the missing file or remove both" >&2
  exit 1
else
  log "no vault at ${HCW_VAULT_FILE}: Caddy answers 503 over plain HTTP and the agent stays stopped until one exists"
fi

log "running site.yml against localhost"
"${UV_TOOL_BIN_DIR}/ansible-playbook" -i inventory/localhost.yml site.yml "${extra_args[@]}" "$@"
