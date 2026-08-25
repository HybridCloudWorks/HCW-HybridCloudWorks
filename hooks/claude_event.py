#!/usr/bin/env python3
"""Claude Code lifecycle hook: local audit records plus an opt-in Stop completion guard.

Fail-open by design: any missing file, unreadable state, or absent validator
results in exit 0 (allow). The hook can only block a Stop when ALL of these
are true: an active workflow exists, that workflow set enforce_stop=true at
init (--enforce-stop), the validator script exists, and validation fails.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def resolve_root(event: dict) -> Path:
    """Resolve the repository root in the same order as tooling/workflow.py, so the
    hook and the validator can never disagree about where .agentic/ lives.
    CLAUDE_PROJECT_DIR beats cwd: a session started in a subdirectory must not
    audit into that subdirectory and then fail open on a state file it cannot see.
    """
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
        pass
    cwd = event.get("cwd")
    return Path(cwd).resolve() if cwd else Path.cwd().resolve()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--event", required=True)
    args = parser.parse_args()
    raw = sys.stdin.read()
    try:
        event = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        event = {"raw_input_invalid": True, "raw_input": raw[:1000]}
    root = resolve_root(event)
    try:
        audit = root / ".agentic" / "audit"
        audit.mkdir(parents=True, exist_ok=True)
        record = {"recorded_at": datetime.now(timezone.utc).isoformat(), "event_argument": args.event, "event": event}
        with (audit / "claude-events.jsonl").open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, sort_keys=True) + "\n")
    except OSError:
        pass  # auditing is best-effort; never break the session over a log line
    if args.event != "Stop":
        return 0
    if event.get("stop_hook_active"):
        return 0
    active = root / ".agentic" / "active-workflow.json"
    if not active.is_file():
        return 0
    try:
        active_data = json.loads(active.read_text(encoding="utf-8"))
        workflow_id = active_data["workflow_id"]
        state_path = root / ".agentic" / "workflows" / workflow_id / "WORKFLOW.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, KeyError, json.JSONDecodeError):
        return 0
    # "abandoned" releases the guard exactly like "completed" does. Only
    # `workflow.py close` writes either, and it will not write "completed" over a
    # missing handoff -- so an operator who must end the session leaves an honest
    # record instead of hand-editing the status, which is what used to happen.
    if not state.get("enforce_stop", False) or state.get("status") in ("completed", "abandoned"):
        return 0
    validator = root / "tooling" / "workflow.py"
    if not validator.is_file():
        return 0  # fail open: a mislocated install must never trap the session
    try:
        result = subprocess.run(
            [sys.executable, str(validator), "--root", str(root), "validate", "--workflow", workflow_id, "--check"],
            capture_output=True, text=True, timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return 0
    if result.returncode == 0:
        return 0
    print(json.dumps({
        "decision": "block",
        "reason": (
            f"Workflow {workflow_id} is not complete. Run the outstanding subagents, then "
            f"'python tooling/workflow.py validate --workflow {workflow_id}'. To end the "
            f"session without them, close it on the record: 'python tooling/workflow.py "
            f"close --workflow {workflow_id} --reason <why> --abandon'."
        ),
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
