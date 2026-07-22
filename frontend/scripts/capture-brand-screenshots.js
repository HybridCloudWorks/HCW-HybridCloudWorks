const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const outDir = path.resolve(process.cwd(), 'screenshots');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const pages = [
    { url: 'https://hybridcloudworks.com', name: 'homepage' },
    { url: 'https://hybridcloudworks.com/privacy-policy', name: 'privacy-policy' },
    { url: 'https://hybridcloudworks.com/__/auth/handler', name: 'auth-handler' },
  ];

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  for (const p of pages) {
    const outFile = path.join(outDir, `${p.name}.png`);
    try {
      console.log(`Visiting ${p.url}`);
      const resp = await page.goto(p.url, { waitUntil: 'networkidle', timeout: 30000 });
      const status = resp ? resp.status() : 'no-response';
      console.log(`Status ${status} — saving ${outFile}`);
      await page.screenshot({ path: outFile, fullPage: true });
    } catch (err) {
      console.error(`Error visiting ${p.url}: ${String(err.message || err)}`);
      const errFile = path.join(outDir, `${p.name}-error.png`);
      try {
        await page.screenshot({ path: errFile, fullPage: true });
      } catch (e) {}
    }
  }

  await browser.close();
  console.log('Screenshots saved to', outDir);
})();
