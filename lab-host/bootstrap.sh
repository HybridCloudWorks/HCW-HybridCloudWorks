#!/usr/bin/env bash
# Bootstrap the HCW lab host. Re-runnable: the Hostinger post-install script
# (#661) runs it once on a fresh Ubuntu 24.04 host, and the owner re-runs it
# after changing the pinned ref or the vault. Everything the host ends up
# running is declared under ansible/; this script only gets Ansible there.
#
# The vault is optional on purpose. Without /etc/hcw/ansible/vault.yml the
# playbook still hardens the host, installs Docker, node_exporter and Caddy
# (serving plain HTTP) and installs the agent unit without starting it. With
# it, Caddy holds the wildcard certificate and the agent runs.
set -euo pipefail

HCW_REPO_URL="${HCW_REPO_URL:-https://github.com/HybridCloudWorks/HCW-HybridCloudWorks.git}"
HCW_REPO_REF="${HCW_REPO_REF:-04aa9e36a2c16813dcbabb838f5c2b86d3370d96}"
HCW_SRC_DIR="${HCW_SRC_DIR:-/opt/hcw-src}"
HCW_ANSIBLE_STATE_DIR=/etc/hcw/ansible
HCW_VAULT_FILE="${HCW_ANSIBLE_STATE_DIR}/vault.yml"
HCW_VAULT_PASSWORD_FILE="${HCW_ANSIBLE_STATE_DIR}/vault-password"
ANSIBLE_CORE_VERSION=2.21.4

export PIPX_HOME=/opt/pipx
export PIPX_BIN_DIR=/usr/local/bin
export DEBIAN_FRONTEND=noninteractive

log() {
  printf '[bootstrap] %s\n' "$*"
}

if [ "$(id -u)" -ne 0 ]; then
  echo "bootstrap.sh must run as root" >&2
  exit 1
fi

if ! grep -q '^VERSION_ID="24.04"$' /etc/os-release; then
  echo "bootstrap.sh is written for Ubuntu 24.04 and this host is not" >&2
  grep '^PRETTY_NAME=' /etc/os-release >&2
  exit 1
fi

log "installing prerequisites"
apt-get update -q
apt-get install -y -q --no-install-recommends git pipx python3-apt ca-certificates curl

if ! "${PIPX_BIN_DIR}/ansible-playbook" --version 2>/dev/null | grep -q "core ${ANSIBLE_CORE_VERSION}"; then
  log "installing ansible-core ${ANSIBLE_CORE_VERSION} with pipx"
  pipx install --force "ansible-core==${ANSIBLE_CORE_VERSION}"
fi

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
"${PIPX_BIN_DIR}/ansible-galaxy" collection install -r requirements.yml

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
"${PIPX_BIN_DIR}/ansible-playbook" -i inventory/localhost.yml site.yml "${extra_args[@]}" "$@"
