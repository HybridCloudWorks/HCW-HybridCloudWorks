#!/usr/bin/env bash
# Transitive vendoring of the AVM pattern modules' registry children, run in
# the Dockerfile's `vendor` stage with network (issue #675, Phase 2 of #658).
#
# Terraform has a provider mirror but no module mirror: a module that calls a
# registry module needs the registry at `init`, however the providers arrive.
# Measured in #686, avm-ptn-alz calls one registry child and the connectivity
# module calls thirteen distinct ones (sixteen name@version pairs, since two
# are called at two versions), some from inside its own nested modules. This
# script makes all three pattern modules initialise under --network none:
#
#   1. `terraform get` each pattern module from a scratch root that calls it
#      by relative path, so Terraform resolves and downloads the whole child
#      tree and writes .terraform/modules/modules.json describing it.
#   2. Copy each distinct registry child once to $AVM_ROOT/<name>@<version>,
#      the same layout the pattern modules already use, pruned of examples,
#      tests and every dot-prefixed entry (see PRUNE_DIRS below for why the
#      dotfiles matter). A child called with a `//modules/<sub>` suffix is
#      vendored whole and referenced at its subdirectory.
#   3. Inside the vendored copies, rewrite every `module` block that named a
#      registry source to a RELATIVE local path (`../<name>@<version>`), and
#      comment out its `version` argument, which Terraform rejects on a local
#      source. Relative, not absolute: Terraform treats only `./` and `../`
#      as local paths and uses them in place, while an absolute path is a
#      `file://` source that go-getter fetches into .terraform/modules — a
#      copy of every module on the job's tmpfs (measured: 25 MB for the
#      connectivity tree). The rewrite is computed per calling file, so a
#      block inside a nested module gets the `../../../` it needs.
#   4. Verify. Every vendored child's tree hash must equal the one pinned in
#      versions.env under AVM_CHILD_MODULES, every pinned child must have been
#      used, and no unpinned child may appear: a pattern module bump that
#      pulls a new child fails the build until the pin is written. Then a
#      second `terraform get` of each pattern module against the rewritten
#      tree must resolve every module to a local directory, and its output
#      must not mention registry.terraform.io at all.
#
# The tree hash is what coreutils computes with
#   find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum
# inside the vendored directory, reproduced in Python below so the same
# definition serves the build and anyone checking a pin by hand.
#
# AVM_PRINT_PINS=1 prints the AVM_CHILD_MODULES value for versions.env instead
# of verifying it (the procedure for bumping a pattern module, README
# "Updating a version"), and exits 0 without the second-pass check.
set -euo pipefail

: "${AVM_ROOT:=/out/avm}"
: "${TERRAFORM:=/out/bin/terraform}"
: "${SCRATCH:=/build/get}"
: "${AVM_PRINT_PINS:=}"
: "${AVM_CHILD_MODULES:?versions.env must define AVM_CHILD_MODULES (may be empty while printing pins)}"

export CHECKPOINT_DISABLE=1 TF_IN_AUTOMATION=1

