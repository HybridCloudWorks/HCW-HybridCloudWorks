# Published pages audit — 2026-09-06

The first run of `frontend/scripts/audit-published-pages.mjs` (issue #361) against production: every URL in the live sitemap, in headless Chromium, one verdict each. The crawl re-runs weekly from `.github/workflows/audit-published-pages.yml`; this page is the dated record of what it found the first time and where each finding went.

- Base: `https://hybridcloudworks.com` · sitemap entries: **120** (2 duplicate, dropped) · URLs crawled: **118** · started 2026-09-06T05:32Z
- Verdicts: works **0**, empty **11**, defect **107**

## What "defect" mostly means here

One root cause accounts for almost all of it: every prerendered page ships a pending Suspense boundary, and the Content Security Policy blocks the two inline scripts React emits to complete it, so hydration reports error 419 on 107 of 118 pages (#370). Take that class away and the site has a handful of page-specific problems, each with its own issue below.

The live sitemap itself carried one URL three times (`/azure/blog/enable-ai-powered-discovery-of-azure-updates-with-microsoft-release-communicatio`); the crawler de-duplicates and reports the count, and the repeat is noted on #373 with the other sitemap hygiene items.

## Finding classes

| Class | Pages | Where it went |
| --- | ---: | --- |
| `console csp-inline-script` | 107 | #370 |
| `console react-hydration-419` | 107 | #370 |
| `thin main region` | 7 | #373 |
| `console network-failed` | 5 | #371 |
| `broken images` | 5 | #371 / #374 |
| `failed requests` | 4 | #371 |
| `empty-state copy` | 4 | by configuration |
| `console csp-other` | 2 | #370 |
| `media not served` | 2 | #372 |
| `title lacks provider name` | 1 | note |
| `og:title lacks provider name` | 1 | note |

## Child issues

- #370 — pending Suspense boundary in every prerender + CSP blocks the completion scripts (site-wide, P1)
- #371 — landing hero image sets missing for GCP, GitHub, Terraform, FinOps (P2)
- #372 — podcast rows with dead PodBean media still served (P2)
- #373 — six section pages render empty and sit in the sitemap; one sitemap URL repeated (P3)
- #374 — curated article bodies hotlink upstream images that no longer load (P3)

## Empty by configuration, not defects

- `/tools/migration`, `/tools/comparison`, `/tools/resources`, `/tools/decisions` — "Coming Soon" by design.
- `/aws/audio`, `/gcp/audio`, `/vmware/audio` — no podcast feed for those providers until #349.
- `/about` — the two `/data/*.json` snapshots 404 by an accepted decision (#175); the page falls back to the API. Recorded as a note, not a finding.

## Matrix

| Path | HTTP | Verdict | Findings |
| --- | ---: | --- | --- |
| `/` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/about` | 200 | defect | console csp-inline-script; console react-hydration-419; console network-failed; note: #175 data snapshot |
| `/contact` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/architecture-designs` | 200 | defect | console csp-inline-script; console react-hydration-419; title lacks provider name: "Architecture Designs \| Hybrid Cloud Works"; og:title lacks provider name: "Architecture Designs \| Hybrid Cloud Works" |
| `/azure/frameworks` | 200 | empty | thin main region: 284 chars |
| `/azure/coder-corner` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/education` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/audio-architecture` | 200 | defect | console csp-inline-script; console react-hydration-419; console csp-other; media not served: 404 |
| `/azure/audio` | 200 | defect | console csp-inline-script; console react-hydration-419; console csp-other; media not served: 404 |
| `/azure/news` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/rss` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/aws` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/aws/blog` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/aws/architecture-designs` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/aws/frameworks` | 200 | empty | thin main region: 280 chars |
| `/aws/coder-corner` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/aws/education` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/aws/audio-architecture` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/aws/audio` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/aws/news` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/aws/rss` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/gcp` | 200 | defect | console csp-inline-script; console network-failed; console react-hydration-419; failed requests: 7; broken images: 6 |
| `/gcp/blog` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/gcp/architecture-designs` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/gcp/frameworks` | 200 | empty | thin main region: 280 chars |
| `/gcp/coder-corner` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/gcp/education` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/gcp/audio-architecture` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/gcp/audio` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/gcp/news` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/gcp/rss` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/github` | 200 | defect | console csp-inline-script; console network-failed; console react-hydration-419; failed requests: 7; broken images: 6 |
| `/github/blog` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/github/code` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/github/coder-corner` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/github/education` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/github/audio-architecture` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/github/audio` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/github/news` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/github/rss` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/terraform` | 200 | defect | console csp-inline-script; console network-failed; console react-hydration-419; failed requests: 7; broken images: 6 |
| `/terraform/blog` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/terraform/code` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/terraform/coder-corner` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/terraform/education` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/terraform/audio-architecture` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/terraform/audio` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/terraform/news` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/terraform/rss` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/finops` | 200 | defect | console csp-inline-script; console network-failed; console react-hydration-419; failed requests: 7; broken images: 6 |
| `/finops/blog` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/finops/architecture-designs` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/finops/frameworks` | 200 | empty | thin main region: 286 chars |
| `/finops/coder-corner` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/finops/education` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/finops/audio-architecture` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/finops/audio` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/finops/news` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/finops/rss` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/vmware` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/vmware/blog` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/vmware/architecture-designs` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/vmware/frameworks` | 200 | empty | thin main region: 286 chars |
| `/vmware/coder-corner` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/vmware/education` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/vmware/audio-architecture` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/vmware/audio` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/vmware/news` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/vmware/rss` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/ansible` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/ansible/blog` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/ansible/code` | 200 | empty | thin main region: 169 chars |
| `/ansible/coder-corner` | 200 | empty | thin main region: 197 chars |
| `/ansible/education` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/ansible/audio-architecture` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/ansible/audio` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/ansible/news` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/ansible/rss` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/finops/tools` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/finops/focus` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/finops/architectures` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/terraform/modules` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/terraform/tools` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/github/workflows` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/github/tools` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/tools/migration` | 200 | empty | empty-state copy: Coming Soon \| Check back soon for updates. |
| `/tools/comparison` | 200 | empty | empty-state copy: Coming Soon \| Check back soon for updates. |
| `/tools/resources` | 200 | empty | empty-state copy: Coming Soon \| Check back soon for updates. |
| `/tools/decisions` | 200 | empty | empty-state copy: Coming Soon \| Check back soon for updates. |
| `/templates/framework` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/templates/architecture` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/templates/blog` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/templates/coder-corner` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/templates/rosetta-stone` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/azure-foundry-hosted-agents-accelerating-ai-agent-deployment-optimization-featur` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/enable-ai-powered-discovery-of-azure-updates-with-microsoft-release-communicatio` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/enterprise-hub-and-spoke-zero-trust-edge` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/operationalizing-azure-updates-with-microsoft-release-communications-and-proacti` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/autonomous-self-healing-for-azure-vmware-solution-private-clouds` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/microsoft-foundry-end-to-end-observability-and-roi-for-production-ai-agents` | 200 | defect | console csp-inline-script; console react-hydration-419; broken images: 2 |
| `/azure/blog/leveraging-ai-for-efficient-azure-update-discovery-with-microsoft-release-commun` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/unveiling-microsofts-secure-future-initiative-sfi-a-blueprint-for-next-generatio-91IWYg` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/unlocking-on-prem-genai-with-azure-arc-agentic-retrieval-in-foundry-local` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/discover-and-assess-file-shares-for-migration-to-azure-files-with-azure-migrate` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/new-microsoft-certified-azure-ai-fundamentals-certification` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/a-developers-guide-to-managing-models-cost-and-quality-in-microsoft-foundry` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/new-microsoft-certified-sql-ai-developer-associate-certification` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/announcing-the-new-microsoft-certified-azure-ai-apps-and-agents-developer-associ` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/leveraging-ai-powered-discovery-for-azure-updates-with-microsoft-release-communi` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/ansible-azure-arc-use-ansible-modules-to-deploy-and-manage-azure-arc-machine-ext` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/announcing-private-preview-deploy-ansible-playbooks-using-azure-policy-via-machi` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/automating-arc-enabled-sql-server-license-type-configuration-with-azure-policy` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/aws/blog/aws-transform-enhances-migration-assessments-with-new-agentic-capabilities-IVrBFJ` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/nist-vs-microsoft-zero-trust-why-cloud-architects-should-care-LSzyB6` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/microsoft-sovereign-cloud-unleashing-disconnected-operations-with-enhanced-gover-Ttt3Hv` | 200 | defect | console csp-inline-script; console react-hydration-419 |
| `/azure/blog/microsoft-sovereign-cloud-empowering-europe-with-unprecedented-data-control-and--ibDYCO` | 200 | defect | console csp-inline-script; console react-hydration-419 |
