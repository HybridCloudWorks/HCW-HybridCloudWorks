"""
Rewrite registry AVM module sources in a Terraform tree to the vendored
copies under /opt/avm (#675, ADR 0032 decision 5).

Used by bin/hcw-terraform-validate on its tmpfs copy of the payload; the
learner's files are never touched. A `module` block is rewritten only when
its `source` names an Azure Verified Module and a vendored version satisfies
its `version` constraint (tf_constraints); everything else is left exactly
as written so `terraform init` fails loudly on it.
"""

import os
import re
from pathlib import Path

from tf_constraints import AVM_ROOT, choose

REGISTRY_SOURCE = re.compile(
    r"^(?:registry\.terraform\.io/)?[Aa]zure/([A-Za-z0-9._-]+)/(azurerm|azure)(?://(.+))?$"
)
MODULE_HEADER = re.compile(r'^\s*module\s+"([^"]+)"\s*\{')
SOURCE_LINE = re.compile(r'^(\s*)source(\s*)=(\s*)"([^"]+)"(.*)$')
VERSION_LINE = re.compile(r'^(\s*)version\s*=\s*"([^"]*)"(.*)$')
SKIP_DIRS = {".terraform", ".git"}


def brace_delta(line):
    return line.count("{") - line.count("}")


def scan_block(lines, start):
    """
    Walk one `module` block from its header line. Returns (end index, index
    of its `source` line, index of its `version` line); only depth-1 lines
    are attributes of the block itself, so a `source` inside a nested block
    or a `for_each = { ... }` value is not taken.
    """
    depth = brace_delta(lines[start])
    j = start + 1
    source_at = version_at = None
    while j < len(lines) and depth > 0:
        if depth == 1 and SOURCE_LINE.match(lines[j]):
            source_at = j
        elif depth == 1 and VERSION_LINE.match(lines[j]):
            version_at = j
        depth += brace_delta(lines[j])
        j += 1
    return j, source_at, version_at


def module_blocks(lines):
    """Yield (name, source index, version index) for every top-level module block."""
    i = 0
    while i < len(lines):
        header = MODULE_HEADER.match(lines[i])
        if not header:
            i += 1
            continue
        end, source_at, version_at = scan_block(lines, i)
        yield header.group(1), source_at, version_at
        i = end


def relative_target(module, version, sub, file_dir):
    """The vendored copy as a `./` or `../` path from the calling file's directory."""
    target = os.path.join(AVM_ROOT, f"{module}@{version}", sub or "")
    rel = os.path.relpath(target, file_dir).replace(os.sep, "/")
    return rel if rel.startswith(("./", "../")) else "./" + rel


def resolve_block(lines, block, vendored, file_dir):
    """
    Decide one module block's fate. Returns None for a block that names no
    registry AVM source, else (report line, {line index: new text}); the
    edits are empty when no vendored version satisfies the constraint.
    """
    block_name, source_at, version_at = block
    src = SOURCE_LINE.match(lines[source_at]) if source_at is not None else None
    reg = REGISTRY_SOURCE.match(src.group(4).strip()) if src else None
    if not reg:
        return None
    module, sub = reg.group(1), reg.group(3)
    ver = VERSION_LINE.match(lines[version_at]) if version_at is not None else None
    constraint = ver.group(2) if ver else ""
    label = f'module "{block_name}" ({src.group(4)}{" " + constraint if constraint else ""})'
    picked = choose(vendored, module, constraint)
    if picked is None:
        have = ", ".join(text for _v, text in vendored.get(module, [])) or "none vendored"
        return f"left    {label}: no vendored version satisfies it (have: {have})", {}
    rel = relative_target(module, picked, sub, file_dir)
    edits = {source_at: f'{src.group(1)}source{src.group(2)}={src.group(3)}"{rel}"{src.group(5)}'}
    if ver:
        edits[version_at] = f'{ver.group(1)}# version = "{ver.group(2)}"  # vendored: {picked}'
    return f"rewrote {label} -> {rel}", edits


def rewrite_file(path, vendored, report):
    """Rewrite one .tf file in place, appending one report line per registry block."""
    lines = path.read_text(encoding="utf-8").split("\n")
    edits = {}
    for block in module_blocks(lines):
        outcome = resolve_block(lines, block, vendored, str(path.parent))
        if outcome is not None:
            report.append(outcome[0])
            edits.update(outcome[1])
    for index, text in edits.items():
        lines[index] = text
    if edits:
        path.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def rewrite_tree(root, vendored):
    """Rewrite every .tf under root (skipping .terraform and .git); returns the report lines."""
    report = []
    for path in sorted(Path(root).rglob("*.tf")):
        if not SKIP_DIRS.intersection(path.relative_to(root).parts):
            rewrite_file(path, vendored, report)
    return report
