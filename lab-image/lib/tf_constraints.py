"""
Terraform version constraints, and which vendored AVM module satisfies one.

Used by bin/hcw-terraform-validate (#675). Installed at /usr/local/lib/hcw
in the runner image; HCW_AVM_ROOT overrides /opt/avm for a test harness.
"""

import os
import re

AVM_ROOT = os.environ.get("HCW_AVM_ROOT", "/opt/avm")

VERSION = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)$")
CLAUSE = re.compile(r"^(~>|>=|<=|!=|>|<|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$")

# Terraform's constraint operators over (version, given, pessimistic upper).
OPERATORS = {
    "=": lambda v, g, _u: v == g,
    "!=": lambda v, g, _u: v != g,
    ">": lambda v, g, _u: v > g,
    ">=": lambda v, g, _u: v >= g,
    "<": lambda v, g, _u: v < g,
    "<=": lambda v, g, _u: v <= g,
    "~>": lambda v, g, u: g <= v < u,
}


def parse_version(text):
    """'0.21.0' or 'v0.21.0' -> (0, 21, 0); anything else -> None."""
    m = VERSION.match(text.strip())
    return tuple(int(x) for x in m.groups()) if m else None


def parse_clause(clause):
    """One `<op> <version>` clause -> (op, given, upper), or None if malformed."""
    m = CLAUSE.match(clause.strip())
    if not m:
        return None
    major, minor, patch = (int(g) if g else 0 for g in m.groups()[1:])
    # ~> 1.2 means >= 1.2.0, < 2.0.0; ~> 1.2.3 means >= 1.2.3, < 1.3.0.
    upper = (major, minor + 1, 0) if m.group(4) else (major + 1, 0, 0)
    return m.group(1) or "=", (major, minor, patch), upper


def satisfies(version, constraint):
    """Terraform's constraint syntax (comma-separated clauses) over a version tuple."""
    if not constraint.strip():
        return True
    clauses = [parse_clause(c) for c in constraint.split(",")]
    return all(c is not None and OPERATORS[c[0]](version, c[1], c[2]) for c in clauses)


def vendored_modules():
    """{module name: [(version tuple, version text), ...]} for every /opt/avm/<name>@<version>."""
    found = {}
    entries = sorted(os.listdir(AVM_ROOT)) if os.path.isdir(AVM_ROOT) else []
    for entry in entries:
        name, _sep, version = entry.rpartition("@")
        parsed = parse_version(version)
        if name and parsed and os.path.isdir(os.path.join(AVM_ROOT, entry)):
            found.setdefault(name, []).append((parsed, version))
    return found


def choose(vendored, name, constraint):
    """The highest vendored version of `name` satisfying `constraint`, as text, or None."""
    candidates = [(v, text) for v, text in vendored.get(name, []) if satisfies(v, constraint)]
    return max(candidates)[1] if candidates else None
