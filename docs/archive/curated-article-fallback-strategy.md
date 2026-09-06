# Curated Article Fallback Strategy

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## Overview

Cost optimization strategy for curated article image generation that prioritizes scraping existing
images over expensive AI generation.

## Implementation (May 24, 2026 - F10)

### Strategy Hierarchy

1. **Try og:image scraping first** (preferred)
   - Scrape article URL for `og:image` or `twitter:image` metadata
   - Re-host scraped image in Firebase Storage
   - Cost: minimal (axios + cheerio)

2. **Use default fallback cover** (when scraping fails)
   - Static branded cover image hosted in Firebase Storage
   - URL:
     `https://firebasestorage.googleapis.com/v0/b/hybridcloudworks-61e8d.appspot.com/o/covers%2F1779664455640-rss-azure-azuremicrosoftcomupdatesid562359.png?alt=media`
   - Cost: $0 (no generation)

3. **AI generation disabled** (deprecated)
   - Previously generated unique images via Replicate API
   - Cost: $0.05-0.10 per image
   - Removed to reduce operational costs

### Code Location

Function: `generateCuratedArticleImage` in `functions/cms-functions.js`

```javascript
// Default fallback cover image for articles without og:image
const DEFAULT_FALLBACK_COVER_URL =
  'https://firebasestorage.googleapis.com/v0/b/hybridcloudworks-61e8d.appspot.com/o/covers%2F1779664455640-rss-azure-azuremicrosoftcomupdatesid562359.png?alt=media';

// Try to scrape og:image → If fails → Use default fallback
```

## Cost Savings

### Before (AI Generation for All)

- Curated articles without og:image: ~50/month
- Cost per AI image: $0.08
- Monthly cost: **$4.00**

### After (Fallback Strategy)

- Curated articles without og:image: ~50/month
- Cost per fallback: $0.00
- Monthly cost: **$0.00**

**Annual savings: ~$48**

## Quality Trade-offs

### ✅ Advantages

- Instant fallback (no generation delay)
- Consistent branded appearance
- Zero AI generation cost
- No Replicate API calls
- Reduced function execution time
- Simpler error handling

### ⚠️ Trade-offs

- Less visual variety for articles without og:image
- Same fallback image used across providers
- No article-specific visual context

## Cache Behavior

Firestore cache still operates normally:

- Cache key: `articleId`
- Cache collection: `curated_article_images`
- Cached value: scraped image URL OR fallback URL
- TTL: indefinite (manual invalidation only)

## Future Enhancements

If AI generation cost becomes acceptable or quality requirements change:

1. Re-enable `generateCuratedAiImage()` function (currently preserved but unused)
2. Add configuration flag to toggle between fallback and AI generation
3. Consider selective AI generation (e.g., only for high-priority providers)

## Related Files

- `functions/cms-functions.js` — Implementation
- `src/hooks/useGenerateCuratedImages.js` — Frontend consumer
- `documentation/Firebase-GCP-Cost-Inventory.md` — Cost analysis
- `documentation/AI-Integration-Inventory.md` — AI feature registry

## Migration Notes

- No database migration required
- Existing cached images remain valid
- New requests without og:image use fallback immediately
- Function signature unchanged (backward compatible)

## Testing

### Manual Test

```bash
curl -X POST https://generatecuratedarticleimage-p6ktmuw2wq-uc.a.run.app \
  -H "Content-Type: application/json" \
  -d '{
    "articleTitle": "Test Article Without Image",
    "articleSummary": "Test summary",
    "basePrompt": "Test prompt",
    "provider": "Azure",
    "articleId": "test-fallback-001",
    "articleUrl": "https://example.com/no-og-image"
  }'
```

Expected response:

```json
{
  "success": true,
  "imageUrl": "https://firebasestorage.googleapis.com/v0/b/hybridcloudworks-61e8d.appspot.com/o/covers%2F1779664455640-rss-azure-azuremicrosoftcomupdatesid562359.png?alt=media"
}
```

## Deployment

```bash
# Deploy only the updated function
firebase deploy --only functions:generateCuratedArticleImage --project hybridcloudworks-61e8d
```

## Monitoring

Key metrics to track:

- Fallback usage rate (no og:image articles)
- Scrape success rate
- Cache hit rate
- Cost reduction validation

Check logs:

```bash
firebase functions:log --only generateCuratedArticleImage
```

Look for:

- `[generateCuratedArticleImage] Scraping og:image for {id}`
- `[generateCuratedArticleImage] No og:image found for {id}, using default fallback cover`
- `[generateCuratedArticleImage] Cache hit for {id}`
