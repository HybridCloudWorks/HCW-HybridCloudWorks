#!/usr/bin/env python3
"""Create, discover, and validate Claude agentic workflow state locally.

Path model (two anchors, never confused):
  PACK_HOME   = the directory this script lives in (tooling/). The agent
                registry lives beside the script and always resolves here.
  PROJECT_DIR = the repository the workflow runs in. Resolved in order:
                --root flag > CLAUDE_PROJECT_DIR env > git toplevel > cwd.
                All runtime state (.agentic/) is created under PROJECT_DIR.

Commands:
  registry   regenerate tooling/agent-registry.yml from installed agents
  discover   report which registry agents are installed (project + user scope)
  init       create .agentic/workflows/<id>/ before any delegation
  validate   check required handoffs; exit 0 only when the workflow is clean
  close      end a workflow: 'completed' only when validation is clean,
             otherwise --abandon records it as abandoned with its open errors
  status     print a workflow's WORKFLOW.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

PACK_HOME = Path(__file__).resolve().parent
REGISTRY = PACK_HOME / "agent-registry.yml"
ORCHESTRATOR_NAME = "claude-agentic-orchestrator"

# A workflow in one of these states no longer holds the Stop guard. Nothing but
# close() may put a workflow here, and close() will not write "completed" over
# missing handoffs -- an operator with no exit was the reason WORKFLOW.json got
# hand-edited into "completed" while its own validation still listed 11 errors.
TERMINAL_STATUSES = ("completed", "abandoned")


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def project_dir(cli_root: str | None) -> Path:
    """Resolve the repository root. Explicit flag wins; state never lands in a surprise cwd."""
    if cli_root:
        return Path(cli_root).resolve()
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return Path(env).resolve()
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=10,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return Path(proc.stdout.strip()).resolve()
    except (OSError, subprocess.TimeoutExpired):
        # No git on PATH, not a repository, or git hung past the timeout. Fall
        # through to cwd rather than failing: this is the last of three
        # fallbacks and the caller has no better answer to offer.
        pass
    return Path.cwd().resolve()


def frontmatter(path: Path) -> dict[str, str]:
    """Read simple key: value pairs from a markdown frontmatter block only."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {}
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not match:
        return {}
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        m = re.match(r"^([A-Za-z_][\w-]*):\s*(.+?)\s*$", line)
        if m and not m.group(2).startswith("#"):
            fields[m.group(1)] = m.group(2).split(" #", 1)[0].strip().strip("\"'")
    return fields


def agent_locations(root: Path, include_user: bool) -> list[Path]:
    locations = [root / ".claude" / "agents"]
    if include_user:
        user = Path.home() / ".claude" / "agents"
        if user.resolve() != locations[0].resolve():
            locations.append(user)
    return locations


def installed_agents(root: Path, include_user: bool) -> dict[str, dict]:
    """Map frontmatter agent name -> {paths, description}. Scans recursively, as Claude Code does."""
    found: dict[str, dict] = {}
    for location in agent_locations(root, include_user):
        if not location.is_dir():
            continue
        for path in sorted(location.rglob("*.md")):
            fields = frontmatter(path)
            name = fields.get("name")
            if not name:
                continue
            entry = found.setdefault(name, {"paths": [], "description": fields.get("description", "")})
            entry["paths"].append(str(path))
    return found


def parse_registry(path: Path = REGISTRY) -> list[dict[str, str]]:
    if not path.is_file():
        raise SystemExit(
            f"agent registry not found: {path}\n"
            f"Run: python {Path(__file__).name} registry   (from any directory; the registry lives beside this script)"
        )
    items: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith("- id:"):
            if current:
                items.append(current)
            current = {"id": line.split(":", 1)[1].strip()}
        elif current and ":" in line and not line.startswith("#"):
            key, value = line.split(":", 1)
            current[key.strip()] = value.strip().strip("\"'")
    if current:
        items.append(current)
    return items


def write_registry(root: Path, include_user: bool) -> int:
    """Regenerate the registry from agents that are actually installed."""
    found = installed_agents(root, include_user)
    names = sorted(n for n in found if n != ORCHESTRATOR_NAME)
    lines = [
        "# Generated by workflow.py registry -- edit capability text freely,",
        "# but agent_name must equal the agent file's frontmatter `name` exactly.",
        "version: 1",
        "client: claude-code",
        f"generated_at: {now()}",
        "agents:",
    ]
    for name in names:
        capability = found[name]["description"] or name
        capability = capability.replace('"', "'")
        lines += [
            f"  - id: {name}",
            f"    agent_name: {name}",
            f'    capability: "{capability[:160]}"',
            "    enabled_by_default: true",
        ]
    if not names:
        lines.append("  []")
    REGISTRY.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"registry written: {REGISTRY} ({len(names)} agents)")
    if not names:
        print("warning: no installed agents found. Populate .claude/agents (project or user scope) first.", file=sys.stderr)
    return 0


