# BULK-PROCESSING-WORKFLOW

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 17, 2026
**Status:** Ready for 94 URLs ✅
**Related:** [pipeline-stage1-features.md](../archive/pipeline-stage1-features.md),
[database-firestore-collections.md](../archive/database-firestore-collections.md)

---

## Overview

You have 94 URLs ready for processing. This guide provides three cost-optimized strategies to
process them efficiently while maximizing data quality and minimizing spend.

---

## The Math

| Strategy                                     | Stage 1 Cost | Stage 2 Cost           | Total Cost | Time     |
| -------------------------------------------- | ------------ | ---------------------- | ---------- | -------- |
| **All Auto**                                 | Free         | 94 × $0.04 = **$3.76** | **$3.76**  | ~45 min  |
| **Stage 1 All + Selective Stage 2** (Top 15) | Free         | 15 × $0.04 = **$0.60** | **$0.60**  | ~2 hours |
| **Stage 1 Only** (No Images)                 | Free         | $0.00                  | **$0.00**  | ~30 min  |

**Recommended**: Strategy 2 (Top 15 articles with images) = **Saves $3.16** while maintaining visual
content for key articles.

---

## Strategy 1: All Auto (Baseline)

**Best for**: Quick turnaround when budget isn't a concern

### Steps

```json
// BATCH TEMPLATE 1 (All Auto)
// Use for each of 94 URLs

{
  "url": "https://...",
  "inspectTrigger": true
  // No overrides, default behavior
}
```

### Timeline

- **Stage 1**: ~30 seconds per URL × 94 = ~47 minutes
- **Stage 2**: Concurrent with Stage 1 (auto-triggered) = ~15-20 minutes
- **Total**: ~60 minutes

### Cost Breakdown

- **Vertex AI** (Gemini): Free (Google Cloud native)
- **Images** (Replicate): 94 × $0.04 = **$3.76**
- **Total**: **$3.76**

### Pros & Cons

✅ Fastest execution
✅ All URLs get cover images
❌ Expensive ($3.76 for 94 images)
❌ No control over which articles get images

---

## Strategy 2: Stage 1 + Selective Stage 2 (RECOMMENDED) 🎯

**Best for**: Cost-conscious approach with best ROI

This is the **recommended strategy** for the 94-URL batch.

### Phase 1: Process All URLs (Stage 1 Only)

```json
{
  "url": "https://...",
  "skipImageGeneration": true, // KEY: Skip auto-trigger
  "inspectTrigger": true
}
```

**Timeline**: ~30–45 minutes (all 94 URLs)

**What Gets Done**:

- ✅ All 94 content items scraped & analyzed
- ✅ Metadata extracted (title, summary, topics)
- ✅ Cloud providers identified
- ✅ **publishedAt dates populated** (NEW!)
- ✅ Word counts calculated
- ❌ No images generated yet

### Phase 2: Manual Selection (Review & Pick Top 15)

1. In Firestore, query and review completed articles:

```javascript
db.collection('articles')
  .where('cloudProvider', '!=', null)
  .limit(94)
  .get()
  .then((snap) => {
    snap.docs.forEach((doc) => {
      console.log(`${doc.data().title} (${doc.data().wordCount} words)`);
    });
  });
```

2. Identify your top-performing categories:
   - **Azure**: Pick 5 most important
   - **AWS**: Pick 5 most important
   - **Google Cloud**: Pick 3 most important
   - **GitHub/DevOps**: Pick 2 most important

3. Document their Firestore IDs

### Phase 3: Trigger Images for Top 15

For each of your 15 selected articles:

```json
{
  // Same article from Phase 1
  "altCoverImageTrigger": true // TRIGGER IMAGE GENERATION
}
```

**Timeline**: ~5–10 minutes (concurrent Stage 2 for 15)

**Cost**: 15 × $0.04 = **$0.60**

### Total Cost & Timeline

- **Phase 1**: Free, ~45 minutes
- **Phase 2**: Free (review), ~10 minutes
- **Phase 3**: $0.60, ~10 minutes
- **Total**: **$0.60 for 94 articles + 15 images**
- **Time**: ~65 minutes total

