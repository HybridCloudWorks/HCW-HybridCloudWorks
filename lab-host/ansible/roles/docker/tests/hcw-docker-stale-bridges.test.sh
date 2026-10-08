#!/usr/bin/env bash
# Tests ../files/hcw-docker-stale-bridges.py, which the docker role installs as
# /usr/local/libexec/hcw-docker-stale-bridges and runs on every bootstrap. It
# deletes network interfaces, so it is run here against stand-ins for `docker`
# and `ip` and a scratch /var/lib/docker shaped like the lab host on
# 2026-10-08: the legacy root's network database recording the two Coder
# networks whose bridges were left behind, and the remapped root, which the
# running daemon uses, recording the live ones. Every delete is recorded.
#
# Needs no root and no Docker: bash and python3. CI runs it in the
# `ansible-lint (lab-host)` job; on a workstation, bash:
#   bash lab-host/ansible/roles/docker/tests/hcw-docker-stale-bridges.test.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
helper="${here}/../files/hcw-docker-stale-bridges.py"

passed=0
failed=0
ok() { passed=$((passed + 1)); echo "ok ${passed} - $1"; }
not_ok() { failed=$((failed + 1)); echo "not ok - $1" >&2; [ -z "${2:-}" ] || printf '    %s\n' "$2" >&2; }
check() { if eval "$2"; then ok "$1"; else not_ok "$1" "${3:-}"; fi; }

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
bin="${work}/bin"
docker_dir="${work}/var-lib-docker"
mkdir -p "${bin}" "${docker_dir}/network/files" "${docker_dir}/100000.100000/network/files"

tail52=aaaabbbbccccddddeeeeffff0000111122223333444455556666
id() { printf '%s%s' "$1" "${tail52}"; }

# A network database as libnetwork's bolt store holds it: binary around keys
# that carry each 64-hex network id.
write_db() {
  local file="$1"; shift
  { printf '\x00\x01bolt'; for nid in "$@"; do printf 'docker/network/v1.0/network/%s/\x00\x07' "${nid}"; done; } > "${file}"
}
# The legacy root, before the switch: the two Coder networks and one more
# whose bridge still has a port attached.
write_db "${docker_dir}/network/files/local-kv.db" \
  "$(id 0d1f60c06b21)" "$(id fc10ca1d255f)" "$(id aaaaaaaaaaaa)"
# The remapped root the daemon runs on: the live Coder networks, Portainer's,
# and one created after the helper first listed the networks.
write_db "${docker_dir}/100000.100000/network/files/local-kv.db" \
  "$(id 36a702e13fc7)" "$(id dd814074ae36)" "$(id 4f1e2d3c4b5a)" "$(id 9e9e9e9e9e9e)"

cat > "${bin}/docker" <<EOF
#!/usr/bin/env bash
[ -n "\${FAKE_DOCKER_FAIL:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
case "\$1 \$2" in
  "info --format") echo "${docker_dir}/100000.100000" ;;
  # 9e9e9e9e9e9e is not listed yet: it was created after this listing.
  "network ls") printf '%s\n' $(id 36a702e13fc7) $(id dd814074ae36) $(id 4f1e2d3c4b5a) ;;
  *) echo "unexpected docker \$*" >&2; exit 2 ;;
esac
EOF

# The kernel's bridges: the four Coder ones, Portainer's, the new one,
# docker0, a stale one with a port attached, and two other programs' bridges,
# one of them named exactly the way Docker names its own.
cat > "${bin}/ip" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  "-j link show type bridge")
    echo '[{"ifname":"docker0"},{"ifname":"br-0d1f60c06b21"},{"ifname":"br-fc10ca1d255f"},{"ifname":"br-dd814074ae36"},{"ifname":"br-36a702e13fc7"},{"ifname":"br-4f1e2d3c4b5a"},{"ifname":"br-9e9e9e9e9e9e"},{"ifname":"br-aaaaaaaaaaaa"},{"ifname":"br-123456abcdef"},{"ifname":"virbr0"}]' ;;
  "-j link show master br-aaaaaaaaaaaa") echo '[{"ifname":"veth1234"}]' ;;
  "-j link show master "*) echo '[]' ;;
  "link delete "*) echo "$3" >> "${FAKE_IP_DELETED}" ;;
  *) echo "unexpected ip $*" >&2; exit 2 ;;
esac
EOF
chmod +x "${bin}/docker" "${bin}/ip"

deleted="${work}/deleted"
run_helper() { PATH="${bin}:${PATH}" FAKE_IP_DELETED="${deleted}" python3 "${helper}" --docker-dir "${docker_dir}" "$@"; }

: > "${deleted}"
out="$(run_helper)"
check "deletes the two Coder bridges the legacy root left behind, in the kernel's order" \
  '[ "$(cat "${deleted}")" = "$(printf "br-0d1f60c06b21\nbr-fc10ca1d255f")" ]' "deleted: $(tr '\n' ' ' < "${deleted}")"
check "reports them, and keeps the left-behind one with a port attached" \
  '[ "${out}" = "{\"deleted\": [\"br-0d1f60c06b21\", \"br-fc10ca1d255f\"], \"kept_attached\": [\"br-aaaaaaaaaaaa\"]}" ]' "${out}"
check "leaves every bridge of the running root, docker0 and virbr0" \
  '! grep -qE "br-36a702e13fc7|br-dd814074ae36|br-4f1e2d3c4b5a|docker0|virbr0" "${deleted}"'
check "leaves another program's bridge named the way Docker names one: no Docker root records it" \
  '! grep -q "br-123456abcdef" "${deleted}"'
check "leaves a network the running daemon created after the listing: its own root records it, not another" \
  '! grep -q "br-9e9e9e9e9e9e" "${deleted}"'

: > "${deleted}"
out="$(run_helper --dry-run)"
check "--dry-run reports and deletes nothing" \
  '[ ! -s "${deleted}" ] && echo "${out}" | grep -q "br-0d1f60c06b21"' "${out}"

# Before any switch there is only the legacy root, and the daemon runs on it.
solo="${work}/solo"
mkdir -p "${solo}/network/files"
write_db "${solo}/network/files/local-kv.db" "$(id 36a702e13fc7)"
sed "s#${docker_dir}/100000.100000#${solo}#" "${bin}/docker" > "${bin}/docker.solo" && chmod +x "${bin}/docker.solo"
mv "${bin}/docker.solo" "${bin}/docker"
: > "${deleted}"
out="$(PATH="${bin}:${PATH}" FAKE_IP_DELETED="${deleted}" python3 "${helper}" --docker-dir "${solo}")"
check "deletes nothing on a host with one data root" \
  '[ ! -s "${deleted}" ] && [ "${out}" = "{\"deleted\": [], \"kept_attached\": []}" ]' "${out}"

: > "${deleted}"
if FAKE_DOCKER_FAIL=1 run_helper > "${work}/stdout" 2> "${work}/stderr"; then
  not_ok "fails when the daemon cannot be read" "it exited 0"
else
  check "fails when the daemon cannot be read, and deletes nothing" \
    '[ ! -s "${deleted}" ] && grep -q "Cannot connect" "${work}/stderr"' "$(cat "${work}/stderr")"
fi

echo "1..${passed}"
[ "${failed}" -eq 0 ] || { echo "${failed} failed" >&2; exit 1; }
