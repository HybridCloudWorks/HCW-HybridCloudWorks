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
- **Single-quote an `az` `@file` argument.** `@` starts PowerShell's splatting
  operator, so a bare `--role-definition @infra/roles/x.json` is read as a
  variable to expand rather than a literal, and `az` receives something that is
  not a path. It fails with `Failed to parse string as JSON` naming the file —
  an error about JSON for a problem that is entirely about quoting, which is
  why it costs a round trip. Write it as
  `--role-definition '@infra/roles/x.json'`. Cost one on 2026-08-30.
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
