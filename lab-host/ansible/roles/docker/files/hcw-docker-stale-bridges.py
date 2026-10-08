#!/usr/bin/python3
"""Delete the Docker bridges no network on the running daemon owns.

Installed by the docker role as /usr/local/libexec/hcw-docker-stale-bridges
and run by it on every bootstrap, after the daemon is up.

Why (2026-10-08). Turning userns-remap on moves the daemon to another data
root, and the networks of the old root are not deleted: their bridge
interfaces stay in the kernel, down, with their addresses and routes. The
Coder networks have fixed subnets (172.28.240.0/24 and 172.28.241.0/24), so
the new daemon made new bridges on the same subnets, and the host then held
two routes for each. The stale bridge's route came first, so the host's own
traffic to the Coder container, Docker's port proxy on 127.0.0.1:7080
included, went into an empty bridge and timed out. Container-to-container
traffic does not use the host's routes, so Coder and PostgreSQL still talked
and nothing looked wrong from inside. Caddy answered 503.

What is deleted: an interface that is a bridge, is named the way Docker names
one (br- and twelve hex digits of a network id), is not the bridge of any
network the running daemon lists, and has no interface attached to it. One
with anything attached is reported and left alone. Nothing else is touched:
docker0, another program's bridge, and every live network's bridge stay.

    hcw-docker-stale-bridges [--dry-run]

Prints one JSON object on stdout, {"deleted": [...], "kept_attached": [...]},
and exits 0; exits non-zero with the reason on stderr when docker or ip
cannot be read. --dry-run reports what it would delete and deletes nothing.
"""

import argparse
import json
import re
import subprocess
import sys

DOCKER_BRIDGE = re.compile(r"^br-[0-9a-f]{12}$")


def run(argv):
    result = subprocess.run(argv, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        print(
            f"hcw-docker-stale-bridges: {' '.join(argv)} failed: {result.stderr.strip()}",
            file=sys.stderr,
        )
        sys.exit(1)
    return result.stdout


def owned_bridges():
    """The bridge interface of every bridge network the running daemon lists."""
    ids = run(["docker", "network", "ls", "--no-trunc", "--filter", "driver=bridge", "--format", "{{.ID}}"])
    return {f"br-{network_id[:12]}" for network_id in ids.split()}


def bridge_names():
    links = json.loads(run(["ip", "-j", "link", "show", "type", "bridge"]) or "[]")
    return [link["ifname"] for link in links if "ifname" in link]


def attached(bridge):
    return json.loads(run(["ip", "-j", "link", "show", "master", bridge]) or "[]")


def stale(bridges, owned):
    """Docker-named bridges that no live network owns, in the order given."""
    return [name for name in bridges if DOCKER_BRIDGE.match(name) and name not in owned]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="report, delete nothing")
    args = parser.parse_args()

    report = {"deleted": [], "kept_attached": []}
    for bridge in stale(bridge_names(), owned_bridges()):
        if attached(bridge):
            report["kept_attached"].append(bridge)
            continue
        if not args.dry_run:
            run(["ip", "link", "delete", bridge])
        report["deleted"].append(bridge)
    print(json.dumps(report))


if __name__ == "__main__":
    main()
