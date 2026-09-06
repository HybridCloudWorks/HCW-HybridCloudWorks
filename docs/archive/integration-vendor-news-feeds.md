# INTEGRATION-VENDOR-NEWS-FEEDS

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** April 8, 2026 **Status:** Active **Purpose:** Reference for vendor RSS feeds and
blog scraping sources across 6 providers, including Firecrawl-based ingestion for non-RSS HTML
pages, AI enrichment workflows, and the News page content delivery system

---

## Overview

The News page (`/:provider/rss`) aggregates content from three sources per provider:

| Source               | % of Layout | Storage                 | Automation                                 | Approval          |
| -------------------- | ----------- | ----------------------- | ------------------------------------------ | ----------------- |
| **Curated Articles** | 50%         | Firestore `blogs`       | Firebase Scheduled Function + BuildShip AI | Manual via Rowy   |
| **RSS Feed Cache**   | 25%         | Firestore `rss_cache`   | Firebase Scheduled Function (every 2h)     | None (live cache) |
| **AI Insights**      | 25%         | Firestore `ai_insights` | BuildShip Weekly Workflow                  | Auto-generated    |

### Data Flow Architecture

```
                    ┌──────────────────────────┐
                    │  Official Vendor RSS Feeds │
                    │  (Azure, AWS, GCP, etc.)   │
                    └─────────┬────────────────┘
                              │
              Firebase Scheduled Function
              (fetchRssFeeds - every 2 hours)
                              │
              ┌───────────────┼───────────────┐
              │                               │
              ▼                               ▼
   ┌──────────────────┐            ┌──────────────────┐
   │  rss_cache        │            │  blogs            │
   │  (live feed data) │            │  (draft articles) │
   │  No approval      │            │  approvedForNews  │
   └───────┬──────────┘            │  = false          │
           │                        └───────┬──────────┘
           │                                │
           │                   BuildShip AI Enrichment
           │                   (Summary, Tags, Category)
           │                                │
           │                        ┌───────▼──────────┐
           │                        │  blogs            │
           │                        │  (enriched)       │
           │                        │  Approve in Rowy  │
           │                        └───────┬──────────┘
           │                                │
           │                      Manual approval
           │                      (approvedForNews=true)
           │                                │
           ▼                                ▼
   ┌──────────────────────────────────────────────┐
   │            React Frontend (NewsPage)          │
   │                                                │
   │  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
   │  │ 50%      │ │ 25%      │ │ 25%          │  │
   │  │ Articles │ │ RSS      │ │ AI Insights  │  │
   │  │ Bento    │ │ Timeline │ │ Panel        │  │
   │  └──────────┘ └──────────┘ └──────────────┘  │
   └──────────────────────────────────────────────┘
```

---

## RSS Feed Sources

Ingested by `fetchRssFeeds` (scheduled every 2 hours). Images are scraped from each article's
og:image and re-uploaded to Firebase Storage.

### Azure

| Feed Name                   | URL                                                                                         | Content Type                          |
| --------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------- |
| Azure Blog                  | `https://azure.microsoft.com/en-us/blog/feed/`                                              | Blog posts, announcements             |
| Azure Updates               | `https://azurecomcdn.azureedge.net/en-us/updates/feed/`                                     | Service updates, GA/Preview           |
| Microsoft Partner Blog      | `https://partner.microsoft.com/en-us/blog/feed/`                                            | Partner program news, CSP updates     |
| Microsoft Azure Updates API | `https://www.microsoft.com/releasecommunications/api/v2/azure/rss`                          | Official Azure release communications |
| Microsoft 365 Roadmap       | `https://www.microsoft.com/releasecommunications/api/v2/m365/rss`                           | M365 roadmap updates                  |
| Azure Migration Blog        | `https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=AzureMigrationBlog` | Azure migration guidance              |
| Azure Arc Blog              | `https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=AzureArcBlog`       | Azure Arc announcements               |
| Microsoft Foundry Blog      | `https://devblogs.microsoft.com/foundry/feed/`                                              | Microsoft AI Foundry news             |
| Azure Stackfeed             | `https://stackfeed.io/feed?provider=azure`                                                  | Curated Azure community content       |
| Microsoft Learn Skills Hub  | `https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=skills-hub-blog`    | Learning and certification content    |

