# Streamlined Content Creator Pipeline

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 17, 2026
**Status:** Live & Tested ✅
**Model:** Google Gemini 2.0 Flash + Replicate Imagen-4
**New Features:** publishedDate Extraction, cloudProvider Override, skipImageGeneration ✨

## Overview

The HCW article pipeline automatically transforms URLs into fully-analyzed, AI-illustrated articles.
One click → content data (title, summary, topics, themes) + AI cover image. No external API
connectivity issues, no paid web scraping, all native Google services.

**New in v1.1:** Three powerful Stage 1 enhancements:

- **publishedDate Extraction** — Auto-extract publication date from article metadata
- **cloudProvider Override** — Manually set cloud provider before processing
- **skipImageGeneration** — Defer image generation for selective/batch processing

### What You Get

From one URL, the system automatically generates:

1. **Article Metadata** (extracted by Gemini AI)
   - Title (auto-slugified)
   - Summary (2-3 sentences)
   - Cloud Provider classification (Azure, AWS, GCP, GitHub, Terraform, FinOps, Multi)
   - Key Topics (3-5 technologies/concepts)
   - Target Audience (Cloud Architect, DevOps Engineer, etc.)
   - Visual Theme (illustration prompt)

2. **Content Archive** (full scraping)
   - Markdown version (stripped formatting, clean text)
   - HTML backup (original page structure)
   - Plain text version (for search/readability)
   - Word count
   - All images extracted and stored to Firebase Storage

3. **AI-Generated Cover Image**
   - Imagen-4 illustration (2K resolution, 16:9 aspect ratio)
   - Provider-themed colors and visual metaphors
   - Stored in Firebase Storage with public URL

4. **Audit Trail**
   - Gemini analysis prompt (saved for reproducibility)
   - Imagen-4 generation prompt (saved for reproducibility)
   - Analysis model used (gemini-2.0-flash)
   - Timestamps for each stage

---

## Architecture: Two-Stage Pipeline

### Stage 1: Content Inspection & Analysis (~10-15 seconds)

**Trigger:** `inspectTrigger: true` on blogs document

**Process:**

1. **Scrape:** Axios + Cheerio fetches URL, extracts main content
   - Removes noise (nav, footer, ads, comments)
   - Finds best content block using CSS selectors
   - Converts HTML → Markdown (via Turndown)
   - Extracts all images and archives to `articles/{blogId}/image-{n}.{ext}`

2. **Analyze:** Google Gemini 2.0 Flash reads content
   - Extracts structured metadata (title, summary, topics, etc.)
   - Classifies cloud provider context
   - Generates visual illustration prompt
   - **No API key needed** — uses Google Cloud service account auth

3. **Store:** Firestore receives complete data
   - All content versions (markdown, HTML, plain text)
   - Metadata and analysis prompts for audit trail
   - **Automatically triggers Stage 2** by setting `altCoverImageTrigger: true`
   - Generates URL-safe slug from title if not pre-set

### Stage 2: AI Cover Image Generation (~20-30 seconds)

**Trigger:** Auto-triggered after Stage 1 completes OR manual `altCoverImageTrigger: true`

**Process:**

1. **Build Prompt:** Uses metadata from Stage 1 to create contextual Imagen-4 prompt
   - Provider theme colors (Azure blue, AWS orange, etc.)
   - Key topics and visual metaphor
   - Lego-style collaboration aesthetic

2. **Generate:** Replicate API (Imagen-4)
   - 2K resolution, 16:9 aspect ratio
   - PNG format

3. **Store:** Firebase Storage
   - Public URL generated
   - Filename: `covers/{blogId}-ai.png`

4. **Update:** Firestore record
   - `altCoverImage` URL
   - `altCoverImagePrompt` used
   - `altCoverImageGeneratedAt` timestamp

---

## NEW: Three Stage 1 Enhancements (v1.1) ✨

### Feature 1: publishedDate Extraction

**What:** Automatically extracts article publication date and stores as `publishedAt` (date-only,
midnight UTC).

**Extract Order:**

1. JSON-LD `datePublished`
2. Meta tags (article:published_time, og:published_time, DC.date, etc.)
3. HTML `<time datetime>` elements

**Format:** `2025-09-23T00:00:00.000Z` (always midnight UTC, no time)

**Example:**

```json
{
  "url": "https://github.blog/article",
  "inspectTrigger": true
  // Auto-extracts publishedAt during Stage 1
}
```

### Feature 2: cloudProvider Override ☁️

**What:** Manually set `cloudProvider` before triggering Stage 1. Your value is respected instead of
Gemini's.

**When to Use:**

- Article covers multiple clouds (you want specific provider)
- Gemini misclassifies
- Fine-tuning categorization

**Example:**

