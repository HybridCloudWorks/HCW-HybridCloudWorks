const { chromium } = require('playwright');

(async () => {
  const base = 'http://localhost:5175';
  const providers = ['aws', 'azure', 'gcp', 'github', 'terraform', 'finops'];
  const routes = [];

  for (const provider of providers) {
    routes.push(`/${provider}/news`, `/${provider}/rss`, `/${provider}/blog`);
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const route of routes) {
    const page = await browser.newPage();
    const url = `${base}${route}`;
    let status = 'ok';
    let finalUrl = '';
    let title = '';
    let h1 = '';

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1200);
      finalUrl = page.url();
      title = await page.title();
      h1 = await page
        .locator('h1')
        .first()
        .innerText()
        .catch(() => '');

      if ((route.endsWith('/news') || route.endsWith('/rss')) && finalUrl.includes('/blog')) {
        status = 'redirected-to-blog';
      }
    } catch (error) {
      status = 'error';
      finalUrl = String(error.message).slice(0, 200);
    }

    results.push({
      route,
      status,
      finalUrl,
      title,
      h1: (h1 || '').slice(0, 120),
    });

    await page.close();
  }

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
})();