### Pros & Cons

✅ **Huge cost savings**: $0.60 vs. $3.76
✅ Control which articles get images (top tier only)
✅ Complete metadata for all 94
✅ Can defer images—add more later if budget allows
✅ Best bang for your marketing budget
❌ Requires manual selection step
❌ Slightly longer total time

---

## Strategy 3: Stage 1 Only (No Images)

**Best for**: Data collection before making image decisions

### Single Config for All 94

```json
{
  "url": "https://...",
  "skipImageGeneration": true,
  "inspectTrigger": true
}
```

### Timeline

**~30–45 minutes** (no Stage 2)

### What You Get

- ✅ All content extracted & analyzed
- ✅ All metadata populated
- ✅ Cost-free data for filtering/sorting
- ❌ No cover images

### When to Use

- Testing before full bulk deployment
- Analyzing content trends without image investment
- Building content index first, imagery later

### Cost

**$0.00**

---

## Execution Plan (Step-by-Step)

### Prerequisites

- ✅ All 94 URLs validated
- ✅ Firebase Cloud Functions deployed
- ✅ Firestore ready
- ✅ Replicate API key configured (in GitHub Secrets)

### Choose Your Strategy

**1. Decide on a strategy** (I recommend Strategy 2)

**2. Prepare batch:**

- Option A: Use existing script

  ```bash
  cd functions
  node batch-add.js  # Add from add-urls-from-file.js
  ```

- Option B: Manual Firestore import

  ```javascript
  // Create batch
  const batch = db.batch();

  urls.forEach((url) => {
    const docRef = db.collection('articles').doc();
    batch.set(docRef, {
      url: url,
      skipImageGeneration: true, // If Strategy 2
      inspectTrigger: true,
    });
  });

  await batch.commit();
  ```

**3. Monitor progress:**

```javascript
// Watch Stage 1 progress
db.collection('articles')
  .where('title', '!=', null) // Title indicates completion
  .onSnapshot((snap) => {
    console.log(`Completed: ${snap.size} / 94`);
  });
```

**4. Wait for Phase 1 completion** (~45 min)

**5. If Strategy 2: Review & select top 15**

**6. If Strategy 2: Trigger images for top 15**

**7. Monitor image generation:**

```javascript
db.collection('articles')
  .where('altCoverImageStatus', '==', 'completed')
  .get()
  .then((snap) => {
    console.log(`Images completed: ${snap.size}`);
  });
```

---

## Batch Processing Script

### Using existing add-urls-from-file.js

```bash
# 1. Create file with all 94 URLs (one per line)
echo "https://..." > urls.txt
echo "https://..." >> urls.txt
# ... add all 94

# 2. Run batch script
node add-urls-from-file.js urls.txt

# 3. Monitor in Firestore
```

### Alternative: Manual Batch via Script

Create `batch-process-94.js`:

```javascript
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const URLS = [
  'https://...', // URL 1
  'https://...', // URL 2
  // ... all 94 URLs
];

async function batchAdd() {
  console.log(`Adding ${URLS.length} URLs with skipImageGeneration=true`);

  const batch = db.batch();
  let count = 0;

  URLS.forEach((url) => {
    const docRef = db.collection('articles').doc();
    batch.set(docRef, {
      url: url,
      skipImageGeneration: true, // Strategy 2
      inspectTrigger: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    count++;

    if (count % 100 === 0) {
      console.log(`Prepared ${count} documents...`);
    }
  });

  await batch.commit();
  console.log(`✅ All ${URLS.length} documents created`);
}

batchAdd().catch(console.error);
```

---

## Monitoring & Status

### Track Progress in Firestore Console

```javascript
// Query for live progress
db.collection('articles')
  .where('cloudProvider', '!=', null)
  .count()
  .get()
  .then((snap) => {
    console.log(`Completed: ${snap.data().count} / 94`);
  });

// Find failures (will have title = null)
db.collection('articles')
  .where('title', '==', null)
  .limit(10)
  .get()
  .then((snap) => {
    snap.docs.forEach((doc) => {
      console.log(`Failed: ${doc.data().url}`);
    });
  });
```

### via Cloud Functions Logs

