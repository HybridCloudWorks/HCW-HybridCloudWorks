const axios = require('axios');
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    urls: [],
    endpoint: process.env.CONTENTFORGE_SCRAPE_TEST_ENDPOINT || '',
    urlsFile: '',
    out: '',
    local: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === '--url' && argv[index + 1]) {
      args.urls.push(argv[index + 1]);
      index += 1;
      continue;
    }

    if (current === '--endpoint' && argv[index + 1]) {
      args.endpoint = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--urls-file' && argv[index + 1]) {
      args.urlsFile = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--out' && argv[index + 1]) {
      args.out = argv[index + 1];
      index += 1;
      continue;
    }

    if (current === '--local') {
      args.local = true;
    }
  }

  return args;
}

function readUrlsFromFile(filePath) {
  const absolute = path.resolve(filePath);
  const content = fs.readFileSync(absolute, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function average(values) {
  if (!values.length) return 0;
  const total = values.reduce((sum, value) => sum + Number(value || 0), 0);
  return Math.round(total / values.length);
}

function buildResultEntry(url, draft, requestStartedAt) {
  const mode = draft.scrapeMode || 'unknown';
  const latency = draft.scrapeLatencyMs || Date.now() - requestStartedAt;
  const wordCount = String(draft.postContent || '')
    .split(/\s+/)
    .filter(Boolean).length;
  const hasTitle = Boolean(String(draft.title || '').trim());
  const hasSummary = Boolean(String(draft.summary || '').trim());
  const hasBody = wordCount > 120;
  const completenessScore = Number(hasTitle) + Number(hasSummary) + Number(hasBody);
  return {
    url,
    success: true,
    scrapeMode: mode,
    scrapeLatencyMs: latency,
    generatedWordCount: wordCount,
    completeness: { hasTitle, hasSummary, hasBody, score: completenessScore },
  };
}

async function fetchDraftForUrl({ url, local, endpoint, localScrapeFn }) {
  if (local) {
    const scraped = await localScrapeFn(url);
    return {
      title: scraped.title || '',
      summary: scraped.description || '',
      postContent: scraped.markdown || scraped.cleanedText || '',
      scrapeMode: scraped.scrapeMode || 'unknown',
      scrapeLatencyMs: scraped.scrapeLatencyMs || null,
    };
  }
  const response = await axios.post(
    endpoint,
    { url },
    { timeout: 90000, headers: { 'Content-Type': 'application/json' } }
  );
  return response.data?.draft || {};
}

async function processOneUrl(url, options) {
  const requestStartedAt = Date.now();
  try {
    const draft = await fetchDraftForUrl({ url, ...options });
    const entry = buildResultEntry(url, draft, requestStartedAt);
    console.warn(`[OK] ${entry.scrapeMode} | ${entry.scrapeLatencyMs}ms | ${url}`);
    return entry;
  } catch (error) {
    const entry = {
      url,
      success: false,
      error: error.response?.data?.error || error.message,
    };
    console.warn(`[FAIL] ${entry.error} | ${url}`);
    return entry;
  }
}

function buildSummary(results, { local, endpoint, urlsFile, dedupedUrls, startedAt }) {
  const modeCounts = results.reduce((accumulator, item) => {
    const key = item.scrapeMode || (item.success ? 'unknown' : 'failed');
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
  const successful = results.filter((item) => item.success).length;
  const successRate = ((successful / results.length) * 100).toFixed(1);
  const successfulEntries = results.filter((item) => item.success);
  const avgLatencyMs = average(successfulEntries.map((item) => item.scrapeLatencyMs || 0));
  const avgWords = average(successfulEntries.map((item) => item.generatedWordCount || 0));
  const avgCompleteness = average(
    successfulEntries.map((item) => item.completeness?.score || 0)
  ).toFixed(2);
  const modeDetails = Object.entries(
    successfulEntries.reduce((accumulator, item) => {
      const key = item.scrapeMode || 'unknown';
      if (!accumulator[key]) accumulator[key] = { count: 0, latencies: [] };
      accumulator[key].count += 1;
      accumulator[key].latencies.push(Number(item.scrapeLatencyMs || 0));
      return accumulator;
    }, {})
  ).reduce((accumulator, [mode, data]) => {
    accumulator[mode] = { count: data.count, avgLatencyMs: average(data.latencies) };
    return accumulator;
  }, {});
  return {
    endpoint: local ? null : endpoint,
    localMode: local,
    urlsFile: urlsFile ? path.resolve(urlsFile) : null,
    testedUrls: dedupedUrls.length,
    total: results.length,
    success: successful,
    successRate: Number(successRate),
    avgLatencyMs,
    avgGeneratedWordCount: avgWords,
    avgCompletenessScore: Number(avgCompleteness),
    modes: modeCounts,
    modeDetails,
    elapsedMs: Date.now() - startedAt,
  };
}

function logSummary(summary) {
  console.warn('\nSummary');
  console.warn('-------');
  console.warn(`Total: ${summary.total}`);
  console.warn(`Success: ${summary.success}`);
  console.warn(`Success Rate: ${summary.successRate}%`);
  console.warn(`Average Latency: ${summary.avgLatencyMs}ms`);
  console.warn(`Average Word Count: ${summary.avgGeneratedWordCount}`);
  console.warn(`Average Completeness Score: ${summary.avgCompletenessScore}/3`);
  console.warn(`Modes: ${JSON.stringify(summary.modes)}`);
}

function validateRunArgs({ endpoint, local, dedupedUrls }) {
  if (!endpoint && !local) {
    console.error('Missing endpoint. Use --endpoint <url> or CONTENTFORGE_SCRAPE_TEST_ENDPOINT.');
    process.exit(1);
  }
  if (!dedupedUrls.length) {
    console.error('Provide at least one --url argument or use --urls-file <path>.');
    process.exit(1);
  }
}

async function run() {
  const { urls, endpoint, urlsFile, out, local } = parseArgs(process.argv);
  const expandedUrls = [...urls, ...(urlsFile ? readUrlsFromFile(urlsFile) : [])];
  const dedupedUrls = [...new Set(expandedUrls)];
  const startedAt = Date.now();

  validateRunArgs({ endpoint, local, dedupedUrls });

  if (local) console.warn('Testing in local mode via cms-functions.scrapeUrlForDraft');
  else console.warn(`Testing scrape endpoint: ${endpoint}`);
  if (urlsFile) console.warn(`Loaded URLs file: ${path.resolve(urlsFile)}`);
  console.warn(`URL count: ${dedupedUrls.length}`);

  const localScrapeFn = local ? require('./cms-functions').scrapeUrlForDraft : null;
  const options = { local, endpoint, localScrapeFn };

  const results = [];
  for (const url of dedupedUrls) {
    results.push(await processOneUrl(url, options));
  }

  const summary = buildSummary(results, { local, endpoint, urlsFile, dedupedUrls, startedAt });
  logSummary(summary);

  if (out) {
    const outputPath = path.resolve(out);
    fs.writeFileSync(
      outputPath,
      JSON.stringify({ generatedAt: new Date().toISOString(), summary, results }, null, 2),
      'utf8'
    );
    console.warn(`Wrote report: ${outputPath}`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
