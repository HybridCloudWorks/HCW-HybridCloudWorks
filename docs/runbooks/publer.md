# Publer — REST proxy and MCP server

> **Status: MCP registration possible from this change; nothing has been
> published, scheduled or created on Publer by it.** The readiness check
> below is dated 2026-10-07. Publer reaches this platform two ways: the
> REST proxy and calendar timer the Social Hub has used since the port, and,
> from this change, Publer's own MCP server, registered in the AI Engine.
> Both use the same key, `PUBLER_API_KEY`.

## The two paths

| | REST (Social Hub, calendar sync) | MCP (AI Engine) |
| --- | --- | --- |
| Endpoint | `https://app.publer.com/api/v1` | `https://mcp.publer.com` |
| Caller | `publerProxy` (`functions/src/functions/integrations-http.js`) and `syncSocialCalendarScheduled` (`functions/src/lib/timers/publer-sync.js`) | `syncMcpTools` and `mcpProxy` (`functions/src/lib/ai/mcp.js`) |
| Key header | `Authorization: Bearer-API` followed by the key | `Authorization: Bearer` followed by the key |
| Workspace | `Publer-Workspace-Id` header from `PUBLER_WORKSPACE_ID` | Chosen through the tools (`select_publer_workspace`); one workspace locks itself. No header. |
| Policy | `assertSafePath` denylist; no path allowlist (estate review finding AP-B3) | `PUBLER_API_KEY` bound to `mcp.publer.com` only, no query string on that host, and a required tool allowlist (`allowedTools`, #995) enforced on every call (`functions/src/lib/ai/mcp-policy.js`) |
| Who can call | editor | Sync and calls to allowed tools: editor. Registering, changing the URL, key name or `allowedTools`, and switching the server on or off: super_admin |

Two Publer behaviours that this repository measured and that its own
documentation states the other way round:

- **401 means the workspace id is wrong, 403 means the key is** (#358,
  measured 2026-09-09). The Keys tab has a light for each, and
  `publerSettingForStatus` decides which one a refusal turns red.
- **The MCP server takes a plain `Bearer` key.** Publer's settings page
  shows `Authorization: Bearer-API`, but the server's own missing-key error
  says `Use ?api_key=YOUR_KEY (or Authorization: Bearer YOUR_KEY)`. The
  AI Engine's resolver sends `Bearer`, and on 2026-10-07 a Sync through it
  reached the tool list, so no Publer-specific header code was needed.

## Readiness check, 2026-10-07

Read-only throughout. Publer's MCP server was reached with a dummy key for
`initialize` and `tools/list`, which are protocol metadata, and for one
`get_publer_user` call, which is annotated read-only and was refused for the
dummy key. No real key was used and nothing was written to Publer.

| Item | State |
| --- | --- |
| `PUBLER_API_KEY` present server-side | **Needs owner action:** open the Keys tab and confirm the `Publer — API key` light is green. The setting is a Key Vault reference in `infra/functionapp.tf` (`PUBLER-API-KEY`). The light is set by the REST proxy and the calendar timer: a 403 turns it red, any success clears it, and nothing turns it green until one of them has called Publer. The MCP path does not report to this light. |
| `PUBLER_WORKSPACE_ID` | **Ready for MCP**, which does not use it. For the REST path it is the `Publer — workspace id` light on the same tab; a 401 turns it red. |
| REST proxy probe | **Ready.** The Publer card's Test button on Integrations → Services posts `{ path: '/accounts', method: 'GET' }` to `publerProxy`, which calls `GET https://app.publer.com/api/v1/accounts`. Good: `Connected — N social account(s).` AP-B3 (no path allowlist on `publerProxy`) is still open and is not changed here. |
| MCP server URL and auth | **Ready.** `https://mcp.publer.com`, Streamable HTTP: JSON-RPC over POST, replies framed as server-sent events, sessions by `mcp-session-id`, protocol `2024-11-05`, server `Publer Copilot MCP` 0.5.4. Key as `Authorization: Bearer` (accepted) or `Bearer-API` (documented). The `?api_key=` form Publer also accepts is refused here. |
| `PUBLER_API_KEY` allowed as an MCP key | **Needs code: this change.** Before it, `validateMcpApiKeyEnvVar` refused `PUBLER_API_KEY` at save and at call time. It is now on the list and bound to `mcp.publer.com` as its only host; every other host, `app.publer.com` included, is refused. |
| Write tools out of reach | **Needs code: this change (#995).** A server using `PUBLER_API_KEY` cannot be saved, and cannot be called, without a non-empty `allowedTools`. The API refuses a tool outside the list with 403 before any request leaves, for every role and for platform jobs alike. The seed's list is the 34 read and session tools. |
| Admin UI can register it at super_admin | **Needs code: this change, then owner action.** A disabled `Publer MCP` entry (`publer-mcp`) is now in the AI Engine seed. The seed writes it the first time a super_admin opens the MCP Servers tab. An editor-only account opening the AI Engine before that sees the seed error with a Retry button, because a new server needs super_admin. |
| Plan | **Needs owner action:** Publer offers MCP on Business and Enterprise (its help article also says Top Ambassadors on Enterprise, beta). A key on a plan without MCP is refused with `Invalid API key or not active for this account`. |
| Rate limit | Publer documents 100 requests per 2 minutes per user for its API. Nothing documents a separate MCP limit; assume MCP calls share it with the 5-minute calendar timer. |

## Publer MCP tools

`tools/list` on 2026-10-07 returned 47 tools. Read-only means the tool reads
Publer and changes nothing there; "session" means it changes only which
workspace, accounts, posts or media the MCP session has selected.

**Read-only — safe to call:**
`get_publer_user`, `list_publer_accounts`, `lookup_publer_accounts`,
`list_publer_posts`, `lookup_publer_posts`, `list_publer_drafts`,
`get_recent_posts`, `get_publer_job_status`, `get_post_insights`,
`get_hashtag_insights`, `get_hashtag_performing_posts`,
`get_best_times_to_post`, `list_analytics_charts`,
`get_analytics_chart_data`, `get_members_analytics`,
`analyze_recent_performance`, `list_competitors`,
`get_competitors_analytics`, `list_publer_media`, `lookup_publer_media`,
`list_media_options`, `generate_campaign_plan`, `search_publer_docs`,
`read_publer_docs_page`, `search_publer_help`, `read_publer_help_article`,
`load_publer_card_state`.

**Session only — no Publer data changes:**
`list_publer_workspaces`, `select_publer_workspace`,
`change_publer_workspace`, `select_publer_account`, `select_publer_posts`,
`select_publer_media`, `save_publer_card_state`.

**Write — do not call from the Playground:**

| Tool | What it does |
| --- | --- |
| `submit_publer_posts` | Creates posts. `when` is `draft` (the default), `schedule`, `now` (publishes immediately), `auto`, `recycle` or `recur`. |
| `publish_publer_draft` | Publishes an existing draft immediately. |
| `update_publer_post` | Edits a scheduled, draft or published post in place. |
| `reschedule_publer_post` | Moves a scheduled post or draft. |
| `change_publer_post_state` | Promotes a draft to scheduled, or back. |
| `confirm_delete_publer_posts` | Deletes posts permanently. |
| `delete_publer_posts` | Annotated read-only, and deletes nothing itself, but it opens the delete preview that `confirm_delete_publer_posts` completes, so it is out. |
| `create_publer_post_from_file`, `create_publer_photo_draft` | Create drafts with media. |
| `create_publer_ideas` | Saves content ideas. |
| `upload_publer_media_from_url`, `upload_publer_chat_media`, `upload_publer_media` | Add files to the media library. |

**None of these 13 is callable here.** The seeded server's `allowedTools`
names the 34 read and session tools above and nothing else, and `mcpProxy`
(and any platform job that calls an MCP tool) refuses every other tool with
403, naming the tool and the server, before any request reaches Publer,
whatever the caller's role. A super_admin is refused too unless the list
names the tool. The rules (#995, `mcp-policy.js` and
`admin-integrations/config-collections.js`):

- A server whose key is `PUBLER_API_KEY` must carry a non-empty
  `allowedTools`; saving one without it is refused, and a stored one
  without it refuses every call.
- Only a super_admin can write `allowedTools`, and only a super_admin can
  switch a `PUBLER_API_KEY` server on or off. An editor's write naming
  either is refused with 403. A full PUT that omits the list keeps the
  stored one.
- Sync stores the tool list Publer offers and never touches
  `allowedTools`, so a new Publer tool is not callable until a super_admin
  adds it.
- Firecrawl, Replicate, the VPS token and keyless servers have no list and
  behave as before: any tool name. A list, once given, is enforced.
- Every write records `allowedTools` before and after in the
  `ai_config_updated` audit row.

The card reads "34 of 47 tools allowed" once synced.

**A narrower key.** Publer keys carry scopes; Workspaces and Accounts are
required, and Posts, Media and Analytics are optional. The Social Hub needs
Posts, so `PUBLER_API_KEY` cannot be narrowed. A second key with Workspaces,
Accounts and Analytics only would make the write tools fail at Publer. It
would need its own setting, `MCP_PUBLER_API_KEY`, which needs a Terraform
app setting and a Key Vault secret, and an `MCP_*` key is not bound to a
host. Not done here.

## Register and verify (owner)

Everything here is read-only. Sign in to the admin as the owner (super_admin).

1. Open <https://hybridcloudworks.com/admin/integrations?tab=keys>. The
   `Publer — API key` light should be green. If it is not, press Test on the
   Publer card at <https://hybridcloudworks.com/admin/integrations?tab=services>
   first; `Connected — N social account(s).` is a pass.
2. Open <https://hybridcloudworks.com/admin/ai-engine?tab=mcp>. The page
   writes the `Publer MCP` card: switched off, status untested, URL
   `https://mcp.publer.com`.
3. On that card press **Sync Tools**. Good: the toast says `Tools synced`
   with about 47 tools and the status turns connected. **A sync succeeds
   even with a wrong key**, because Publer lists its tools without checking
   the key, so this proves the connection and the policy, not the key.
4. Switch the card on (super_admin only for this server). The
   Playground lists only enabled servers with synced tools. The card
   should read `34 of 47 tools allowed`.
5. Open <https://hybridcloudworks.com/admin/ai-engine?tab=playground>,
   choose **MCP Tool**, server `Publer MCP`, tool `get_publer_user`,
   arguments `{}`, and send. Good: your Publer name and plan. A refusal
   reading `PERMISSION_DENIED` with `Invalid API key or not active for this
   account` means the key is wrong or the plan has no MCP; the REST light on
   Keys stays as it was, because the MCP path does not report to it.
6. Optionally, tool `lookup_publer_accounts`, arguments `{}`. Good: the
   connected social accounts. If it answers `selection_required` with
   workspace names, the key read the workspaces and that is a pass too;
   choosing one is a session change only, and not needed for this check.
7. Switch the card off again until there is a use for it.

If the URL field ever shows `?api_key=`, it was not saved: the save is
refused with `must not carry a query string`. That refusal is the policy
working. Publer's "Server URL" is not the URL to paste; `https://mcp.publer.com`
is.

## Sources

- Publer, [How to set up and use Publer's MCP server](https://publer.com/help/en/article/how-to-set-up-and-use-publers-mcp-server-14orlq0/)
  (updated 2026-09-28): setup, scopes, plan, the Server URL and
  Authorization header screenshots.
- Publer, [API documentation](https://publer.com/docs): base URL, the
  `Bearer-API` scheme, `Publer-Workspace-Id`, 100 requests per 2 minutes.
- The server itself, 2026-10-07: `initialize` (server name, version,
  instructions, the missing-key error) and `tools/list` (names and
  `readOnlyHint` / `destructiveHint` annotations).
