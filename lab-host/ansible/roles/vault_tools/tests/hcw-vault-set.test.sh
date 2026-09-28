#!/usr/bin/env bash
# Tests ../files/hcw-vault-set, the helper this role installs as
# /usr/local/sbin/hcw-vault-set, by running that file as it ships against a
# scratch HCW_VAULT_DIR and a real ansible-vault.
#
# Run as root, because the helper installs the vault root:root 0600. CI runs
# it in the `ansible-lint (lab-host)` job (sudo, with the job's ansible-core);
# lab-host/README.md ("Validating without a host") has the container line.
#
# The helper names its tools by absolute path, where bootstrap.sh puts them:
# /usr/local/bin/ansible-vault and /opt/uv/tools/ansible-core/bin/python.
# Where either is missing (a CI runner, the dev-tools image), this links it to
# the ansible-vault on PATH and the Python that ansible-vault runs on, and
# removes exactly those links at the end. It never replaces a file that
# exists, so on the lab host it uses the real tools and touches nothing.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="${here}/../files/hcw-vault-set"
bootstrap="${here}/../../../../bootstrap.sh"
av_path=/usr/local/bin/ansible-vault
py_path=/opt/uv/tools/ansible-core/bin/python

if [ "$(id -u)" -ne 0 ]; then
  echo "hcw-vault-set.test.sh: run as root (the helper installs the vault root:root)" >&2
  exit 1
fi

passed=0
failed=0
ok() { passed=$((passed + 1)); echo "ok ${passed} - $1"; }
not_ok() { failed=$((failed + 1)); echo "not ok - $1" >&2; [ -z "${2:-}" ] || printf '    %s\n' "$2" >&2; }
check() { if eval "$2"; then ok "$1"; else not_ok "$1" "${3:-}"; fi; }

# --- The tool paths the helper names are the ones bootstrap.sh installs to.
check "the helper runs ansible-vault from ${av_path}" \
  "grep -qx 'av=${av_path}' '${helper}'"
check "the helper runs Python from ${py_path}" \
  "grep -qx 'py=${py_path}' '${helper}'"
check "bootstrap.sh links the ansible-* commands into /usr/local/bin" \
  "grep -qx 'export UV_TOOL_BIN_DIR=/usr/local/bin' '${bootstrap}'"
check "bootstrap.sh keeps the ansible-core environment under /opt/uv/tools" \
  "grep -qx 'export UV_TOOL_DIR=/opt/uv/tools' '${bootstrap}'"

