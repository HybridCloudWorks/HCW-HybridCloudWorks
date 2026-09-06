# TODO 2.0 — HybridCloudWorks Platform Roadmap

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


> Generated 2026-06-11 from a full code, security, theming, and admin-portal review.
> Supersedes nothing in `TODO.md` (active DB-convergence work continues there); this file tracks the next major platform iteration.
>
> **Reference design:** "Hyoga — Modern Tech Company Website" (dark luxe template). Rule of the refactor: adopt the Hyoga layout/typography/spacing/look-and-feel, but **every provider keeps its existing color theme** — the provider's `--primary`/accent tokens occupy the slot the template uses for its copper accent.

---

## ✅ Shipped in v1.5.0 (2026-06-11) — what remains open

Most of this roadmap shipped in release **v1.5.0** (see `CHANGELOG.md`). Still open:

- 🔑 **Publer API key rotation is MANUAL and still pending.** The `VITE_PUBLER_*` code fix shipped (M-2), but previously published bundles exposed the key — **rotate it in the Publer dashboard now.**
- ✅ **Secret Manager provisioning complete:** `LINKIE_API_KEY`, `KLAVIYO_PRIVATE_KEY`, and `KLAVIYO_LIST_ID` now sync from Notion through `secret-sync.yml` and were verified in Firebase Secret Manager on 2026-06-12.
- **Lab public-page wrappers** — the labs backend (Hostinger VPS agent + pull-based job queue), labs Cloud Functions, and admin Labs dashboard shipped; the public `LabRunner` embeds on provider pages are not yet built (P5).
- **P4 remainder** — AI content profiling on submit, unified image workflow, content versioning, rejection recovery UX, `EditorListPage`, calendar drag-drop/bulk scheduling, deeper Publer/Credly/Sessionize/YouTube/Plaud integrations, Activity Log page, AI cost budget.
- **P6 innovations backlog** — entirely open (intentionally future work).

---

## P0 — Security (fix before anything else)

Source: full security review, 2026-06-11. Pattern for all three High fixes already exists in the same file (`fetchRssFeedsManual`, functions/index.js:1259 applies `applyAdminCors` + `requireAdminClaims`).

- [x] **H-1: `generatePostContent` unauthenticated + arbitrary-collection write** — `functions/index.js:4042-4108`. Any caller can run paid AI analysis and write `postContent` into ANY collection via Admin SDK (bypasses Firestore rules; denial-of-wallet on AI spend). Fix: `applyAdminCors` + `requireAdminClaims(req, res, 'editor')`, allowlist `collection` to `['content']`.
- [x] **H-2: `fetchBlogListingsManual` unauthenticated** — `functions/index.js:3825-3860`. Anonymous callers can burn Firecrawl quota and inject scraped docs. Fix: add the admin gate.
- [x] **H-3: `fetchPodcastFeedsManual` unauthenticated** — `functions/index.js:3556-3573`. Anonymous write trigger. Fix: add the admin gate.
- [x] **M-1: `refreshPlaudTokenNow` checks legacy `admin` claim** — `functions/index.js:4396`. Codebase migrated to `adminRole`; this callable is unusable by real admins and inconsistent with the hardened model. Fix: check `request.auth.token.adminRole`.
- [x] **M-2 (code fix shipped in v1.5.0 — ⚠️ KEY ROTATION STILL PENDING, MANUAL): `VITE_PUBLER_API_KEY` baked into browser bundle** — `.github/workflows/deploy-frontend.yml:65-66` + `.env.example`. Vestigial (runtime uses `publerProxy`), but the key ships in published JS. Fix: remove `VITE_PUBLER_*` from workflow env and `.env.example`; **rotate the Publer key** since prior bundles exposed it.
- [x] **M-3: `recordLegacyBlogsRead` stores attacker-controlled `details` unbounded** — `functions/cms-functions.js:3120-3160`. Cap `details` size/keys, whitelist source values.
- [x] **M-4: `ServiceDocsPage` regex highlighter → `dangerouslySetInnerHTML` without escaping** — `src/pages/admin/ServiceDocsPage.jsx:78-97`. HTML-escape before highlighting or run through DOMPurify (pattern exists in `BlogDetailTemplate.jsx`).
- [x] **L-1:** Hide "Bootstrap My Admin Access" button unless no admins exist — `src/pages/admin/AdminAuthGuard.jsx:359` (server side is already correct).
- [x] **L-2:** Raise `mcpProxy`/`syncMcpTools` from `viewer` to `editor`+ — `functions/index.js:4431,4523`.
- [x] **L-3:** Fix malformed literal-`\n` line in `.gitignore:96`.

