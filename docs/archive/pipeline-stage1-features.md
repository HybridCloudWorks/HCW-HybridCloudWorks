# PIPELINE-STAGE1-FEATURES

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 17, 2026
**Status:** Production Ready ✅
**Related:** [database-firestore-collections.md](../archive/database-firestore-collections.md)

---

## Overview

Stage 1 (`inspectAndPopulateArticle`) has been enhanced with three powerful features:

1. **publishedDate Extraction** — Automatic extraction from article metadata
2. **cloudProvider Override** — Manual override of cloud provider detection
3. **skipImageGeneration** — Optional bypass of auto-triggered image generation

These features provide complete control over the content pipeline while maintaining backward
compatibility.

---

## Feature 1: publishedDate Extraction ✨

### What It Does

Automatically extracts publication date from article metadata and stores it in Firestore as
`publishedAt` (date-only, midnight UTC).

### Extraction Strategy

Priority order:

1. JSON-LD structured data (`datePublished`)
2. Meta tags: `article:published_time`, `og:published_time`, `DC.date`, `publish_date`, etc.
3. HTML `<time datetime>` elements

### Date Format

Always normalized to **date-only** (no time component):

```
2025-09-23T00:00:00.000Z  ← Always midnight UTC
```

### When Used

- Automatically runs during Stage 1
- Useful for sorting/filtering articles by date
- Better than manual entry for bulk imports

### Verification

```bash
# Trigger document and wait 30 seconds
# In Firestore, check if publishedAt field appears
```

### Example Result

```json
{
  "url": "https://github.blog/...",
  "publishedAt": Timestamp(2025-09-23),  // ← Auto-extracted
  "title": "How to Build an Enterprise LLM Application",
  "summary": "Lessons from GitHub Copilot..."
}
```

### Troubleshooting

| Issue                     | Solution                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| publishedAt not populated | Some sites don't expose date metadata (YouTube, authenticated content). Set manually if needed. |
| Only month/year captured  | Some sites provide limited date info. Date-only format still allows sorting.                    |

---

## Feature 2: cloudProvider Override ☁️

### What It Does

Allows you to manually set `cloudProvider` before triggering Stage 1. If set, your value is
respected instead of Gemini's detection.

### When to Use

- Article covers multiple clouds (you want specific provider)
- Gemini misclassifies the cloud provider
- Fine-tuning metadata for your content strategy

### How to Use

1. In Firestore, before triggering, set:

   ```json
   {
     "url": "https://...",
     "cloudProvider": "Azure", // ← Your override
     "inspectTrigger": true
   }
   ```

2. After Stage 1 completes, `cloudProvider` remains "Azure" (not changed by Gemini)

### Valid Values

```
AWS
Azure
Google Cloud
GitHub
Terraform
Ansible
FinOps
(or any custom value)
```

### Default Behavior

If you DON'T set `cloudProvider`:

```json
{
  "url": "https://...",
  // cloudProvider not set
  "inspectTrigger": true
}
// After Stage 1:
// cloudProvider = Gemini's detection (e.g., "AWS")
```

### Example Workflow

Multi-cloud article, but you only want Azure content:

```json
{
  "url": "https://blog.example.com/multi-cloud-guide",
  "cloudProvider": "Azure", // Force it
  "skipImageGeneration": true, // Optional
  "inspectTrigger": true
}
```

---

## Feature 3: skipImageGeneration (Stage 2 Control) 🎯

### What It Does

By default, Stage 1 auto-triggers Stage 2 (image generation). Setting `skipImageGeneration = true`
stops the auto-trigger.

You can manually trigger Stage 2 later via `altCoverImageTrigger = true`.

### When to Use

- **Cost Control**: Generate images only for top articles
- **Batch Processing**: Stage 1 all articles, Stage 2 selectively
- **Testing**: Run full pipeline on subset before bulk processing
- **Timing Control**: Generate images when you're ready to publish

### How to Use

**Stage 1 Only (Skip Auto Image):**

```json
{
  "url": "https://...",
  "skipImageGeneration": true, // ← Skip auto-trigger
  "inspectTrigger": true
}
// Result: All metadata extracted, NO image generated
```

**Later: Manually Trigger Stage 2:**

```json
{
  // Same document, later when ready:
  "altCoverImageTrigger": true // ← Generate image now
}
```

### Default Behavior

```json
{
  "url": "https://...",
  // skipImageGeneration not set (defaults to false)
  "inspectTrigger": true
}
// Result: Stage 1 → Stage 2 auto-triggers → Image generated
```

### Cost Impact

| Scenario                        | Cost                                  |
| ------------------------------- | ------------------------------------- |
| All 94 URLs auto-trigger images | 94 × $0.04 = **$3.76**                |
| Stage 1 all, Stage 2 for top 15 | 15 × $0.04 = **$0.60** (saves $3.16!) |
| Stage 1 only, no images         | **Free**                              |

---

## Combining Features: Example Workflows

### Workflow 1: Full Control (All Three Features)

```json
{
  "url": "https://blog.example.com/multi-cloud",
  "cloudProvider": "Azure", // Feature 2: Override
  "skipImageGeneration": true, // Feature 3: Skip auto-image
  "inspectTrigger": true
}
// Result:
// ✓ publishedAt auto-extracted (Feature 1)
// ✓ cloudProvider forced to "Azure"
// ✓ No image generated until you manually trigger
// ✓ publishedAt: 2025-09-15T00:00:00.000Z
```

### Workflow 2: Auto Everything (Backward Compatible)