```json
{
  "url": "https://...",
  "cloudProvider": "Azure", // Your override
  "inspectTrigger": true
  // cloudProvider remains "Azure" after Stage 1
}
```

### Feature 3: skipImageGeneration 🎯

**What:** Skip Stage 2 auto-trigger. Generate images selectively later.

**When to Use:**

- **Cost Control**: Generate images only for top articles
- **Batch Processing**: Process metadata first, images later
- **Timing**: Generate images when ready to publish

**Cost Savings:**

- All auto (94 URLs): 94 × $0.04 = **$3.76**
- Stage 1 all, Stage 2 for top 15: 15 × $0.04 = **$0.60**
- **Saves $3.16!** ✅

**Example:**

```json
{
  "url": "https://...",
  "skipImageGeneration": true, // Skip auto-image
  "inspectTrigger": true
  // No image generated yet
}
```

**Later: Trigger Image:**

```json
{
  "altCoverImageTrigger": true // Now generate image
}
```

### Full Feature Guide

See [pipeline-stage1-features.md](../archive/pipeline-stage1-features.md) for detailed workflows and examples.

---

## Data Structure: What Gets Stored

### Required (you provide)

- `url` — article URL (must be set before triggering)

### Optional (you can set before Stage 1)

- `cloudProvider` — Override cloud provider detection (new!)
- `skipImageGeneration` — Skip Stage 2 auto-trigger (new!)

### Auto-Generated (Stage 1)

| Field                | Example                                                   | Purpose                                           |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| `slug`               | `how-to-build-llm-apps`                                   | URL-safe identifier (auto-generated from title)   |
| `title`              | `How to Build an Enterprise LLM Application: ...`         | Article headline (max 100 chars)                  |
| `summary`            | `This article outlines GitHub's journey in developing...` | 2-3 sentence overview                             |
| `cloudProvider`      | `GitHub`                                                  | Provider classification (or your override)        |
| `publishedAt`        | `Timestamp(2025-09-23)`                                   | Publication date (date-only, UTC midnight) (new!) |
| `keyTopics`          | `["LLMs", "AI Product Dev", "A/B Testing"]`               | 3-5 core concepts                                 |
| `targetAudience`     | `Developer`                                               | Primary reader persona                            |
| `visualTheme`        | `A developer uses GitHub Copilot...`                      | Illustration prompt                               |
| `content`            | (18K chars)                                               | Markdown version of article                       |
| `contentHtml`        | (34K chars)                                               | Original HTML backup                              |
| `contentPlainText`   | (15K chars)                                               | Plain text for search                             |
| `wordCount`          | `2206`                                                    | Article length                                    |
| `scrapedImages`      | `[{original, stored, alt, index}]`                        | Image archive metadata                            |
| `scrapedImagesCount` | `4`                                                       | Number of images                                  |
| `scrapedMethod`      | `axios-cheerio`                                           | Scraping technique used                           |
| `scrapedAt`          | timestamp                                                 | When scraped                                      |
| `analysisPrompt`     | (full prompt)                                             | Gemini prompt for reproducibility                 |
| `analysisModel`      | `gemini-2.0-flash`                                        | Model used for analysis                           |

### Auto-Generated (Stage 2)

| Field                      | Example                                               | Purpose                |
| -------------------------- | ----------------------------------------------------- | ---------------------- |
| `altCoverImage`            | `https://storage.googleapis.com/.../covers/...ai.png` | Public cover image URL |
| `altCoverImagePrompt`      | (full prompt)                                         | Imagen-4 prompt used   |
| `altCoverImageGeneratedAt` | timestamp                                             | Image generation time  |

### Optional (you can pre-set)

- `publishedAt` — publication date (preserved if exists)
- `author` — article author (preserved if exists)

---

## How to Use: Quick Add

### Option 1: Firebase Console (Manual)

1. Go to **Firestore Console** → `blogs` collection
2. Create a new document with any ID (Firebase auto-generates one)
3. Add fields:
   ```
   url: "https://example.com/article-url"
   (leave everything else blank)
   ```
4. Click Create
5. Wait ~30 seconds
6. Refresh the document — all fields auto-populated!

**Timeline:**

- ~10s: Stage 1 scrapes + analyzes (title, summary, topics appear)
- ~25s: Stage 2 generates cover image
- ~30s total: Complete

### Option 2: CLI Script (Fast)

```bash
cd functions
node quick-add.js "https://github.blog/ai-and-ml/github-copilot/how-to-build-an-enterprise-llm-application-lessons-from-github-copilot/"
```

**Output:**

```
✅ Created doc: 2YzSFOIDmhlOnf7qNkLQ
URL: https://github.blog/ai-and-ml/github-copilot/...
inspectTrigger: true

⏳ Pipeline started. Check progress in 30 seconds:
   node check-document.js 2YzSFOIDmhlOnf7qNkLQ
```

