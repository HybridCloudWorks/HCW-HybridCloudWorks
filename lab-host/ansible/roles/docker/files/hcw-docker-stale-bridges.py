#!/usr/bin/python3
"""Delete the bridges a Docker data root this daemon no longer uses left behind.

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

What is deleted is decided by provenance, not by name (review of #1025). A
bridge `br-<12 hex>` is deleted only when all of these hold:

  - its network is recorded in another Docker data root on this host: the
    12 hex digits begin a 64-hex id in that root's network database
    (network/files/local-kv.db), under the legacy root or a remapped
    `<uid>.<gid>` root, whichever the running daemon is not using. Another
    program's bridge with a Docker-looking name is in no Docker database,
    and a network the running daemon creates is recorded in its own root,
    never another, so neither can qualify;
  - the running daemon does not list it, checked again just before the
    delete;
  - nothing is attached to it.

A qualifying bridge with an interface attached is reported and left alone.
docker0, every bridge of the running root and every other program's bridge
stay, whatever they are named.

    hcw-docker-stale-bridges [--dry-run] [--docker-dir /var/lib/docker]

Prints one JSON object on stdout, {"deleted": [...], "kept_attached": [...]},
and exits 0; exits non-zero with the reason on stderr when docker or ip
cannot be read. --dry-run reports what it would delete and deletes nothing.
"""

import argparse
import json
import os
import re
import subprocess
import sys

DOCKER_BRIDGE = re.compile(r"^br-([0-9a-f]{12})$")
NETWORK_ID = re.compile(rb"[0-9a-f]{64}")
REMAPPED_ROOT = re.compile(r"^[0-9]+\.[0-9]+$")
NETWORK_DB = os.path.join("network", "files", "local-kv.db")


def run(argv):
    result = subprocess.run(argv, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        print(
            f"hcw-docker-stale-bridges: {' '.join(argv)} failed: {result.stderr.strip()}",
            file=sys.stderr,
        )
        sys.exit(1)
    return result.stdout


def owned_prefixes():
    """The 12-hex prefix of every bridge network the running daemon lists."""
    ids = run(["docker", "network", "ls", "--no-trunc", "--filter", "driver=bridge", "--format", "{{.ID}}"])
    return {network_id[:12] for network_id in ids.split()}


def running_root():
    return os.path.realpath(run(["docker", "info", "--format", "{{.DockerRootDir}}"]).strip())


def data_roots(docker_dir):
    """The legacy root and every remapped `<uid>.<gid>` root beneath it."""
    roots = [docker_dir]
    try:
        roots += [
            os.path.join(docker_dir, name)
            for name in sorted(os.listdir(docker_dir))
            if REMAPPED_ROOT.match(name)
        ]
    except FileNotFoundError:
        return []
    return roots


def recorded_prefixes(root):
    """The 12-hex prefix of every 64-hex id in a root's network database."""
    try:
        with open(os.path.join(root, NETWORK_DB), "rb") as handle:
            data = handle.read()
    except (FileNotFoundError, NotADirectoryError):
        return set()
    return {match.group(0)[:12].decode("ascii") for match in NETWORK_ID.finditer(data)}


def other_roots_prefixes(docker_dir, current):
    prefixes = set()
    for root in data_roots(docker_dir):
        if os.path.realpath(root) != current:
            prefixes |= recorded_prefixes(root)
    return prefixes


def bridge_names():
    links = json.loads(run(["ip", "-j", "link", "show", "type", "bridge"]) or "[]")
    return [link["ifname"] for link in links if "ifname" in link]


def attached(bridge):
    return json.loads(run(["ip", "-j", "link", "show", "master", bridge]) or "[]")


def candidates(bridges, left_behind, owned):
    """Bridges whose network another root recorded and the running daemon does not list."""
    found = []
    for name in bridges:
        match = DOCKER_BRIDGE.match(name)
        if match and match.group(1) in left_behind and match.group(1) not in owned:
            found.append(name)
    return found


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="report, delete nothing")
    parser.add_argument("--docker-dir", default="/var/lib/docker", help="the legacy data root")
    args = parser.parse_args()

    left_behind = other_roots_prefixes(args.docker_dir, running_root())
    report = {"deleted": [], "kept_attached": []}
    for bridge in candidates(bridge_names(), left_behind, owned_prefixes()):
        if attached(bridge):
            report["kept_attached"].append(bridge)
            continue
        # Checked again just before the delete: the running daemon may have
        # listed a network since the first read.
        if DOCKER_BRIDGE.match(bridge).group(1) in owned_prefixes():
            continue
        if not args.dry_run:
            run(["ip", "link", "delete", bridge])
        report["deleted"].append(bridge)
    print(json.dumps(report))


if __name__ == "__main__":
    main()
