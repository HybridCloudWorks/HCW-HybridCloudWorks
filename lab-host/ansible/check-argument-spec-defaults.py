"""Fail when a role's argument spec gives an option a default that nothing sets.

Ansible checks a role's arguments against meta/argument_specs.yml, but it never
turns a spec's `default:` into a variable. An option whose default is written
only there is undefined when a task reads it. coder_workspace_memory_mib and
coder_server_memory_reserve_mib were, and the first run with coder_enabled
true stopped at the coder role's capacity assertion (2026-09-28). So every
option with a default must also be set in the role's defaults/main.yml or
vars/main.yml, or in group_vars/all.yml. Where the role's defaults/main.yml
sets it to a plain value, that value must be the one the spec documents.

CI runs this in the `ansible-lint (lab-host)` job; any Python with PyYAML
(ansible-core brings it) runs it from anywhere:

    python lab-host/ansible/check-argument-spec-defaults.py
"""

import pathlib
import sys

import yaml

HERE = pathlib.Path(__file__).resolve().parent


def load(path):
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def optional(path):
    """A YAML mapping, or an empty one when the file does not exist."""
    return load(path) if path.exists() else {}


def default_problem(option, contract, defaults, set_anywhere):
    """What is wrong with one option's default, or None."""
    if "default" not in (contract or {}):
        return None
    if option not in set_anywhere:
        return (
            f"{option} has a default only in meta/argument_specs.yml; "
            "Ansible never applies it, so set it in defaults/main.yml"
        )
    value = defaults.get(option, contract["default"])
    templated = isinstance(value, str) and "{{" in value
    if templated or value == contract["default"]:
        return None
    return f"{option} is {value!r} in defaults/main.yml but {contract['default']!r} in meta/argument_specs.yml"


def role_problems(spec, group_vars):
    """Every problem in one role's argument spec, prefixed with the role and entry point."""
    role = spec.parent.parent
    defaults = optional(role / "defaults" / "main.yml")
    set_anywhere = set(defaults) | set(optional(role / "vars" / "main.yml")) | set(group_vars)
    problems = []
    for entry, body in (load(spec).get("argument_specs") or {}).items():
        for option, contract in ((body or {}).get("options") or {}).items():
            problem = default_problem(option, contract, defaults, set_anywhere)
            if problem:
                problems.append(f"{role.name} ({entry}): {problem}")
    return problems


def main():
    group_vars = load(HERE / "group_vars" / "all.yml")
    specs = sorted(HERE.glob("roles/*/meta/argument_specs.yml"))
    problems = [problem for spec in specs for problem in role_problems(spec, group_vars)]
    for problem in problems:
        print(problem)
    if problems:
        print(f"check-argument-spec-defaults: {len(problems)} problem(s) in {len(specs)} roles", file=sys.stderr)
        return 1
    print(f"check-argument-spec-defaults: every default in {len(specs)} roles' argument specs is set, and agrees")
    return 0


if __name__ == "__main__":
    sys.exit(main())
