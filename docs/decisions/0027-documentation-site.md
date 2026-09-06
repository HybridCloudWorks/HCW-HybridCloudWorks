# ADR 0027: Documentation is a MkDocs site under `docs/`, published to docs.hybridcloudworks.com

**Status:** Accepted
**Decision date:** 2026-09-05
**Owners:** Workload owner

## Context

Until 2026-09-06 the engineering record lived in the GitHub Wiki. Thirty-six
pages were staged in `wiki/` and overlaid onto the Wiki by a workflow after
each merge, which put them through pull-request review. The other 106 pages —
ADRs 0001–0017, the ADR template, the target architecture, the Well-Architected
assessment, the migration inventory and smoke-test records, and about eighty
Firebase-era guides — existed only in the Wiki repository, edited in the Wiki
UI, reviewed by nobody, and invisible to the repository's link and policy
checks. The two halves had also drifted: the staged copies were LF, the Wiki's
were CRLF, and the Wiki linked to pages the repository had renamed.

The Wiki had three further limits the owner wanted gone. It serves from
`github.com`, not from the site's own domain; it has no navigation beyond a
hand-kept sidebar and no search worth the name; and it is a separate git
repository, so `mkdocs build --strict`-style validation — a broken link fails
the build — cannot be applied to it.

Documentation for an engineering platform is also public-facing here: the
repository is public and the owner's position is that nothing secret belongs in
docs (sensitive operational detail lives in Notion). What the Wiki did *not*
enforce was the redaction posture that follows from being indexed on a real
domain: the cutover runbook carried real tenant and subscription identifiers,
and several archived guides carried a contributor's local file paths.

## Purpose and decision drivers

- One reviewed source for every page, including the ones that were only ever
  in the Wiki.
- Documentation on the site's own domain, with navigation and search.
- A build that fails on a broken link, a missing nav target or an unknown
  anchor, so a page cannot ship as a 404.
- A publication gate that fails on identifiers, local paths and links back to
  the retired Wiki, so redaction is a check rather than a memory.
- The smallest toolchain that gives the above: the repository already runs
  Python for its harness and Node for the site, and the pages are Markdown.

## Decision

- **Source:** `docs/` in this repository, arranged as `decisions/` (ADRs, this
  register), `runbooks/`, `standards/`, `architecture/`, `content/` (the blog
  machine's own documentation), `history/` (the Azure migration record,
  banner-marked as history) and `archive/` (the Firebase-era guides,
  banner-marked and indexed from their own page). `wiki/` is deleted.
- **Generator:** MkDocs with the Material theme, pinned in
  `scripts/docs/requirements.txt`, configured in `mkdocs.yml` at the root with
  `strict: true` and link, anchor and nav validation at warning level — which
  strict mode turns into a failed build.
- **Root documents stay at the root.** `README.md`, `CHANGELOG.md` and
  `TODO.md` are required there by the repository-structure policy; a MkDocs
  hook (`scripts/docs/hooks.py`) publishes them inside the site as `repo/*` at
  build time, rewriting their repository-relative links, so nothing is copied
  by hand.
- **Publication:** `docs-pages.yml` builds on every pull request that touches
  the site's inputs and deploys to GitHub Pages through the `github-pages`
  environment with OIDC on merge to `main`. The Pages site uses the Actions
  build type; no branch is published.
- **Host name:** `docs.hybridcloudworks.com`, a Cloudflare CNAME managed by
  Terraform (`cloudflare_dns_record.docs_pages`, DNS-only so GitHub can issue
  and renew the certificate; HTTPS is enforced). The apex stays with the
  Static Web App.
- **Gate:** `scripts/docs/check_redaction.py` runs before the build and fails
  on any link to the GitHub Wiki, any GUID that is not a
  `00000000-0000-0000-0000-0000000000NN` placeholder or an allowlisted
  Microsoft constant, and any contributor-local path.
- **The Wiki is retired, not deleted.** `retire-wiki.yml` overwrote all 141
  pages with a pointer to the page's new URL on 2026-09-06, driven by
  `scripts/docs/wiki-redirects.json`; the Wiki feature is switched off in
  repository settings after the stubs have been live for a week.
- **Policy:** `scripts/validate-repository-structure.ps1` sanctions `docs/` as
  the one home for narrative Markdown, allows `mkdocs.yml` at the root, and
  requires the README to name the docs site.

## Consequences and accepted risks

- Every page is now reviewed in a pull request and validated by the build;
  the Wiki's edit-in-place convenience is gone, deliberately.
- A broken link anywhere in 141 pages fails the docs check on the PR that
  introduced it. On the migration PR this found seven anchors the Wiki had
  been serving as dead links, and the redaction gate found sixteen real
  identifiers and four local paths.
- The ADR register keeps one historical number collision (0021, assigned
  twice before the numbering rule was written down); both records are kept
  and marked rather than renumbered, because renumbering would break every
  reference to either.
- The archive is large (80 Firebase-era pages) and is not curated; it is
  banner-marked as history and reachable only from its index. Pruning it is
  a separate decision.
- The Pages site is public. That is the existing state of the repository and
  the Wiki, not a widening, but the redaction gate is what makes it safe to
  keep saying so.
- A documentation-only change now runs the `Docs site` check in addition to
  the repository-policy check; the build takes under ten seconds.

## Alternatives considered

- **Keep the Wiki and add tooling around it.** Rejected: the Wiki is a
  separate repository that pull-request review and CI never see, so every
  gate above would have been advisory.
- **Docusaurus.** Fits the repository's Node side, but adds a second React
  application and a large dependency tree under `dependency-review` for a
  site whose content is Markdown that already existed.
- **Jekyll on the Pages branch build.** Zero tooling, but no strict link
  validation, weak navigation and search, and publishing from a branch
  rather than a reviewed workflow.
- **Serve documentation from the main site's Static Web App.** Rejected: it
  would couple documentation deploys to the product's release process and
  put engineering pages on the product's domain.

## Validation and revisit triggers

- Validated 2026-09-06: `mkdocs build --strict` and the redaction gate pass
  on `main` (144 files, 0 findings); https://docs.hybridcloudworks.com/
  serves with HTTPS enforced; 141 Wiki pages point at their new URLs.
- Revisit if the archive should be pruned or moved out of the site; if a
  second documentation audience (for example, public how-to content for the
  product) needs a different structure; or if GitHub Pages limits (1 GB site,
  soft 100 GB/month bandwidth) are approached.

## Related decisions and references

- [ADR 0026](0026-required-checks-filter-inside-the-job.md) — why the docs
  check is a separate workflow rather than a row in `ci.yml`.
- [Repository README](../repo/readme.md) and the repository-structure policy
  in `scripts/validate-repository-structure.ps1`.
- Issue #360 (the migration), PR #363 (the change), PR #364 (the Home-page
  stub fix), and the CHANGELOG entries for both.
