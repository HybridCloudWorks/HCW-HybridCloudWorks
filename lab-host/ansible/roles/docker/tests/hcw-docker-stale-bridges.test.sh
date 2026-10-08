#!/usr/bin/env bash
# Tests ../files/hcw-docker-stale-bridges.py, which the docker role installs as
# /usr/local/libexec/hcw-docker-stale-bridges and runs on every bootstrap. It
# deletes network interfaces, so it is run here against stand-ins for `docker`
# and `ip` that answer like the lab host did on 2026-10-08 (two stale Coder
# bridges beside the two live ones) and record every delete.
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
mkdir -p "${bin}"

# The daemon's networks: coder, coder-control, and one Portainer network.
cat > "${bin}/docker" <<'EOF'
#!/usr/bin/env bash
[ "$1 $2" = "network ls" ] || { echo "unexpected docker $*" >&2; exit 2; }
[ -n "${FAKE_DOCKER_FAIL:-}" ] && { echo "Cannot connect to the Docker daemon" >&2; exit 1; }
printf '%s\n' 36a702e13fc7aaaabbbbccccddddeeeeffff000011112222333344445555 \
  dd814074ae36aaaabbbbccccddddeeeeffff000011112222333344445555 \
  4f1e2d3c4b5aaaaabbbbccccddddeeeeffff000011112222333344445555
EOF

# The kernel's bridges: the four Coder ones, docker0, one Docker-named stale
# bridge with a port still attached, and another program's bridge.
cat > "${bin}/ip" <<'EOF'
#!/usr/bin/env bash
case "$*" in
  "-j link show type bridge")
    echo '[{"ifname":"docker0"},{"ifname":"br-0d1f60c06b21"},{"ifname":"br-fc10ca1d255f"},{"ifname":"br-dd814074ae36"},{"ifname":"br-36a702e13fc7"},{"ifname":"br-4f1e2d3c4b5a"},{"ifname":"br-aaaaaaaaaaaa"},{"ifname":"virbr0"},{"ifname":"br-lan"}]' ;;
  "-j link show master br-aaaaaaaaaaaa") echo '[{"ifname":"veth1234"}]' ;;
  "-j link show master "*) echo '[]' ;;
  "link delete "*) echo "$3" >> "${FAKE_IP_DELETED}" ;;
  *) echo "unexpected ip $*" >&2; exit 2 ;;
esac
EOF
chmod +x "${bin}/docker" "${bin}/ip"

deleted="${work}/deleted"
run_helper() { PATH="${bin}:${PATH}" FAKE_IP_DELETED="${deleted}" python3 "${helper}" "$@"; }

: > "${deleted}"
out="$(run_helper)"
check "deletes the two stale Coder bridges, in the kernel's order" \
  '[ "$(cat "${deleted}")" = "$(printf "br-0d1f60c06b21\nbr-fc10ca1d255f")" ]' "deleted: $(tr '\n' ' ' < "${deleted}")"
check "reports them, and keeps the stale one with a port attached" \
  '[ "${out}" = "{\"deleted\": [\"br-0d1f60c06b21\", \"br-fc10ca1d255f\"], \"kept_attached\": [\"br-aaaaaaaaaaaa\"]}" ]' "${out}"
check "leaves every live network's bridge, docker0 and other programs' bridges" \
  '! grep -qE "br-36a702e13fc7|br-dd814074ae36|br-4f1e2d3c4b5a|docker0|virbr0|br-lan" "${deleted}"'

: > "${deleted}"
out="$(run_helper --dry-run)"
check "--dry-run reports and deletes nothing" \
  '[ ! -s "${deleted}" ] && echo "${out}" | grep -q "br-0d1f60c06b21"' "${out}"

: > "${deleted}"
if FAKE_DOCKER_FAIL=1 run_helper > "${work}/stdout" 2> "${work}/stderr"; then
  not_ok "fails when the daemon cannot be read" "it exited 0"
else
  check "fails when the daemon cannot be read, and deletes nothing" \
    '[ ! -s "${deleted}" ] && grep -q "Cannot connect" "${work}/stderr"' "$(cat "${work}/stderr")"
fi

echo "1..${passed}"
[ "${failed}" -eq 0 ] || { echo "${failed} failed" >&2; exit 1; }