### Option 3: Batch Add (Spreadsheet)

Create `urls.txt`:

```
https://github.blog/...
https://azure.microsoft.com/...
https://aws.amazon.com/...
```

Then:

```bash
node batch-add.js urls.txt
```

---

## Troubleshooting

### "No URL provided" error

**Cause:** Created document without `url` field
**Fix:** Add `url: "https://..."` before setting `inspectTrigger: true`

### Scraping fails (all variants: axios, Firecrawl, Puppeteer previous)

**Now fixed:** Using only Axios + Cheerio — no complex scraping libraries. Works on >95% of blogs.
**If still fails:** Site may have bot-blocking. Try:

1. Wait 30s and retry (temporary IP blocks)
2. Check if site allows public access (no login wall)
3. Try different article from same domain

### Gemini API error

**Cause:** Vertex AI API not enabled
**Fix:**

```bash
gcloud services enable aiplatform.googleapis.com --project=hybridcloudworks-61e8d
```

### Imagen-4 fails (Replicate timeout)

**Cause:** Replicate service slow or API rate limited
**Fix:** Retry after 60 seconds (Replicate has occasional timeouts)

### publishedAt not populated

**Cause:** Article source doesn't expose publication date
**Fix:** Some sites don't have meta tags or JSON-LD. You can set manually if needed.

### Image still generates with skipImageGeneration = true

**Cause:** Function wasn't re-deployed after setting flag
**Fix:** Re-deploy function or manually set `altCoverImageTrigger = false` to prevent Stage 2

---

## Secrets & Configuration

### Required Secrets (Firebase Secret Manager)

Only **1 secret** needed:

| Secret              | Value        | Purpose                   |
| ------------------- | ------------ | ------------------------- |
| `REPLICATE_API_KEY` | `r8_Vvb5...` | Imagen-4 image generation |

### APIs That Must Be Enabled

```bash
gcloud services enable aiplatform.googleapis.com \
  --project=hybridcloudworks-61e8d
```

✅ Vertex AI (Gemini) — **native auth, no key needed**
✅ Replicate API — key provided
✅ Firebase Admin SDK — auto-provisioned

---

## Performance & Costs

### Execution Time

| Stage     | Operation           | Time               |
| --------- | ------------------- | ------------------ |
| 1a        | Scrape URL          | ~2-3 seconds       |
| 1b        | Download images     | ~3-4 seconds       |
| 1c        | Gemini analysis     | ~4-5 seconds       |
| 2a        | Imagen-4 generation | ~15-20 seconds     |
| 2b        | Upload to Storage   | ~2-3 seconds       |
| **Total** | **End-to-end**      | **~30-35 seconds** |

### Cost Per Article

| Component            | Cost       | Notes                         |
| -------------------- | ---------- | ----------------------------- |
| Gemini API           | ~$0.01     | 15K tokens input, 0.5K output |
| Imagen-4 (Replicate) | ~$0.04     | 2K resolution PNG             |
| Cloud Storage        | <$0.01     | Images + metadata             |
| Cloud Functions      | <$0.01     | Duration + invocations        |
| **Total**            | **~$0.06** | Per article                   |

---

## Example Workflow

### Real Example: GitHub Copilot Article

**Input:** Just the URL

```
https://github.blog/ai-and-ml/github-copilot/how-to-build-an-enterprise-llm-application-lessons-from-github-copilot/
```

**Stage 1 Output** (10 seconds):

```javascript
{
  slug: "how-to-build-an-enterprise-llm-application-lessons-from-github-copilot",
  title: "How to Build an Enterprise LLM Application: Lessons from GitHub Copilot",
  summary: "This article outlines GitHub's journey in developing GitHub Copilot, providing insights into building and scaling enterprise AI products.",
  cloudProvider: "GitHub",
  keyTopics: ["Large Language Models (LLMs)", "AI Product Development", "GitHub Copilot", "A/B Testing", "User Feedback"],
  targetAudience: "Developer",
  visualTheme: "A developer uses GitHub Copilot in their IDE. Code suggestions appear as they type, with a purple GitHub theme.",
  wordCount: 2206,
  content: "# How to Build an Enterprise LLM Application...",
  scrapedImages: 4,
}
```

**Stage 2 Output** (25 seconds):

```javascript
{
  altCoverImage: "https://storage.googleapis.com/hybridcloudworks-61e8d.appspot.com/covers/2YzSFOIDmhlOnf7qNkLQ-ai.png",
  altCoverImageGeneratedAt: "2026-02-17T01:21:40Z"
}
```

**Result:** Article with cover image, all metadata, ready to publish.

---

## Next Steps

### Content Creator Workflow