def discover(root: Path, include_user: bool) -> dict:
    found = installed_agents(root, include_user)
    registry_items = parse_registry()
    registry_names = {item["agent_name"] for item in registry_items}
    records = []
    for item in registry_items:
        entry = found.get(item["agent_name"], {"paths": []})
        records.append({
            "id": item["id"],
            "agent_name": item["agent_name"],
            "capability": item.get("capability", ""),
            "available": bool(entry["paths"]),
            "paths": entry["paths"],
            "enabled_by_default": item.get("enabled_by_default", "false").lower() == "true",
        })
    unknown = sorted(n for n in found if n not in registry_names and n != ORCHESTRATOR_NAME)
    return {"generated_at": now(), "root": str(root), "agents": records, "unknown_agents": unknown}


def run_discovery(root: Path, include_user: bool, out: str) -> dict:
    """Discovery is always fresh -- no stale cache can hide a newly installed agent."""
    result = discover(root, include_user)
    output = root / out
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def selected_nodes(discovery: dict, mode: str, names: list[str]) -> list[dict]:
    available = {item["id"]: item for item in discovery["agents"]}
    if mode == "all":
        requested = [item["id"] for item in discovery["agents"] if item["enabled_by_default"]]
    elif mode == "one":
        requested = names or [item["id"] for item in discovery["agents"] if item["available"]][:1]
    else:
        requested = names
    if not requested:
        raise SystemExit("no agent is available for the requested workflow mode")
    nodes = []
    for name in requested:
        if name not in available:
            nodes.append({"id": name, "agent_name": name, "required": True, "available": False, "status": "blocked"})
        else:
            item = available[name]
            nodes.append({
                "id": name, "agent_name": item["agent_name"], "required": True,
                "available": item["available"],
                "status": "queued" if item["available"] else "blocked",
            })
    return nodes


def armed_workflow(root: Path) -> dict | None:
    """The active workflow, but only while it is still armed: enforce_stop set and
    not closed. init used to overwrite active-workflow.json unconditionally, so a
    second init silently orphaned the first workflow's Stop guard."""
    active = root / ".agentic" / "active-workflow.json"
    if not active.is_file():
        return None
    try:
        workflow_id = json.loads(active.read_text(encoding="utf-8"))["workflow_id"]
        state_path = root / ".agentic" / "workflows" / workflow_id / "WORKFLOW.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, KeyError, json.JSONDecodeError):
        return None
    if state.get("enforce_stop") and state.get("status") not in TERMINAL_STATUSES:
        return state
    return None