```json
{
  "url": "https://github.blog/article",
  // All features use defaults
  "inspectTrigger": true
}
// Result:
// ✓ publishedAt auto-extracted
// ✓ cloudProvider auto-detected by Gemini
// ✓ Image auto-generated (Stage 2 triggered)
```

### Workflow 3: Bulk Import, Selective Images (Cost Optimized)

```
Phase 1: Create 94 URLs with skipImageGeneration = true
Phase 2: All Stage 1 completes (all dates extracted, all provider fields filled)
Phase 3: Pick top 15 articles → set altCoverImageTrigger = true
Phase 4: Only those 15 generate images
Result: $0.60 cost instead of $3.76
```

### Workflow 4: Custom Provider, Auto Image

```json
{
  "url": "https://...",
  "cloudProvider": "Terraform", // Custom override
  // skipImageGeneration not set (auto-triggers)
  "inspectTrigger": true
}
// Result:
// ✓ publishedAt extracted
// ✓ cloudProvider = "Terraform"
// ✓ Image auto-generated
```

---

## What Gets Stored After Stage 1

### Auto-Generated Fields (Always)

```json
{
  "title": "Article Title",
  "summary": "2-3 sentence summary",
  "cloudProvider": "AWS",  // (or your override)
  "keyTopics": ["topic1", "topic2"],
  "targetAudience": "DevOps Engineers",
  "visualTheme": "Dark Tech",
  "slug": "article-url-safe-slug",
  "publishedAt": Timestamp(2025-09-23),  // ← NEW! Date only
  "content": "First 50k chars of markdown",
  "contentHtml": "First 100k chars of HTML",
  "contentPlainText": "First 50k chars of text",
  "wordCount": 3847,
  "scrapedImages": [...],  // Up to 10 images archived
  "analysisPrompt": "Full Gemini prompt (for debugging)",
  "analysisModel": "gemini-2.0-flash"
}
```

### Stage 2 Conditional Trigger

```json
{
  // If skipImageGeneration ≠ true:
  "altCoverImageTrigger": true // ← Auto-triggers cover generation

  // If skipImageGeneration = true:
  // altCoverImageTrigger is NOT set
}
```

---

## Testing These Features

### Test 1: publishedDate Extraction

```
1. Create document: {"url": "https://github.blog/...", "inspectTrigger": true}
2. Wait 15-30 seconds
3. Check if publishedAt is populated ✓
```

### Test 2: cloudProvider Override

```
1. Set: {"url": "https://...", "cloudProvider": "Azure", "inspectTrigger": true}
2. After completion: Verify cloudProvider is still "Azure" ✓
```

### Test 3: skipImageGeneration

```
1. Set: {"url": "https://...", "skipImageGeneration": true, "inspectTrigger": true}
2. After Stage 1: Verify alt CoverImageTrigger NOT auto-set ✓
3. Later: Set altCoverImageTrigger = true
4. Watch: Image generates ✓
```

---

## Quick Reference

| Field                 | Type    | Optional    | Purpose                          |
| --------------------- | ------- | ----------- | -------------------------------- |
| `url`                 | String  | ❌ Required | Article URL to scrape            |
| `inspectTrigger`      | Boolean | ❌ Required | Set to `true` to start Stage 1   |
| `cloudProvider`       | String  | ✅ Optional | Override cloud provider (new!)   |
| `skipImageGeneration` | Boolean | ✅ Optional | Skip Stage 2 auto-trigger (new!) |

---

## Implementation Details

### Code Locations

| Feature                   | Code                 | Lines     |
| ------------------------- | -------------------- | --------- |
| publishedDate Extraction  | `functions/index.js` | 883-952   |
| cloudProvider Override    | `functions/index.js` | 1077      |
| skipImageGeneration Logic | `functions/index.js` | 1090-1094 |

### Key Functions

**`extractPublishedDate(html, plainText)`** (Lines 883-952)

- Extracts date from JSON-LD, meta tags, datetime elements
- Returns date at midnight UTC (00:00:00)
- Returns null if no date found

**`inspectAndPopulateArticle(event)`** (Lines 998+)

- Calls extractPublishedDate after scraping
- Checks for cloudProvider override
- Conditionally triggers Stage 2 based on skipImageGeneration

---

## Backward Compatibility

✅ All features are **fully backward compatible**:

- Existing documents without new fields work as before
- Default behavior unchanged (Stage 2 auto-triggers)
- New fields are optional

---

## Next Steps

1. **Bulk Processing**: Trigger your 94 URLs with skipImageGeneration = true
2. **Monitor**: Check Firestore for publishedAt population
3. **Selective Stage 2**: Generate images for top articles only
4. **Cost Savings**: Keep ~$3 by not imaging all articles

See [database-firestore-collections.md](../archive/database-firestore-collections.md) for field setup details.

---

## Troubleshooting

| Issue                                 | Solution                                                                      |
| ------------------------------------- | ----------------------------------------------------------------------------- |
| publishedAt not populated             | Some sites don't expose dates. Use other metadata and set manually if needed. |
| cloudProvider override ignored        | Verify field name is exactly `cloudProvider` (case-sensitive)                 |
| Image still generating with skip flag | Re-deploy function if flag was set after deployment                           |
| publishedAt shows wrong date          | Check article source—some sites have old cached metadata                      |

---

**Status**: Production ready
**Test Coverage**: 3 features tested and working
**Deployment**: firebase deploy --only functions:inspectAndPopulateArticle