# --- Stand-ins for missing tool paths, removed on exit.
created=()
work="$(mktemp -d)"
# Out of the checkout: ansible-vault warns about, and ignores, an ansible.cfg
# in a world-writable directory, which a container's bind mount can be.
cd "${work}"
finish() {
  local i
  for ((i = ${#created[@]} - 1; i >= 0; i--)); do
    if [ -L "${created[i]}" ] || [ -f "${created[i]}" ]; then rm -f "${created[i]}"; else rmdir "${created[i]}" 2>/dev/null || true; fi
  done
  rm -rf "${work}"
}
trap finish EXIT

make_dirs() {
  local d="$1" missing=()
  while [ ! -d "${d}" ]; do missing=("${d}" "${missing[@]}"); d="$(dirname "${d}")"; done
  for d in "${missing[@]}"; do mkdir "${d}"; created+=("${d}"); done
}

if [ ! -e "${av_path}" ]; then
  av_source="$(command -v ansible-vault)" || { echo "no ansible-vault on PATH; install ansible-core" >&2; exit 1; }
  make_dirs "$(dirname "${av_path}")"
  ln -s "${av_source}" "${av_path}"
  created+=("${av_path}")
fi
if [ ! -e "${py_path}" ]; then
  interpreter="$(sed -n '1s/^#![[:space:]]*//p' "$(readlink -f "${av_path}")")"
  case "${interpreter}" in
    */env\ *) interpreter="$(command -v "${interpreter##* }")" ;;
  esac
  [ -x "${interpreter}" ] || { echo "cannot find the Python ansible-vault runs on" >&2; exit 1; }
  make_dirs "$(dirname "${py_path}")"
  ln -s "${interpreter}" "${py_path}"
  created+=("${py_path}")
fi

# --- A scratch vault directory, and TMPDIR inside the scratch area so the
# helper's own temporary directory can be seen to be gone after each run.
export HCW_VAULT_DIR="${work}/vault"
export TMPDIR="${work}/tmp"
install -d -m 0700 "${HCW_VAULT_DIR}" "${TMPDIR}"
vault="${HCW_VAULT_DIR}/vault.yml"
head -c 32 /dev/urandom | base64 > "${HCW_VAULT_DIR}/vault-password"
chmod 0600 "${HCW_VAULT_DIR}/vault-password"

out="${work}/out"
err="${work}/err"
# set_key KEY VALUE: pipes VALUE (printf %b, so \r and \n are real) into the
# helper; returns the helper's exit code, output in $out and $err.
set_key() {
  local rc=0
  printf '%b' "$2" | bash "${helper}" "$1" > "${out}" 2> "${err}" || rc=$?
  return "${rc}"
}
rc_of() { local rc=0; "$@" || rc=$?; echo "${rc}"; }
plain() { "${av_path}" view --vault-password-file "${HCW_VAULT_DIR}/vault-password" "${vault}"; }
# value_of KEY: the key's value as Python reads it, with its type if not str.
value_of() {
  plain | "${py_path}" -c 'import sys, yaml
d = yaml.safe_load(sys.stdin)
v = d.get(sys.argv[1], "<absent>")
print(v if isinstance(v, str) else "%r (%s)" % (v, type(v).__name__))' "$1"
}
fingerprint() { sha256sum "${vault}" | cut -d ' ' -f 1; }
leftovers() { find "${TMPDIR}" "${HCW_VAULT_DIR}" -mindepth 1 ! -name vault.yml ! -name vault-password | head -5; }

# --- Refusals before any vault exists.
for bad in Vault_upper vault-dash vault_ other_prefix 'vault_x;id' 'vault_x y' ''; do
  rc="$(rc_of set_key "${bad}" 'some-value\n')"
  if [ -z "${bad}" ]; then
    check "an absent key name is refused with the usage line" "[ '${rc}' != 0 ] && grep -q 'usage: hcw-vault-set' '${err}'" "rc=${rc} $(cat "${err}")"
  else
    check "the key name '${bad}' is refused with exit 2" "[ '${rc}' = 2 ] && grep -q 'refusing key name' '${err}'" "rc=${rc} $(cat "${err}")"
  fi
done
check "no refused key name created a vault" "[ ! -e '${vault}' ]"

rc="$(rc_of set_key vault_test_first '  \r\n')"
check "an empty value is refused and nothing is created" \
  "[ '${rc}' != 0 ] && grep -q 'the value on stdin was empty; nothing changed' '${err}' && [ ! -e '${vault}' ]" "rc=${rc} $(cat "${err}")"

saved_dir="${HCW_VAULT_DIR}"
export HCW_VAULT_DIR="${work}/no-password"
mkdir -m 0700 "${HCW_VAULT_DIR}"
rc="$(rc_of set_key vault_test_first 'value\n')"
check "a directory without a vault password is refused with exit 2" \
  "[ '${rc}' = 2 ] && grep -q 'no vault password at' '${err}'" "rc=${rc} $(cat "${err}")"
export HCW_VAULT_DIR="${saved_dir}"

# --- Two keys, the first creating the vault.
first='first-secret-Ab1'
rc="$(rc_of set_key vault_test_first "${first}\r\n")"
check "the first key is set (the helper creates the vault)" "[ '${rc}' = 0 ]" "rc=${rc} $(cat "${err}")"
check "it reports the key and the vault's key names" \
  "grep -qx 'hcw-vault-set: set vault_test_first (value not shown). Keys in the vault: vault_test_first' '${out}'" "$(cat "${out}")"
check "it prints no value" "! grep -q '${first}' '${out}' '${err}'"
check "vault.yml is Ansible Vault ciphertext" "head -n 1 '${vault}' | grep -q '^\\\$ANSIBLE_VAULT;1\\.1;AES256'" "$(head -n 1 "${vault}")"
check "vault.yml does not hold the value in the clear" "! grep -q '${first}' '${vault}'"
check "vault.yml is root:root 0600" "[ \"\$(stat -c '%U:%G %a' '${vault}')\" = 'root:root 600' ]" "$(stat -c '%U:%G %a' "${vault}")"
check "the value decrypts exactly, carriage return and newline removed" "[ \"\$(value_of vault_test_first)\" = '${first}' ]" "$(value_of vault_test_first)"

second='second-secret-Cd2'
rc="$(rc_of set_key vault_test_second "\xef\xbb\xbf ${second} \n")"
check "the second key is set" "[ '${rc}' = 0 ]" "rc=${rc} $(cat "${err}")"
check "both key names are reported" \
  "grep -qx 'hcw-vault-set: set vault_test_second (value not shown). Keys in the vault: vault_test_first, vault_test_second' '${out}'" "$(cat "${out}")"
check "the second value decrypts with its byte order mark and spaces removed" "[ \"\$(value_of vault_test_second)\" = '${second}' ]" "$(value_of vault_test_second)"
check "the first value is unchanged" "[ \"\$(value_of vault_test_first)\" = '${first}' ]" "$(value_of vault_test_first)"
check "vault.yml is still root:root 0600" "[ \"\$(stat -c '%U:%G %a' '${vault}')\" = 'root:root 600' ]" "$(stat -c '%U:%G %a' "${vault}")"

# --- Overwrite, and values YAML would otherwise read as something else.
rc="$(rc_of set_key vault_test_first 'first-secret-rotated\n')"
check "setting an existing key replaces its value" \
  "[ '${rc}' = 0 ] && [ \"\$(value_of vault_test_first)\" = 'first-secret-rotated' ] && [ \"\$(value_of vault_test_second)\" = '${second}' ]" \
  "$(value_of vault_test_first) / $(value_of vault_test_second)"
for literal in true 0123 '1e3' 'a: b # c' "it's" '{{ not_a_template }}'; do
  rc="$(rc_of set_key vault_test_literal "${literal}\n")"
  check "the value ${literal} is stored as that exact string" "[ '${rc}' = 0 ] && [ \"\$(value_of vault_test_literal)\" = \"${literal}\" ]" "rc=${rc} $(value_of vault_test_literal)"
done

# --- Keys the helper did not write stay, and a refused run changes nothing.
plain > "${work}/with-extra.yml"
printf 'unrelated_setting: kept\n' >> "${work}/with-extra.yml"
"${av_path}" encrypt --vault-password-file "${HCW_VAULT_DIR}/vault-password" --output "${vault}" "${work}/with-extra.yml" > /dev/null 2>&1
rm -f "${work}/with-extra.yml"
rc="$(rc_of set_key vault_test_second 'second-secret-rotated\n')"
check "a key the helper did not write is kept" \
  "[ '${rc}' = 0 ] && [ \"\$(value_of unrelated_setting)\" = 'kept' ]" "rc=${rc} $(value_of unrelated_setting)"

before="$(fingerprint)"
rc="$(rc_of set_key vault_test_first '\n')"
check "an empty value is refused with a vault in place" "[ '${rc}' != 0 ] && grep -q 'was empty; nothing changed' '${err}'" "rc=${rc} $(cat "${err}")"
check "the refused run left vault.yml byte for byte" "[ \"\$(fingerprint)\" = '${before}' ]"
rc="$(rc_of set_key VAULT_TEST 'value\n')"
check "a refused key name left vault.yml byte for byte" "[ '${rc}' = 2 ] && [ \"\$(fingerprint)\" = '${before}' ]"

cp "${HCW_VAULT_DIR}/vault-password" "${work}/password.saved"
head -c 32 /dev/urandom | base64 > "${HCW_VAULT_DIR}/vault-password"
rc="$(rc_of set_key vault_test_first 'value\n')"
check "a wrong vault password fails and leaves vault.yml byte for byte" "[ '${rc}' != 0 ] && [ \"\$(fingerprint)\" = '${before}' ]" "rc=${rc}"
cp "${work}/password.saved" "${HCW_VAULT_DIR}/vault-password"

check "no temporary file or directory is left behind" "[ -z \"\$(leftovers)\" ]" "$(leftovers)"

echo "1..$((passed + failed))"
if [ "${failed}" -ne 0 ]; then
  echo "hcw-vault-set.test.sh: ${failed} of $((passed + failed)) checks failed" >&2
  exit 1
fi
echo "hcw-vault-set.test.sh: all ${passed} checks passed"