# terraform_get <label> <module dir>: a scratch root calling the module by a
# relative path, so modules.json lists the module's own directory rather than
# a file:// copy of it. Prints the scratch root.
terraform_get() {
  local label="$1" dir="$2" root rel
  root="$SCRATCH/$label"
  rm -rf "$root" && mkdir -p "$root"
  rel="$(python3 -c 'import os,sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' "$dir" "$root")"
  case "$rel" in ./*|../*) ;; *) rel="./$rel" ;; esac
  printf 'module "m" {\n  source = "%s"\n}\n' "$rel" > "$root/main.tf"
  (cd "$root" && TF_DATA_DIR="$root/.terraform" "$TERRAFORM" get -no-color) > "$root/get.log" 2>&1 || {
    cat "$root/get.log" >&2
    echo "vendor-avm: terraform get failed for $label" >&2
    return 1
  }
  printf '%s\n' "$root"
}

mapfile -t patterns < <(cd "$AVM_ROOT" && ls -d -- *@* | LC_ALL=C sort)
if [ "${#patterns[@]}" -eq 0 ]; then
  echo "vendor-avm: no <name>@<version> directories under $AVM_ROOT" >&2
  exit 1
fi

echo "vendor-avm: pass 1, resolving children of: ${patterns[*]}"
roots=()
for p in "${patterns[@]}"; do
  roots+=("$(terraform_get "pass1-$p" "$AVM_ROOT/$p")")
done

# Everything that needs modules.json and file rewriting is Python: JSON, path
# arithmetic and a brace-depth walk over HCL are all clearer there than in
# awk, and python3 is in the vendor stage for exactly this.
python3 - "$AVM_ROOT" "$AVM_PRINT_PINS" "${roots[@]}" <<'PY'
import hashlib, json, os, re, shutil, subprocess, sys

avm_root, print_pins, roots = sys.argv[1], sys.argv[2] == "1", sys.argv[3:]
fetched_hash = {}  # "name@version" -> tree hash of the pruned download, before any rewrite
REGISTRY = "registry.terraform.io/"
# Dropped from every vendored copy: examples and tests (size), and every
# dot-prefixed entry at any depth (.git, .github, .vscode, .gitignore,
# .tflint.hcl, .terraform-docs.yml ...). The dotfiles matter for
# determinism, not size: measured on 2026-09-25, two downloads of the same
# publicipaddress@0.2.0 ref differed in exactly those four entries, so a hash
# over them would depend on which call's download was copied first.
PRUNE_DIRS = {"examples", "tests"}
MODULE_HEADER = re.compile(r'^\s*module\s+"([^"]+)"\s*\{')
SOURCE_LINE = re.compile(r'^(\s*)source(\s*)=(\s*)"([^"]+)"(.*)$')
VERSION_LINE = re.compile(r'^(\s*)version\s*=\s*"([^"]+)"(.*)$')


def fail(msg):
    print(f"vendor-avm: {msg}", file=sys.stderr)
    sys.exit(1)


def tree_hash(directory):
    """The coreutils pipeline in the header, byte for byte."""
    paths = []
    for base, dirs, files in os.walk(directory):
        dirs.sort()
        for f in files:
            rel = os.path.relpath(os.path.join(base, f), directory)
            paths.append("./" + rel.replace(os.sep, "/"))
    listing = hashlib.sha256()
    for p in sorted(paths, key=lambda s: s.encode()):
        with open(os.path.join(directory, p), "rb") as fh:
            digest = hashlib.sha256(fh.read()).hexdigest()
        listing.update(f"{digest}  {p}\n".encode())
    return listing.hexdigest()


def prune(directory):
    for base, dirs, files in os.walk(directory):
        for d in list(dirs):
            if d.startswith(".") or d in PRUNE_DIRS:
                shutil.rmtree(os.path.join(base, d))
                dirs.remove(d)
        for f in files:
            if f.startswith("."):
                os.remove(os.path.join(base, f))


def parse_registry(source):
    """'registry.terraform.io/Azure/x/azurerm//modules/y' -> (ns, name, system, sub)."""
    if not source.startswith(REGISTRY):
        return None
    rest, _, sub = source[len(REGISTRY):].partition("//")
    parts = rest.split("/")
    if len(parts) != 3:
        fail(f"unexpected registry source {source!r}")
    return parts[0], parts[1], parts[2], sub


def registry_matches(written, entry):
    """Does a `source = "..."` value name the registry module of this entry?"""
    ns, name, system, sub = entry
    written = written.strip()
    if written.startswith(REGISTRY):
        written = written[len(REGISTRY):]
    rest, _, wsub = written.partition("//")
    parts = rest.split("/")
    return (
        len(parts) == 3
        and parts[0].lower() == ns.lower()
        and parts[1] == name
        and parts[2] == system
        and wsub == sub
    )


def rewrite_block(lines, start, entry, new_source, version):
    """
    Rewrite one module block in place. Returns (end index, state) where state
    is "rewritten", "already" (an earlier call of this run did it) or
    "other" (the block names something else and is left alone). Only depth-1
    lines are attributes of the block itself; a `source` inside a nested
    block or a `for_each = { ... }` value is not.
    """
    depth = lines[start].count("{") - lines[start].count("}")
    i = start + 1
    source_at = version_at = None
    while i < len(lines) and depth > 0:
        line = lines[i]
        if depth == 1:
            if SOURCE_LINE.match(line):
                source_at = i
            elif VERSION_LINE.match(line):
                version_at = i
        depth += line.count("{") - line.count("}")
        i += 1
    if source_at is None:
        return i, "other"
    m = SOURCE_LINE.match(lines[source_at])
    if m.group(4) == new_source:
        return i, "already"
    if not registry_matches(m.group(4), entry):
        return i, "other"
    lines[source_at] = f'{m.group(1)}source{m.group(2)}={m.group(3)}"{new_source}"{m.group(5)}'
    if version_at is not None:
        v = VERSION_LINE.match(lines[version_at])
        lines[version_at] = (
            f'{v.group(1)}# version = "{v.group(2)}"'
            f"  # vendored by lab-image/vendor-avm.sh: {version} at {new_source}"
        )
    return i, "rewritten"


def rewrite_call(parent_dir, child_name, entry, child_dir, version):
    """Find `module "<child_name>"` in the parent's own .tf files and rewrite it."""
    rel = os.path.relpath(child_dir, parent_dir).replace(os.sep, "/")
    if not rel.startswith(("./", "../")):
        rel = "./" + rel
    hits = 0
    for fn in sorted(os.listdir(parent_dir)):
        if not fn.endswith(".tf"):
            continue
        path = os.path.join(parent_dir, fn)
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        i = 0
        changed_file = False
        while i < len(lines):
            m = MODULE_HEADER.match(lines[i])
            if m and m.group(1) == child_name:
                end, state = rewrite_block(lines, i, entry, rel, version)
                if state in ("rewritten", "already"):
                    hits += 1
                changed_file = changed_file or state == "rewritten"
                i = end
            else:
                i += 1
        if changed_file:
            with open(path, "w", encoding="utf-8", newline="\n") as fh:
                fh.write("\n".join(lines))
    if hits == 0:
        fail(f'no module "{child_name}" block naming {entry} found in {parent_dir}')
    return rel


vendored = {}  # "name@version" -> vendored dir
rewrites = []
for root in roots:
    with open(os.path.join(root, ".terraform", "modules", "modules.json")) as fh:
        modules = json.load(fh)["Modules"]
    by_key = {m["Key"]: m for m in modules}
    abs_dir = lambda m: os.path.normpath(os.path.join(root, m["Dir"]))

    # Where each registry download landed -> where its vendored copy lives.
    prefix_map = {}
    for m in modules:
        entry = parse_registry(m.get("Source", ""))
        if not entry:
            continue
        _ns, name, _system, _sub = entry
        download_root = os.path.normpath(os.path.join(root, ".terraform", "modules", m["Key"]))
        prefix_map[download_root] = os.path.join(avm_root, f"{name}@{m['Version']}")

    def to_vendored(directory):
        best = None
        for prefix in prefix_map:
            if directory == prefix or directory.startswith(prefix + os.sep):
                if best is None or len(prefix) > len(best):
                    best = prefix
        if best is not None:
            return prefix_map[best] + directory[len(best):]
        if directory.startswith(avm_root + os.sep):
            return directory
        fail(f"cannot place {directory} in the vendored tree")

    # Copy each distinct child once, pruned, walking the keys in sorted order
    # so the same call supplies the copy on every build. Every later call of
    # the same name@version is a second clone of the same ref: it is pruned
    # and hashed too, and must equal the first or the build stops with the
    # diff, because two "identical" downloads that differ is exactly the
    # thing a pin exists to catch.
    for m in sorted(modules, key=lambda e: e["Key"]):
        entry = parse_registry(m.get("Source", ""))
        if not entry:
            continue
        _ns, name, _system, _sub = entry
        key = f"{name}@{m['Version']}"
        download_root = os.path.normpath(os.path.join(root, ".terraform", "modules", m["Key"]))
        dest = os.path.join(avm_root, key)
        if key not in fetched_hash and not os.path.isdir(dest):
            shutil.copytree(download_root, dest, symlinks=False)
            prune(dest)
            fetched_hash[key] = tree_hash(dest)
            vendored[key] = dest
            print(f"vendor-avm: vendored {key} from {m['Key']}")
            continue
        check = dest + ".check"
        shutil.rmtree(check, ignore_errors=True)
        shutil.copytree(download_root, check, symlinks=False)
        prune(check)
        digest = tree_hash(check)
        expected = fetched_hash.get(key)
        if expected is not None and digest != expected:
            subprocess.run(["diff", "-r", dest, check], check=False)
            fail(f"{key} fetched for {m['Key']} differs from the copy already vendored")
        shutil.rmtree(check)
        fetched_hash.setdefault(key, digest)
        vendored[key] = dest

    # Rewrite every registry call to the relative path of its vendored child.
    for m in modules:
        entry = parse_registry(m.get("Source", ""))
        if not entry:
            continue
        _ns, name, _system, sub = entry
        parent_key, _, child_name = m["Key"].rpartition(".")
        parent_dir = to_vendored(abs_dir(by_key[parent_key]))
        child_dir = os.path.join(avm_root, f"{name}@{m['Version']}")
        if sub:
            child_dir = os.path.join(child_dir, sub)
        rel = rewrite_call(parent_dir, child_name, entry, child_dir, m["Version"])
        rewrites.append((os.path.relpath(parent_dir, avm_root), child_name, rel))

for parent, child, rel in sorted(set(rewrites)):
    print(f"vendor-avm: {parent}: module \"{child}\" -> {rel}")

# Pins. In print mode, emit the value for versions.env and stop here.
hashes = {key: tree_hash(path) for key, path in sorted(vendored.items())}
if print_pins:
    print("AVM_CHILD_MODULES='")
    for key, digest in hashes.items():
        print(f"{key} {digest}")
    print("'")
    sys.exit(0)

pinned = {}
for line in os.environ.get("AVM_CHILD_MODULES", "").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    key, _, digest = line.partition(" ")
    pinned[key] = digest.strip()

problems = []
for key, digest in hashes.items():
    if key not in pinned:
        problems.append(f"{key} was vendored but is not pinned in versions.env")
    elif pinned[key] != digest:
        problems.append(f"{key} hashes {digest}, versions.env pins {pinned[key]}")
for key in pinned:
    if key not in hashes:
        problems.append(f"{key} is pinned in versions.env but no pattern module calls it")
if problems:
    for p in problems:
        print(f"vendor-avm: {p}", file=sys.stderr)
    print("vendor-avm: run the vendor stage with AVM_PRINT_PINS=1 to print the current pins", file=sys.stderr)
    sys.exit(1)
for key, digest in hashes.items():
    print(f"vendor-avm: pinned {key} {digest}")
PY

if [ "$AVM_PRINT_PINS" = 1 ]; then
  exit 0
fi

# Pass 2: with the sources rewritten, every module Terraform resolves must be
# a local directory and nothing may come from the registry.
echo "vendor-avm: pass 2, resolving the rewritten tree"
for p in "${patterns[@]}"; do
  root="$(terraform_get "pass2-$p" "$AVM_ROOT/$p")"
  if grep -q 'registry.terraform.io' "$root/get.log"; then
    cat "$root/get.log" >&2
    echo "vendor-avm: $p still reaches the registry after rewriting" >&2
    exit 1
  fi
  if [ -d "$root/.terraform/modules" ] && find "$root/.terraform/modules" -mindepth 1 -maxdepth 1 -type d | grep -q .; then
    find "$root/.terraform/modules" -mindepth 1 -maxdepth 1 >&2
    echo "vendor-avm: $p still downloads modules into .terraform/modules" >&2
    exit 1
  fi
  echo "vendor-avm: $p resolves entirely to local directories ($(grep -c '^- ' "$root/get.log") modules)"
done
rm -rf "$SCRATCH"
echo "vendor-avm: done"