1. **Find article** (from RSS feed, link, or manual)
2. **Copy URL** → `node quick-add.js "URL"`
3. **Wait 30 seconds** (or do something else)
4. **Review in Console** → Edit if needed (optional)
5. **Publish** → Deploy to frontend

### Bulk Operations

For adding multiple articles:

```bash
# Create URLs file
cat > urls.txt << EOF
https://article1.com
https://article2.com
https://article3.com
EOF

# Batch add
node batch-add.js urls.txt

# Check all 3 after 30s
firebase functions:log --only inspectAndPopulateArticle
```

### Bulk Operations with New Features (Cost Optimization)

Process 94+ URLs efficiently using new features:

**Recommended:** Stage 1 for all articles, Stage 2 for top 15

```json
{
  "url": "https://...",
  "skipImageGeneration": true, // Process metadata only
  "inspectTrigger": true
}
```

Then selectively trigger images for top articles:

```json
{
  "altCoverImageTrigger": true // Generate image now
}
```

**Cost Savings:** $3.76 → $0.60 for 94 URLs!

**See:** [bulk-processing-workflow.md](../archive/bulk-processing-workflow.md)

---

## Key Improvements Over Previous System

| Aspect                    | Before                                                      | Now                                          |
| ------------------------- | ----------------------------------------------------------- | -------------------------------------------- |
| **AI Model**              | Anthropic Claude (network blocked)                          | Google Gemini (native Cloud auth)            |
| **Web Scraper**           | Firecrawl ($, unreliable) + Puppeteer (fails in serverless) | Axios + Cheerio (simple, reliable)           |
| **Success Rate**          | ~30% of articles                                            | ~95%+ of articles                            |
| **Secrets Needed**        | 3 (Firecrawl, Claude, Replicate)                            | 1 (Replicate only)                           |
| **Time to Full Pipeline** | Unpredictable (retries)                                     | Consistent 30-35 seconds                     |
| **Data Stored**           | Metadata only                                               | Source content + metadata + prompts + images |
| **Cost Per Article**      | Unable to estimate (failures)                               | $0.06 all-in                                 |

---

## API Reference

### JavaScript Functions

#### `quick-add.js` — Add URL from CLI

```bash
node quick-add.js "<URL>"
```

Creates document and triggers pipeline.

#### `check-document.js` — Check pipeline status

```bash
node check-document.js "<documentId>"
```

Shows Stage 1 / Stage 2 progress and results.

#### `batch-add.js` — Add multiple URLs

```bash
node batch-add.js urls.txt
```

File format: one URL per line.

---

## Architecture Diagram

```
INPUT: URL
  ↓
[STAGE 1: INSPECTION] (10-15s)
  ├─ Axios + Cheerio: Scrape & extract
  ├─ Turndown: HTML → Markdown
  ├─ Firebase Storage: Archive images
  └─ Vertex AI Gemini: Analyze content
       ↓
[FIRESTORE UPDATE] 1a
  ├─ content, contentHtml, contentPlainText
  ├─ title, summary, cloudProvider, keyTopics,
  │  targetAudience, visualTheme
  ├─ slug (auto-generated)
  ├─ analysisPrompt, analysisModel
  └─ inspectTrigger: false
  └─ altCoverImageTrigger: true ← AUTO-TRIGGER
       ↓
[STAGE 2: IMAGE GENERATION] (20-30s)
  ├─ Build prompt from metadata
  ├─ Replicate: Imagen-4 API
  └─ Firebase Storage: Upload PNG
       ↓
[FIRESTORE UPDATE] 2
  ├─ altCoverImage (public URL)
  ├─ altCoverImagePrompt
  └─ altCoverImageGeneratedAt
       ↓
OUTPUT: Published article with metadata + cover image
```

---

## Support

**Getting stuck?** Check:

1. Has Vertex AI API been enabled? (`gcloud services list --enabled | grep aiplatform`)
2. Does `REPLICATE_API_KEY` secret exist?
   (`firebase functions:secrets:access REPLICATE_API_KEY --region us-central1`)
3. Monitor logs: `firebase functions:log --only inspectAndPopulateArticle`
4. Review [pipeline-deployment-guide.md](../archive/pipeline-deployment-guide.md) for baseline setup

---

## Related Documentation

- [pipeline-stage1-features.md](../archive/pipeline-stage1-features.md) — Detailed guide: publishedDate,
  cloudProvider override, skipImageGeneration
- [database-firestore-collections.md](../archive/database-firestore-collections.md) — Complete field reference
  and query examples
- [bulk-processing-workflow.md](../archive/bulk-processing-workflow.md) — Process 94+ URLs with cost
  optimization strategies
- [pipeline-deployment-guide.md](../archive/pipeline-deployment-guide.md) — Setup and deployment instructions