def init_workflow(args: argparse.Namespace, root: Path) -> int:
    armed = armed_workflow(root)
    if armed and not args.force:
        raise SystemExit(
            f"active workflow {armed['workflow_id']} is armed (enforce_stop) and not closed; "
            f"opening another would orphan its Stop guard. Close it first with "
            f"'workflow.py close --workflow {armed['workflow_id']} --reason <why> [--abandon]', "
            f"or pass --force to open a new workflow anyway."
        )
    workflow_id = args.workflow_id or "wf-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    directory = root / ".agentic" / "workflows" / workflow_id
    if directory.exists():
        raise SystemExit(f"workflow already exists: {workflow_id}")
    discovery = run_discovery(root, include_user=not args.no_user, out=".agentic/discovery.json")
    nodes = selected_nodes(discovery, args.mode, [x for x in args.agents.split(",") if x])
    optional = {x for x in args.optional_agents.split(",") if x}
    for node in nodes:
        if args.mode == "all" and not args.require_all:
            node["required"] = bool(node["available"])
            if not node["available"]:
                node["status"] = "skipped_optional"
        if node["id"] in optional:
            node["required"] = False
            if not node["available"]:
                node["status"] = "skipped_optional"
    state = {
        "workflow_id": workflow_id,
        "created_at": now(),
        "updated_at": now(),
        "mode": args.mode,
        "objective": args.objective,
        "enforce_stop": bool(args.enforce_stop),
        "max_parallel": args.max_parallel,
        "nodes": nodes,
        "status": "blocked" if any(n["required"] and not n["available"] for n in nodes) else "queued",
    }
    (directory / "handoffs").mkdir(parents=True)
    (directory / "artifacts").mkdir()
    (directory / "WORKFLOW.json").write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    (root / ".agentic" / "active-workflow.json").write_text(
        json.dumps({"workflow_id": workflow_id, "path": str(directory)}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(state, indent=2))
    return 0


def scalar(text: str, key: str) -> str | None:
    match = re.search(rf"^{re.escape(key)}:\s*(.+?)\s*$", text, re.MULTILINE)
    if not match:
        return None
    value = match.group(1).strip()
    if value.startswith("#"):
        return None
    return value.split(" #", 1)[0].strip().strip("\"'")


def handoff_valid(path: Path, node_id: str, workflow_id: str) -> tuple[bool, list[str]]:
    if not path.is_file():
        return False, ["handoff file is missing"]
    text = path.read_text(encoding="utf-8", errors="replace")
    errors = []
    for key in ["workflow_id", "agent_id", "status", "summary", "next_action", "authorization_used"]:
        if not scalar(text, key):
            errors.append(f"missing {key}")
    if scalar(text, "workflow_id") != workflow_id:
        errors.append("workflow_id does not match")
    if scalar(text, "agent_id") != node_id:
        errors.append("agent_id does not match registered node")
    if not re.search(r"^evidence:\s*$", text, re.MULTILINE):
        errors.append("evidence section is missing")
    if scalar(text, "status") == "completed" and not re.search(r"^\s*-\s+path:", text, re.MULTILINE):
        errors.append("completed handoff has no evidence or artifact path")
    return not errors, errors


def load_state(root: Path, workflow_id: str) -> tuple[Path, Path, dict] | None:
    directory = root / ".agentic" / "workflows" / workflow_id
    state_path = directory / "WORKFLOW.json"
    if not state_path.is_file():
        return None
    return directory, state_path, json.loads(state_path.read_text(encoding="utf-8"))


def evaluate_workflow(state: dict, directory: Path) -> tuple[list[str], list[dict]]:
    """Score every node against its handoff and set state["status"] accordingly.
    Shared by validate and close so the two can never disagree about whether a
    workflow is finished."""
    errors: list[str] = []
    results = []
    for node in state.get("nodes", []):
        handoff = directory / "handoffs" / f"{node['id']}.yml"
        if not node.get("available"):
            if node.get("required"):
                errors.append(f"required agent unavailable: {node['id']}")
                node["status"] = "blocked"
            else:
                node["status"] = "skipped_optional"
            results.append({"agent_id": node["id"], "valid": False, "reasons": [node["status"]]})
            continue
        valid, reasons = handoff_valid(handoff, node["id"], state["workflow_id"])
        if valid:
            node["status"] = "completed"
        else:
            node["status"] = "blocked" if node.get("required") else "partial"
            if node.get("required"):
                errors.extend(f"{node['id']}: {reason}" for reason in reasons)
        results.append({"agent_id": node["id"], "valid": valid, "reasons": reasons})
    required = [node for node in state.get("nodes", []) if node.get("required")]
    if errors:
        state["status"] = "blocked"
    elif required and all(node.get("status") == "completed" for node in required):
        state["status"] = "completed"
    else:
        state["status"] = "partial"
    state["updated_at"] = now()
    # Report skipped nodes alongside the errors. A workflow whose agents are all
    # absent validates with zero errors and exits 0, which reads as "everything
    # ran" -- it means the opposite. Naming them makes an empty run visible.
    skipped = [node["id"] for node in state.get("nodes", []) if node.get("status") == "skipped_optional"]
    state["validation"] = {
        "validated_at": now(),
        "errors": errors,
        "skipped": skipped,
        "completed": sum(1 for node in required if node.get("status") == "completed"),
        "required": len(required),
        "results": results,
    }
    return errors, results


def validate_workflow(args: argparse.Namespace, root: Path) -> int:
    loaded = load_state(root, args.workflow)
    if loaded is None:
        print(f"workflow not found: {args.workflow}", file=sys.stderr)
        return 2
    directory, state_path, state = loaded
    errors, _ = evaluate_workflow(state, directory)
    if not args.check:
        state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(dict(state["validation"], workflow_status=state["status"]), indent=2))
    return 0 if not errors else 1