**Already done well (keep these patterns):** default-deny Firestore/Storage rules, `adminRole` custom claims with revocation-checked tokens, Secret Manager for all API keys, SSRF allowlisting in `publerProxy`, strict CORS allowlists, CSP/HSTS headers, MFA on admin sign-in, DOMPurify on public templates, SOPS/age CI secrets.

---

## P1 — Complete the broken/missing public pages

- [x] **Re-enable all six provider landing pages.** Each of `src/pages/{aws,azure,gcp,finops,terraform,github}/LandingPage.jsx` short-circuits to `ComingSoonPage()` with a `// TODO: remove to re-enable` — the real page code is below the guard. Remove guards as part of the Hyoga restyle (P2) so they relaunch in the new design.
- [x] **Build public Coder Corner pages.** Data layer (`src/hooks/useCoderCornerData.js`), admin page, and submission form all exist — there are simply **no public routes**. Add a `ProviderCoderCornerDispatcher` in `src/App.jsx`, list + detail pages per provider, and `/:provider/coder-corner` + `/:slug` routes.
- [x] **FinOps Architecture page disabled** — remove the `ComingSoonPage` guard in `src/pages/finops/ArchitecturePage.jsx:40-41`.
- [x] **Education detail dead-ends** — `ProviderEducationDetailDispatcher` (src/App.jsx:425-437) only handles AWS/Azure; GCP routes to 404. Add GCP (and the new providers, below).
- [x] **Decide Terraform/GitHub coverage of Architecture & Frameworks** — currently 404s. Either add to the dispatchers or remove dead links pointing there.
- [x] **Fix `max-w-400`** in `src/pages/shared/HomePage.jsx:337` (not a valid Tailwind class — should be `max-w-4xl`/`max-w-6xl` or a configured value).
- [x] **Audit mobile grids** — many layouts use `lg:grid-cols-N` without an explicit `grid-cols-1` mobile base; sweep provider pages and templates.
- [x] **Contrast gate item from TODO.md:** replace `dark:text-slate-500` on `bg-background` (3.98:1, fails gate) with `dark:text-slate-400`.

---

## P2 — UI/UX refactor to the Hyoga look (provider themes preserved)

### Design language to adopt
- Near-black charcoal base with a subtle warm ambient glow wash; generous negative space; full-bleed hero sections.
- One accent color per context for CTAs, stat numbers, bullet dots, thin connector lines → **this slot is filled by the existing provider token (`--primary`/`--slate-blue`)**, never a new palette.
- Large light-weight two-line display headlines; small uppercase eyebrow labels ("BUILD. INNOVATE. ELEVATE." style); numbered section markers (01, 02…); muted gray body text.
- Components: pill CTA buttons with accent fill, glassy stat blocks ("Global Reach 35+"-style), avatar/social-proof clusters, dark cards with circular icon chips, testimonial cards, logo marquee strip, abstract 3D/glow hero art.
- Minimal nav: logo left, centered links, CTA right.

### Phase 2a — Tokenize the look-and-feel (prerequisite, from theming review)
The provider **colors** are already fully tokenized (`src/index.css` `.theme-{provider}` CSS variables + Tailwind `@theme inline`), so accent-swapping works today. What is NOT tokenized must be, or the restyle is a 500-classname hunt:

- [x] Consolidate five glass classes (`.glass-card`, `.glass-panel`, `.dashboard-card`, `.glass-button`, `.certification-technical-card`, `src/index.css:635-815`) into one `.glass` base with variable-driven variants (`--glass-opacity`, `--glass-blur`).
- [x] Collapse ~530 lines of duplicated per-provider link/hover rules (`src/index.css:949-1479`) into single parameterized rules using `--slate-blue`/`--accent-dark`.
- [x] Parameterize header/footer backgrounds — replace hardcoded per-theme hexes (`#f0f9ffcc`, `#fff4e0cc`, …) with `--header-bg`/`--header-blur` set per `.theme-{provider}`.
- [x] Parameterize glows — replace `.orange-glow`, `.glow-effect-green`, etc. with one glow utility driven by `--primary-rgb` + `--glow-opacity`.
- [x] Tokenize shadows (`--shadow-sm/md/lg`) and unify border-radius to Tailwind utilities.
- [x] Tokenize grid/mesh pattern backgrounds (`.bg-grid-pattern`, `.hero-mesh`, `.grid-bg`).

### Phase 2b — Restyle (after 2a, mostly token edits + layout work)
- [x] New dark-luxe base tokens in `:root`/`.dark` (charcoal background, warm glow wash) — provider `.theme-*` overrides untouched.
- [x] Rebuild `HomePage.jsx` to Hyoga structure: hero with display headline + stat blocks + avatar proof, numbered sections, logo marquee of provider/cert badges, testimonial-style cards for featured content.
- [x] Rebuild the six (→ eight) provider landing pages on a **single shared Hyoga landing template** parameterized by `useProviderConfig()` — eliminating per-provider page drift while accent = provider color.
- [x] Typography pass: light-weight display headings with responsive scale (`text-3xl sm:text-5xl lg:text-6xl` consistently), uppercase eyebrow component, numbered-section component.
- [x] Restyle Header/Footer to minimal Hyoga nav; keep provider font overrides (Segoe UI / Amazon Ember / Google Sans / Mona Sans).
- [x] Run the existing a11y pipeline after restyle: `npm run a11y:audit` + Playwright contrast gate (72 routes × 2 themes) — dark-luxe palettes are contrast-risky; the gate must stay green.

---

## P3 — New providers: VMware & Ansible

Providers are config-driven; no DB migration needed (`cloudProvider` accepts any string). ~15 new files + dispatcher edits.

### Shared steps (both providers)
- [x] Add `'vmware'`, `'ansible'` to `VALID_PROVIDERS` and add config objects (name, theme, RSS feeds, blogSource) in `src/context/ProviderContext.jsx`.
- [x] Add `.theme-vmware` and `.theme-ansible` token blocks in `src/index.css` (light + dark): suggested brand anchors — VMware `#717074`→ use VMware blue `#0091DA`/`#696566` family; Ansible red `#EE0000` (darkened for WCAG like other themes, e.g. `--primary` at ~32% lightness). Include `--primary-rgb`, `--accent-light/dark`, grays, header bg.
- [x] Add lazy imports + cases in all 8 dispatcher functions in `src/App.jsx`.
- [x] Update provider matrix in `documentation/frontend-pages-guide.md`; extend `scripts/validate-provider-pages.js` and route validation.
- [x] Add both to admin provider dropdowns, Image Gallery provider tags, Image Prompts page groups, and Quick Access Hubs on HomePage.

### VMware (cloud-provider pattern, like AWS/Azure/GCP)
- [x] `src/pages/vmware/`: `LandingPage`, `ArchitecturePage`, `FrameworksPage`, `BlogPage`, `EducationPage`, `PodcastPage`, `RssPage` — thin wrappers over shared templates with `provider="vmware"`.
- [x] RSS feeds: VMware/Broadcom blogs.

### Ansible (service-provider pattern, mimics Terraform)
- [x] `src/pages/ansible/`: `LandingPage`, `CodePage` (wired into `ProviderCodeDispatcher` like Terraform), `BlogPage`, `EducationPage`, `RssPage`; optional `ModulesPage` (Ansible Galaxy module explorer) as the analog of Terraform modules.
- [x] RSS feeds: Ansible/Red Hat blogs.