```bash
# Watch function logs in real-time
gcloud functions logs read inspectAndPopulateArticle --limit 50 --follow
```

---

## Error Handling

### Common Issues

| Issue             | Cause                         | Solution                   |
| ----------------- | ----------------------------- | -------------------------- |
| URL not reachable | Site down or blocked          | Skip URL, retry later      |
| No metadata found | Site doesn't expose meta tags | Manual title/summary entry |
| Timeout (>30s)    | Slow site or heavy page       | Retry or skip              |
| Image gen fails   | Replicate API issue           | Check Replicate dashboard  |

### Retry Strategy

For failed URLs (if any):

```javascript
// Re-trigger documents with null title
db.collection('articles')
  .where('title', '==', null)
  .get()
  .then((snap) => {
    snap.docs.forEach((doc) => {
      // Re-set trigger
      db.collection('articles').doc(doc.id).update({
        inspectTrigger: true,
      });
    });
  });
```

---

## Cost Optimization Tips

### Reduce Image Generation

If budget is tight:

- Generate images only for top 5-10 articles
- Use extracted images (already scraped) if visually appealing
- Reserve AI-generated images for hero/featured content

### Batch Timing

- Run during off-peak hours (lower API contention)
- Stagger batches if running multiple (avoid API rate limits)

### Monitor Spend

- Set up Firebase billing alerts: **$1.00 threshold**
- Track Replicate API usage in dashboard
- Review Gemini usage (currently free for native Google Cloud)

---

## Post-Processing Checklist

After your 94 URLs complete:

- [ ] All `publishedAt` dates populated (new feature!)
- [ ] All `cloudProvider` values set
- [ ] All `slug` values unique
- [ ] Images selected for top-tier articles
- [ ] Content linked to website/CMS
- [ ] URL redirects set up (if replacing old content)
- [ ] Analytics tags applied
- [ ] SEO metadata validated

---

## Timeline Summary

### Strategy 2 (Recommended)

```
⏰ 00:00 - Start: Add 94 docs with skipImageGeneration=true
⏰ 00:50 - Phase 1 Complete: All Stage 1 done, no images generated
⏰ 01:00 - Review & select top 15 articles
⏰ 01:10 - Trigger images for top 15
⏰ 01:20 - Phase 2 Complete: 15 images generated
        Total: $0.60 spent, 94 articles with full metadata, 15 with images
```

### Strategy 1 (All Auto)

```
⏰ 00:00 - Start: Add 94 docs (default behavior)
⏰ 01:00 - Complete: All 94 articles + images done
        Total: $3.76 spent, 94 articles with images
```

---

## Next Steps

1. **Pick a strategy** (recommend Strategy 2)
2. **Prepare 94 URLs** in batch file
3. **Deploy function** (if not already deployed)
4. **Run batch add**: `node add-urls-from-file.js urls.txt`
5. **Monitor progress** in Firestore
6. **Review results** (for Strategy 2: pick top 15)
7. **Trigger phase 2** if applicable

---

## FAQ

**Q: Can I pause and resume?**
A: Yes! Documents don't expire. You can batch-add 50, process them, then add 44 more later.

**Q: How long does Stage 1 take per URL?**
A: ~30 seconds on average (range: 10-60s depending on article size).

**Q: Can I change strategy mid-batch?**
A: Yes. Documents already completed stay as-is. New documents use new skipImageGeneration setting.

**Q: What if a URL fails?**
A: Document is created but `title` remains null. Retry by setting `inspectTrigger = true` again.

**Q: Are images required?**
A: No! You can publish with just metadata. Images are optional cover art.

---

## Files Referenced

- `functions/add-urls-from-file.js` — Batch import script
- `functions/functions/index.js` — Main Cloud Function
- [pipeline-stage1-features.md](../archive/pipeline-stage1-features.md) — New features
- [database-firestore-collections.md](../archive/database-firestore-collections.md) — Field reference

---

**Status**: Ready to execute with 94 URLs
**Recommended Strategy**: Strategy 2 (Stage 1 All + Selective Stage 2)
**Estimated Cost (Strategy 2)**: **$0.60**
**Estimated Time**: ~65 minutes