def close_workflow(args: argparse.Namespace, root: Path) -> int:
    """End a workflow and release the Stop guard, honestly.

    A clean validation closes it "completed". Anything else closes only under
    --abandon, which records "abandoned" together with the errors still open.
    There is deliberately no path here that writes "completed" over a missing
    handoff. That state is what an operator produces by hand when the tool
    offers no exit, and it makes the audit trail assert work that never ran.
    """
    loaded = load_state(root, args.workflow)
    if loaded is None:
        print(f"workflow not found: {args.workflow}", file=sys.stderr)
        return 2
    directory, state_path, state = loaded
    errors, _ = evaluate_workflow(state, directory)
    if errors and not args.abandon:
        print(json.dumps({
            "workflow_id": state["workflow_id"],
            "closed": False,
            "status": state["status"],
            "errors": errors,
            "hint": "run the outstanding agents, or record the truth with --abandon",
        }, indent=2), file=sys.stderr)
        return 1
    # `completed` has to mean work actually ran (T-741).
    #
    # evaluate_workflow already refuses to call an empty required-set
    # "completed" -- `elif required and all(...)` falls through to "partial".
    # This line used to overwrite that with a bare `errors else "completed"`,
    # so a workflow whose every node was skipped_optional closed as completed:
    # an audit trail asserting work that never happened, which the module
    # docstring says this tool exists to prevent. The CI smoke test asserted
    # that behaviour, so it was pinned rather than accidental.
    validation = state.get("validation") or {}
    nothing_ran = validation.get("completed", 0) == 0
    if errors:
        state["status"] = "abandoned"
    elif nothing_ran or validation.get("skipped"):
        # Distinct from "abandoned", which means outstanding errors. This is a
        # workflow that closed cleanly having done nothing -- worth its own
        # word so a reader is not left inferring it from a zero count.
        state["status"] = "empty"
    else:
        state["status"] = "completed"
    state["closed_at"] = now()
    state["closed_reason"] = args.reason
    if errors:
        state["outstanding_at_close"] = errors
    state["updated_at"] = now()
    state_path.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
    active = root / ".agentic" / "active-workflow.json"
    if active.is_file():
        try:
            pointer = json.loads(active.read_text(encoding="utf-8")).get("workflow_id")
            if pointer == state["workflow_id"]:
                active.unlink()
        except (OSError, json.JSONDecodeError):
            # An unreadable or malformed pointer is already the outcome this
            # block wants: nothing valid points at the workflow being closed,
            # so there is no stale pointer left to clear.
            pass
    print(json.dumps({
        "workflow_id": state["workflow_id"],
        "closed": True,
        "status": state["status"],
        "reason": args.reason,
        "outstanding": errors,
    }, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=None, help="repository root (default: CLAUDE_PROJECT_DIR, then git toplevel, then cwd)")
    sub = parser.add_subparsers(dest="command", required=True)
    registry_parser = sub.add_parser("registry", help="regenerate agent-registry.yml from installed agents")
    registry_parser.add_argument("--no-user", action="store_true", help="ignore the user-scope ~/.claude/agents")
    discover_parser = sub.add_parser("discover")
    discover_parser.add_argument("--out", default=".agentic/discovery.json")
    discover_parser.add_argument("--no-user", action="store_true")
    init_parser = sub.add_parser("init")
    init_parser.add_argument("--mode", choices=["one", "selected", "all"], required=True)
    init_parser.add_argument("--agents", default="")
    init_parser.add_argument("--optional-agents", default="", help="named agents that may be skipped when unavailable")
    init_parser.add_argument("--workflow-id")
    init_parser.add_argument("--objective", required=True)
    init_parser.add_argument("--max-parallel", type=int, default=3)
    init_parser.add_argument("--require-all", action="store_true", help="in all mode, block when any registry agent is unavailable")
    init_parser.add_argument("--enforce-stop", action="store_true", help="opt in: let the Stop hook block session end until required handoffs validate")
    init_parser.add_argument("--no-user", action="store_true")
    init_parser.add_argument("--force", action="store_true", help="open a new workflow even if an armed one is still active")
    validate_parser = sub.add_parser("validate")
    validate_parser.add_argument("--workflow", required=True)
    validate_parser.add_argument("--check", action="store_true", help="read-only: report without rewriting WORKFLOW.json")
    close_parser = sub.add_parser("close", help="end a workflow and release the Stop guard")
    close_parser.add_argument("--workflow", required=True)
    close_parser.add_argument("--reason", required=True, help="why it is being closed; recorded in WORKFLOW.json")
    close_parser.add_argument("--abandon", action="store_true", help="close as abandoned when required handoffs are still missing")
    status_parser = sub.add_parser("status")
    status_parser.add_argument("--workflow", required=True)
    args = parser.parse_args()
    root = project_dir(args.root)
    if args.command == "registry":
        return write_registry(root, include_user=not args.no_user)
    if args.command == "discover":
        result = run_discovery(root, include_user=not args.no_user, out=args.out)
        print(json.dumps(result, indent=2))
        return 0
    if args.command == "init":
        return init_workflow(args, root)
    if args.command == "validate":
        return validate_workflow(args, root)
    if args.command == "close":
        return close_workflow(args, root)
    state_path = root / ".agentic" / "workflows" / args.workflow / "WORKFLOW.json"
    if not state_path.is_file():
        print(f"workflow not found: {args.workflow}", file=sys.stderr)
        return 2
    print(state_path.read_text(encoding="utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
