<!--
Combined issue templates collected into one file for review.
This file preserves the exact contents of each original file (shown in fenced blocks).
It does not delete or modify the originals. If you'd like, I can replace them with this
single file or convert it to a different format — tell me how you'd like to proceed.
-->

# Combined Issue Templates

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## Original: config.yml (moved to `.github/templates/config.yml`)

```yaml
blank_issues_enabled: false
contact_links:
  - name: Questions / Discussion
    url: https://github.com/
    about: Start a discussion for general questions.
```

---

## Original: bug_report.md

```markdown
---
name: Bug report
title: 'bug: <short description>'
labels: [bug]
---

## Description

What happened and what did you expect?

## Steps to Reproduce

1.
2.
3.

## Environment

- Browser/OS:
- Commit/Tag:

## Logs / Screenshots

## Acceptance Criteria

- [ ] Repro included
- [ ] Fix verified
```

---

## Original: feature_request.md

```markdown
---
name: Feature request
title: 'feat: <short description>'
labels: [enhancement]
---

## Problem / Context

## Proposal

## Alternatives Considered

## Impact / Risks

## Acceptance Criteria

- [ ] Feature behind guard/flag if risky
- [ ] Docs updated
```

---

## Original: task.md

```markdown
---
name: Task
title: 'chore: <short description>'
labels: [task]
---

## Work Summary

## Deliverables

- [ ]

## Dependencies
```