### AWS

| Feed Name               | URL                                                       | Content Type                          |
| ----------------------- | --------------------------------------------------------- | ------------------------------------- |
| AWS Blog                | `https://aws.amazon.com/blogs/aws/feed/`                  | Blog posts, deep dives                |
| AWS What's New          | `https://aws.amazon.com/about-aws/whats-new/recent/feed/` | Service announcements                 |
| AWS APN Partner Network | `https://aws.amazon.com/blogs/apn/feed/`                  | Partner program news, specializations |
| AWS Stackfeed           | `https://stackfeed.io/feed?provider=aws`                  | Curated AWS community content         |

### GCP

| Feed Name             | URL                                                    | Content Type                            |
| --------------------- | ------------------------------------------------------ | --------------------------------------- |
| Google Cloud Blog     | `https://cloud.google.com/blog/feed`                   | Blog posts, product news                |
| GCP Release Notes     | `https://cloud.google.com/feeds/gcp-release-notes.xml` | Release notes, updates                  |
| Google Cloud Partners | `https://cloud.google.com/blog/topics/partners/feed`   | Partner ecosystem news, success stories |
| GCP Stackfeed         | `https://stackfeed.io/feed?provider=gcp`               | Curated GCP community content           |

### GitHub

| Feed Name               | URL                                                  | Content Type                      |
| ----------------------- | ---------------------------------------------------- | --------------------------------- |
| GitHub Blog             | `https://github.blog/feed/`                          | Blog posts, feature announcements |
| GitHub Changelog        | `https://github.blog/changelog/feed/`                | Changelog entries                 |
| GitHub Developer Skills | `https://github.blog/developer-skills/github/feed/`  | Developer skills and tutorials    |
| GitHub Copilot          | `https://github.blog/ai-and-ml/github-copilot/feed/` | Copilot announcements and updates |

### Terraform

| Feed Name      | URL                                       | Content Type         |
| -------------- | ----------------------------------------- | -------------------- |
| HashiCorp Blog | `https://www.hashicorp.com/blog/feed.xml` | Blog posts, releases |

> **Note:** TF Weekly (`weekly.tf`) has no accessible RSS feed (returns 403). It is scraped via
> Firecrawl — see Blog Listing Sources below.

### FinOps

| Feed Name         | URL                            | Content Type                |
| ----------------- | ------------------------------ | --------------------------- |
| FinOps Foundation | `https://www.finops.org/feed/` | Framework updates, articles |

---

## Blog Listing Sources (Firecrawl)

Non-RSS HTML pages scraped by `fetchBlogListings` (scheduled every 6 hours). Uses Firecrawl to
extract article listings, then deduplicates and ingests into the `content` collection with
`source: 'firecrawl'`.

**Secret required:** `FIRECRAWL_API_KEY` (stored in Secret Manager)

### Azure

| Source Name                            | URL                                                               | Notes                         |
| -------------------------------------- | ----------------------------------------------------------------- | ----------------------------- |
| Microsoft Tech Community Blogs         | `https://techcommunity.microsoft.com/Blogs/`                      | Broad MS blog listing         |
| Microsoft Partner Center Announcements | `https://learn.microsoft.com/en-us/partner-center/announcements/` | Partner program announcements |
| Microsoft Partner Blog                 | `https://partner.microsoft.com/en-us/blog`                        | Partner blog homepage         |

### AWS

| Source Name     | URL                             | Notes                         |
| --------------- | ------------------------------- | ----------------------------- |
| AWS Blogs Index | `https://aws.amazon.com/blogs/` | All AWS blog categories index |

### GCP

