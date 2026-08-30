# Working agreements

## Owner-facing instructions must be runnable, not descriptive

When telling the owner what to do next, give **commands they can paste**, not a
description of the goal. Specifically:

- **PowerShell by default.** The owner works at a `PS C:\Users\saulp\...` prompt.
  Write PowerShell: `$x = ...` assignment, no `$(...)` command substitution, no
  backtick line continuations pasted into anything but PowerShell.
- **If a command must be bash, say so on the line above it.** The owner also has
  Git Bash (`MINGW64`) open and switches between them. Two commands were lost on
  2026-08-30 to bash syntax pasted at a PowerShell prompt and to PowerShell
  backticks pasted into bash — both because the shell was assumed rather than
  stated.
- **Prefer one line.** A multi-line command is a continuation-character bug
  waiting to happen across two shells. Where a value must carry between
  commands, compute it rather than asking the owner to retype it — a
  hand-substituted placeholder produced `EmailAddressIsNotValid` on 2026-08-30.
- **Avoid `az --query` with brackets.** `[0]` and `[?...]` get re-parsed and
  fail with `] was unexpected at this time`. Use `-o json | ConvertFrom-Json`
  and filter in PowerShell.
- **Anything done in a browser needs the exact URL**, deep-linked to the page
  holding the setting — not "go to Settings and find X".

State what a successful result looks like, so the owner can tell a real failure
from a reporting failure without asking. That distinction has been the expensive
one: on 2026-08-30 the Azure portal reported a test as failed while the email
arrived, and a timer script reported 57,581 invocations where the query returned
two rows.
