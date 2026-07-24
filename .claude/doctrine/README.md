# Doctrine

Four principles plus a citation anchor set. Every agent in `../agents/` assumes these; every
skill in `../skills/` is allowed to cite them without re-explaining them.

Doctrine is **project-neutral on purpose**. Nothing here names a client, a tenant, or a specific
cloud account. Project-specific facts belong in the repo's root `CLAUDE.md`, not here — that
separation is what lets this pack drop into any repo unchanged.

| Doc | Answers |
|---|---|
| [`focus-essentials.md`](focus-essentials.md) | Which FOCUS column answers this question — and which one silently gives the wrong answer |
| [`iron-triangle.md`](iron-triangle.md) | What does this saving cost in speed, quality, or carbon |
| [`data-in-the-path.md`](data-in-the-path.md) | Where does this output land in someone's existing workflow |
| [`crawl-walk-run.md`](crawl-walk-run.md) | What is the next notch of maturity for *this* capability |
| [`fcp-anchors.md`](fcp-anchors.md) | Whose named story or framing makes this credible to a stakeholder |

## How agents use doctrine

Agents cite doctrine by relative link (`../doctrine/iron-triangle.md`). The four principles map
onto four recurring failure modes, and each agent's closing sections exist to force the check:

1. A **FOCUS Essentials** pointer, because the wrong cost column is the most common way a
   confident analysis is simply wrong.
2. An **Iron Triangle** table, because a recommendation with no stated trade-off gets rejected
   on second-order effects the first time someone senior reads it.
3. A **Data in the Path** integration point, because an unopened report has zero value regardless
   of its accuracy.
4. A **maturity tier** table, because advice pitched at the wrong maturity is rejected as either
   patronizing or impossible.

If you are writing a new agent, reproduce all four sections. The orchestration router
(`../orchestration/routing.md`) assumes they exist.