| Source Name            | URL                                  | Notes                   |
| ---------------------- | ------------------------------------ | ----------------------- |
| Google Cloud Blog      | `https://cloud.google.com/blog/`     | Main GCP blog listing   |
| Google Developers Blog | `https://developers.googleblog.com/` | Developer-focused posts |
| Firebase Blog          | `https://firebase.blog/`             | Firebase product news   |

### FinOps

| Source Name               | URL                                                                  | Notes                  |
| ------------------------- | -------------------------------------------------------------------- | ---------------------- |
| Microsoft FinOps Blog     | `https://techcommunity.microsoft.com/category/azure/blog/finopsblog` | Azure FinOps category  |
| FinOps Foundation Updates | `https://www.finops.org/updates/all-updates/`                        | FinOps Foundation news |

### Terraform

| Source Name          | URL                                 | Notes                       |
| -------------------- | ----------------------------------- | --------------------------- |
| HashiCorp Blog       | `https://www.hashicorp.com/en/blog` | Full HashiCorp blog listing |
| TF Weekly Newsletter | `https://www.weekly.tf/`            | Weekly Terraform digest     |

---

## Firebase Functions

### `fetchRssFeeds` (Scheduled)

- **Schedule:** Every 2 hours
- **Region:** us-central1
- **Timeout:** 300 seconds
- **Memory:** 512MiB
- **File:** `functions/index.js`

**What it does:**

1. Iterates through all provider RSS feeds defined in `PROVIDER_FEEDS`
2. Parses each feed using `rss-parser` library
3. Caches the latest 20 items per feed in `rss_cache/{provider}_{feedName}`
4. Creates new entries in `content` collection for unique articles (dedup by `sourceUrl`)
5. New entries start with `approvedForNews: false`, `source: 'rss'`, `contentStatus: 'ingested'`
6. og:image is scraped from article URLs and re-uploaded to Firebase Storage via
   `generateCuratedArticleImage`

**Deduplication:** Checks `sourceUrl` across both `content` and `blogs` collections before creating.

**SSL Certificate Handling:** Some Microsoft feeds have certificate validation issues. The function
implements intelligent fallback:

- First attempt: Strict SSL validation (secure by default)
- If SSL error occurs: Falls back to relaxed validation with warning log
- Both attempts fail: Error logged, function continues to next feed

### `fetchRssFeedsManual` (HTTP)

- **Type:** HTTP trigger for manual/testing use
- **URL:** `https://us-central1-hybridcloudworks-61e8d.cloudfunctions.net/fetchRssFeedsManual`
- **Returns:** JSON with processing stats

### `fetchBlogListings` (Scheduled) — Firecrawl

- **Schedule:** Every 6 hours
- **Timeout:** 540 seconds
- **Memory:** 512MiB
- **File:** `functions/index.js`
- **Secret:** `FIRECRAWL_API_KEY`

**What it does:**

1. Iterates through all non-RSS HTML blog sources defined in `BLOG_SCRAPE_SOURCES`
2. Uses Firecrawl's structured extraction to pull article listings (title, URL, description, date,
   image)
3. Resolves relative article URLs to absolute
4. Deduplicates by `sourceUrl` across `content` and `blogs` collections
5. Ingests up to 20 articles per source with `source: 'firecrawl'`, `approvedForNews: false`,
   `contentStatus: 'ingested'`

### `fetchBlogListingsManual` (HTTP) — Firecrawl

- **Type:** HTTP trigger for manual/testing use
- **URL:** `https://us-central1-hybridcloudworks-61e8d.cloudfunctions.net/fetchBlogListingsManual`
- **Query params:** `?provider=azure|aws|gcp|github|terraform|finops` (optional filter)
- **Returns:** JSON with per-source article counts and error details

### `downloadBlogCoverImage` (Firestore Trigger)

- **Trigger:** `blogs/{blogId}` document write
- **Watches:** `contentImageUrl` field
- **Action:** Downloads image, uploads to Storage, sets `Cover Image` field
- **Storage Path:** `blogs/{blogId}/images/cover.{ext}`

