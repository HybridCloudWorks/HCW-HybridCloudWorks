# Orchestration

How the pack's 38 agents and ~1,050 skills get used together without stepping on each other.

The pack spans two families: the **FinOps agents** (cost analysis, the FinOps Framework
capabilities) and the **platform agents** (Azure, AWS, the security triad, Terraform, diagrams,
Docker, agentic workflows, Python). Routing covers both, and several workflows deliberately cross
the boundary — a secure cloud deployment hands its cost baseline to the FinOps pack, and an
offensive engagement hands its findings to the defensive and DFIR agents.

| Doc | Use it when |
|---|---|
| [`routing.md`](routing.md) | Deciding **which** specialist handles a request — includes disambiguation for the pairs that genuinely overlap |
| [`handoffs.md`](handoffs.md) | Passing work **between** agents — the contract each pair owes the next |
| [`workflows.md`](workflows.md) | The request needs **several** agents in sequence — seven named workflows with their gates |

## The short version

1. **Check the playbooks first.** A named failure pattern is a diagnosis; an agent is an
   investigation. Several requests resolve outright at
   [`../playbooks/README.md`](../playbooks/README.md).
2. **Route to one specialist.** [`routing.md`](routing.md) maps symptom → agent, and explains the
   near-misses (`allocation-policy-architect` vs `showback-chargeback-architect`,
   `focus-data-engineer` vs `cost-warehouse-modeler`, and the rest).
3. **If it needs several, use a named workflow.** [`workflows.md`](workflows.md) — don't improvise
   a sequence for cost-spike investigation or a chargeback rollout; the gates exist because
   skipping them has a known failure mode.
4. **Carry the handoff envelope between steps.** [`handoffs.md`](handoffs.md). State the cost
   column every time — it is the most common source of confident, invisible, downstream error.

## Adding an agent

1. Create `../agents/<name>.md` with frontmatter: `name`, `description`, `tools`, and the `fcp_*`
   fields (`fcp_domain`, `fcp_capability`, `fcp_phases`, personas, `fcp_maturity_entry`).
2. Reproduce the four closing sections every agent has: an Iron Triangle table, a maturity tier
   table, a data-in-the-path integration point, and doctrine pointers. See
   [`../doctrine/README.md`](../doctrine/README.md) for why each exists.
3. Add a thin trigger skill at `../skills/<name>/SKILL.md` pointing back at the agent. Depth lives
   in the agent; the skill is the trigger surface. Copy the shape of any existing thin skill.
4. Add a row to [`routing.md`](routing.md), and a disambiguation note if it sits near an existing
   agent.
5. If it introduces a handoff, add the contract to [`handoffs.md`](handoffs.md).

## Keeping it portable

Nothing in `.claude/` names a specific client, tenant, or account — that is deliberate, and it is
what lets this pack drop into another repository unchanged. Project-specific facts belong in the
repository's root `CLAUDE.md`.

If you find yourself wanting to write a tenant ID, a subscription name, or a client's name into an
agent, doctrine doc, or playbook: it goes in `CLAUDE.md` instead.