---

## P4 — Admin portal: smooth, guided publishing

The pipeline (Submit → Inspect → Queue → Editor → Publish → Calendar) works end-to-end but is fragmented. Priorities from the review:

### Guided posting flow
- [x] **Unified wizard/progress indicator** across SubmitUrlsPage → EditorPage → ReviewPage → PublishedPage — one persistent stepper showing where the item is and what's next (this is the single biggest "clunky" fix).
- [ ] **AI content profiling on submit** — auto-suggest content type ("this looks like an architecture doc") instead of manual selection in `SubmitUrlsPage.jsx`.
- [x] **Pre-publish validation checklist modal** — hero image present, body length, unique slug, provider/type set — with clear errors instead of silent publish failures.
- [ ] **Unified image workflow** — today hero gen lives on QueuePage (`altCoverImage`), gallery picking on PublishedPage, nothing in Editor. Consolidate into EditorPage with a single image picker/generator/reorder panel; add success toasts to drag-reorder.
- [ ] **Content versioning** — draft snapshots + restore points; unpublish currently destroys edits. Framework saves overwrite with no v1→v2 history.
- [ ] **Rejection recovery UX** — surface the 24h→7-day decay states with a one-click Restore section in QueuePage.
- [ ] **Finish `EditorListPage` stub** (`/admin/editor`).

### Calendar
- [x] Add time-of-day picker (currently date-only at midnight) and explicit timezone handling.
- [ ] Drag-drop affordances: drop-zone highlights, preview card, confirmation toast.
- [ ] Bulk scheduling (multi-select → schedule to date) and same-day cluster warnings.
- [ ] Make ownership clear: PublishedPage = scheduling source of truth; Calendar = visualization + adjust. Compose social posts directly from a calendar date.

### 3rd-party integrations
- [x] **Unified "Connections" admin page** — Publer, Plaud, Sessionize, Credly, YouTube in one place with Test Connection buttons, token expiry tracking, and rotation. Move the hard-coded Sessionize speaker ID (`c6yicoezls`) into admin settings.
- [x] **"Auto-post to Social" checkbox at publish** → pre-fills SocialHubPage compose (kills the current two-stop flow).
- [ ] Publer: retry on failed schedule, character counting per platform, confirm delete removes from Publer queue (not just Firestore); pull back engagement analytics.
- [ ] Credly: bulk import by Credly URL, periodic auto-sync, expiry email alerts.
- [ ] Sessionize: handle deleted-event re-sync, AI-prefill descriptions from event pages.
- [ ] YouTube: real OAuth (Data API v3) or remove the placeholder badge.
- [ ] Plaud: webhook/auto-pull for new recordings instead of manual sync; multi-speaker transcripts.
- [ ] **Activity Log page** — `recordAdminAudit()` already logs everything; build the UI to view who approved/rejected/published and when.
- [ ] AI Engine: monthly cost budget with alert threshold (TODO.md notes Vertex spend already exceeding projection); response caching to avoid regenerating identical drafts/images.
- [ ] Quality-of-life: global content search, auto-refreshing queue (live snapshot listener), keyboard shortcuts, toast confirmations everywhere.

---

## P5 — VPS-powered interactive labs (new capability)

Goal: "try it live" experiences on provider pages — e.g., **validate/plan Terraform code** on the Terraform hub, **dispatch a GitHub Actions workflow** on the GitHub hub, **run an Ansible playbook --check** on the Ansible hub.

