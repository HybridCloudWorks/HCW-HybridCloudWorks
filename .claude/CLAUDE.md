# Working agreements

## Owner-facing instructions must be runnable, not descriptive

When telling the owner what to do next, give **commands they can paste**, not a
description of the goal. Specifically:

- **PowerShell by default.** The owner works at a `PS C:\Users\<you>\...`
  prompt. Write PowerShell: `$x = ...` assignment, no `$(...)` command
  substitution, no backtick line continuations pasted into anything but
  PowerShell.
- **If a command must be bash, say so on the line above it.** The owner also has
  Git Bash (`MINGW64`) open and switches between them. Two commands were lost on
  2026-08-30 to bash syntax pasted at a PowerShell prompt and to PowerShell
  backticks pasted into bash — both because the shell was assumed rather than
  stated.
- **Prefer one line.** A multi-line command is a continuation-character bug
  waiting to happen across two shells. Where a value must carry between
  commands, compute it rather than asking the owner to retype it.
- **Never leave a placeholder in a line meant to be pasted.** Not
  `THEACCOUNTNAME`, not `<your-id>`, not `THE_ADDRESS`. The rule is about
  commands, not about prose: naming a shape in a sentence — the
  `PS C:\Users\<you>\...` prompt above, or the `rg-<tier>-site-prod-cus`
  resource-group convention — describes the estate and is fine. A command is
  different, because it gets pasted exactly as written.

  Every name a command needs here is already known. `infra/variables.tf`
  carries the defaults — `stsiteprodcus01`, `func-site-prod-cus-01`,
  `kv-site-prod-cus-01` — and the resource groups in use are
  `rg-stor-site-prod-cus` (storage), `rg-web-site-prod-cus` (function app),
  `rg-sec-site-prod-cus` (Key Vault) and `rg-mgmt-plat-prod-cus` (Log
  Analytics and the action group, in the Management subscription). Look the
  value up and write it in.

  Twice on 2026-08-30 a placeholder shipped and was pasted verbatim:
  `THE_ADDRESS` produced `EmailAddressIsNotValid`, and `THEACCOUNTNAME`
  produced a DNS failure on `theaccountname.blob.core.windows.net`. Both cost
  a round trip, and in neither case did the error describe the thing being
  tested.
- **Prefer the control-plane `az` verb when one exists.** These two read the
  same container, and only the first works on Reader alone:

  ```powershell
  az storage container-rm show --storage-account stsiteprodcus01 -g rg-stor-site-prod-cus -n listenandlearn -o json | ConvertFrom-Json | Select-Object name, publicAccess
  ```

  ```powershell
  az storage container show --name listenandlearn --account-name stsiteprodcus01 --auth-mode login -o json | ConvertFrom-Json | Select-Object name
  ```

  The second is data-plane. It needs a Storage Blob Data role, and it resolves
  `stsiteprodcus01.blob.core.windows.net` — so a wrong account name fails at
  name resolution with `getaddrinfo failed`, before auth or the container is
  ever reached. That is how the `THEACCOUNTNAME` paste above disguised itself
  as a broken container.
- **If a command reads a repository file, say which branch it is on.** A
  command like `az role definition create --role-definition
  '@infra/roles/x.json'` works only if that file exists in the owner's working
  tree. When the file was added on an unmerged branch and the owner is on
  `main`, it does not — and `az` reports **`Failed to parse string as JSON`**
  naming the path, because a value that is neither valid JSON nor an existing
  file falls through to the JSON parser. The error describes the wrong subject
  entirely, which is the expensive kind.

  So pair any such command with the checkout that makes it runnable, or with a
  one-line existence check the owner can read before believing the error:

  ```powershell
  Test-Path infra/roles/static-web-app-deployer.json
  ```

  Cost two round trips on 2026-08-30. The first correction blamed PowerShell's
  splatting operator and prescribed single quotes; quoting was not the problem
  and the quoted form failed identically. Recorded that way because a
  confidently wrong rule in this file is worse than no rule.
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

## Pull requests open ready for review, not as drafts

Owner decision 2026-09-05. Every PR opened from a session was arriving as a
draft, and the owner had to flip each one to ready for review before merging
— a round trip that from a phone is the whole cost of the PR. GitHub has no
repository setting that forces this; it is chosen by whoever creates the PR,
so it is recorded here, where every session reads it.

- **Create the PR ready for review.** Copilot reviews either state, CI runs
  on either state, and nothing in this repository keys on draft.
- **Draft is the exception, and it is stated.** If a PR is opened before its
  own checks have been run locally, or it exists to hold a question rather
  than a change, say so in the first line of the description and open it as
  a draft. Otherwise not.
- **A Copilot review that recommends approval is the owner's "merge".** Owner
  decision 2026-09-05: Copilot code review has authority to approve PRs in
  this repository, so when its review of the **current head** recommends
  approval, a session merges without waiting for the owner to say so —
  provided every status check the repository ruleset requires (twelve today)
  is green on that head and no review thread is unresolved. Read the
  verdict, not the wording: Copilot's approval line has changed before (in
  this repository it has read `This pull request is ready to be approved.`),
  so key on a review that recommends approval and opens no review thread,
  never on an exact string. A review that recommends changes, or any review
  thread still unresolved on the head, is not that: fix, push, and wait for
  the next review of the new head. Ready for review on its own is still not
  permission to merge.