---

## BuildShip Workflows

### AI Article Enrichment (Webhook)

**Purpose:** Enhance RSS-sourced blog entries with AI-generated summaries, tags, and categories.

**Trigger:** Called by `fetchRssFeeds` function or manual trigger from Rowy.

**Steps:**

1. Receive `{ sourceUrl, title, provider, blogId }` payload
2. **Web Scrape Node:** Fetch article content from sourceUrl
3. **AI Summarization Node:** Generate 2-3 sentence `aiSummary`
4. **AI Tagging Node:** Generate `aiTags` array and `category`
5. **Read Time Node:** Calculate `readTime` from word count
6. **Image Extraction Node:** Find or generate `contentImageUrl`
7. **Firestore Update Node:** Write enriched data back to `blogs/{blogId}`

**Configuration in BuildShip:**

- Create new workflow in BuildShip dashboard
- Add HTTP trigger node
- Chain AI nodes (use GPT-4o or Claude for summarization)
- Set Firestore update as final node
- Test with sample sourceUrl

### AI Insights Generator (Weekly Schedule)

**Purpose:** Generate provider-specific insight cards and weekly digests.

**Schedule:** Every Monday at 06:00 UTC

**Steps per provider:**

1. Fetch this week's RSS items from `rss_cache`
2. Use appropriate agents.md persona context:
   - Azure/AWS → GPCA (Google Cloud Professional Architect)
   - GCP → GDEF (Firebase Expert)
   - GitHub → GHE (GitHub Expert)
   - Terraform → CGOA (GitOps Architect)
   - FinOps → GPCA + FED
3. Generate weekly digest (insightType: 'weekly-digest')
4. Generate 2-4 trend/tip/comparison cards
5. Write to `ai_insights` collection with `active: true`

---

## Approval Workflow in Rowy

1. Open Rowy dashboard → `blogs` collection
2. Filter by `source = 'rss'` and `approvedForNews = false`
3. Review articles: check title, summary, and relevance
4. Set `approvedForNews = true` for articles to display on News page
5. Optionally edit `aiSummary`, `category`, or `Tags` for quality
6. Future: Set `approvedForBlog = true` for personal blog redistribution

---

## Ethical Guidelines

- **Rate Limiting:** RSS feeds are fetched every 2 hours (not more frequent)
- **User-Agent:** All requests include `HybridCloudWorks-Bot/1.0` identifier
- **robots.txt:** Respect vendor robots.txt rules
- **Attribution:** All articles link back to original source URL
- **No Content Copying:** Only summaries and metadata are stored, not full article text
- **Timeout:** 20-second timeout per feed to prevent blocking

---

## Error Handling

- **Feed unavailable:** Skipped, logged to Cloud Functions console, `rss_cache` retains previous
  data
- **Parse errors:** Individual feed errors don't block other feeds
- **Image download fails:** Article still displays with placeholder icon
- **BuildShip webhook fails:** Blog entry retains raw RSS data without AI enrichment
- **Firestore quota:** RSS cache limited to 20 items per feed, insights limited to 5 per provider

---

## Monitoring

- **Cloud Functions Logs:** `firebase functions:log --only fetchRssFeeds`
- **Manual Test:**
  `curl https://us-central1-hybridcloudworks-61e8d.cloudfunctions.net/fetchRssFeedsManual`
- **Firestore Console:** Check `rss_cache` and `blogs` collection sizes
- **BuildShip Dashboard:** Monitor webhook execution logs

---

## Future Enhancements

1. **Personal Blog AI Pipeline:** Extend BuildShip for blog authoring from notes/outlines
2. **Community Pulse:** Trending GitHub repos + Stack Overflow questions (Landing Pages)
3. **Provider Ecosystem Map:** Interactive visualization + events (Education Pages)
4. **Real-time subscriptions:** Firestore `onSnapshot` listeners for live updates
5. **Email digest:** Automated weekly email with top articles per provider