### Architecture considerations
- [x] **Isolation is the whole game**: every lab run executes untrusted user input. Run each job in an ephemeral, network-restricted container (gVisor/Firecracker or at minimum rootless Docker with `--network none` where possible, read-only FS, CPU/memory/time limits, no host mounts).
- [x] **Broker, don't expose**: the site never talks to the VPS directly from the browser. Flow: frontend → Cloud Function (auth, rate-limit, input size caps) → job queue → VPS runner agent (pull-based, e.g. polls queue or uses a message broker) → results written back to Firestore → frontend subscribes. Pull-based means no inbound ports open on the VPS.
- [x] **Per-lab allowlists**: Terraform lab = `terraform fmt/validate/plan` only, with a null/local provider sandbox and `-refresh=false`; never `apply`, never real cloud creds on the runner. Ansible lab = `ansible-playbook --syntax-check/--check` against localhost or disposable containers. GitHub lab = dispatch a workflow in a **dedicated sandbox repo** via a fine-grained PAT scoped to that repo only.
- [x] **Quotas & abuse**: anonymous = N runs/day per IP + global concurrency cap; sign-in for more. Queue depth limits, max runtime (e.g. 60s), output size caps, profanity/secret-scan on shared snippets.
- [x] **Observability**: per-run audit doc (who, what, duration, exit code), runner health check surfaced in OpsHealthPage, auto-kill stuck containers.
- [x] **VPS hardening baseline**: SSH key-only + fail2ban, unattended upgrades, dedicated non-root runner user, egress firewall (allow only queue/Firestore endpoints + registry), disk quotas, log rotation.

### Build steps
- [x] Runner agent on VPS (small Go/Node daemon): claims job → spins container → streams output → reports result.
- [x] `labProxy` Cloud Function: validates payload (size, language, lab type), rate-limits, enqueues, returns job ID.
- [ ] Frontend `LabRunner` component: Monaco editor with provider-themed chrome, Run button, streaming/poll output pane, shareable result permalink. Embed per provider page.
- [x] Lab content model in Firestore (`labs` collection): starter code, expected outputs, difficulty — manageable from a new admin Labs page so labs go through the same review pipeline.
- [ ] Start with Terraform `validate` (lowest risk, no creds) → Ansible `--syntax-check` → GitHub workflow dispatch → later: graded challenges.

---

## P6 — Innovations / next-level ideas

- [ ] **Architecture diagram interactivity**: clickable SVG architecture designs with per-component annotations; "deploy this pattern" links to the matching lab.
- [ ] **Cert-prep mode**: pair the certifications data you already curate with spaced-repetition flashcards / practice questions per provider education hub.
- [ ] **AI site assistant**: "Ask HybridCloudWorks" chat grounded in your published content (you already run an AI router + embeddings-capable providers); scoped per provider hub with provider-themed UI.
- [ ] **Newsletter pipeline**: the reviewer-digest cron already aggregates; add a public-facing weekly digest (Buttondown/Resend) auto-drafted from the week's published content, human-approved in admin.
- [ ] **Engagement loop**: reading-time, view counts (you have telemetry plumbing), "related content" via embeddings, RSS/Atom feeds per provider hub.
- [ ] **Comparison engine**: the Tools section + multi-provider data is a natural fit for "Azure vs AWS vs GCP for X" interactive matrix pages — strong SEO play.
- [ ] **Performance**: pre-render public pages (vite-ssg or prerender at build) — content is mostly static post-publish; pairs with the existing `generate-public-data.cjs` snapshot pattern. Lighthouse CI config already exists (`.lighthouserc.json`).
- [ ] **PWA/offline** for the admin portal so triage works on mobile.
- [ ] **Public roadmap/changelog page** generated from CHANGELOG.md — fits the creator-brand transparency angle.
- [ ] **Speaking-events upgrade**: embed Sessionize sessions, post-event recap posts auto-drafted from Plaud recordings of the talk.

---

## Suggested sequencing

1. **P0 security** (hours, not days — fix pattern exists in-file; rotate Publer key).
2. **P2a tokenization** (enables everything visual).
3. **P2b restyle + P1 page re-enables together** (relaunch landing pages in the new design once, not twice).
4. **P3 VMware/Ansible** (cheap once the shared Hyoga landing template exists).
5. **P4 admin smoothing** (wizard + image unification + calendar first).
6. **P5 labs MVP** (Terraform validate only) → expand.
7. **P6 innovations** as ongoing.
