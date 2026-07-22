const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const base = 'http://127.0.0.1:5175';
  const providers = ['aws', 'azure', 'gcp', 'finops'];
  const results = [];

  const browser = await chromium.launch({ headless: true });

  for (const provider of providers) {
    const page = await browser.newPage();
    const result = {
      provider,
      route: `/${provider}/frameworks`,
      status: 'ok',
      frameworkMapVisible: false,
      conceptButtonCount: 0,
      oneSelectionMode: null,
      twoSelectionMode: null,
      oneSelectionCardCount: 0,
      twoSelectionCardCount: 0,
      notes: '',
    };

    try {
      await page.goto(`${base}/${provider}/frameworks`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(1200);

      const mapHeading = page.getByRole('heading', { name: 'Framework Map' });
      result.frameworkMapVisible = (await mapHeading.count()) > 0;

      if (!result.frameworkMapVisible) {
        const noContentText = page.getByText(/No published frameworks found/i);
        if ((await noContentText.count()) > 0) {
          result.status = 'no-data';
          result.notes = 'No published framework docs available for this provider.';
        } else {
          result.status = 'failed';
          result.notes = 'Framework map section not found.';
        }
        results.push(result);
        await page.close();
        continue;
      }

      const conceptButtons = page
        .locator('button')
        .filter({ has: page.locator('div.text-sm.font-semibold.text-white') });

      result.conceptButtonCount = await conceptButtons.count();

      if (result.conceptButtonCount < 1) {
        result.status = 'failed';
        result.notes = 'No concept buttons found in framework map.';
        results.push(result);
        await page.close();
        continue;
      }

      await conceptButtons.nth(0).click();
      await page.waitForTimeout(250);

      const selectionModeText1 = await page.locator('text=/Selection mode:/').first().textContent();
      result.oneSelectionMode = (selectionModeText1 || '').trim();

      const oneCards = page
        .locator('section.space-y-4 div.grid.gap-4 > div')
        .filter({ has: page.locator('h3, h2, .text-lg') });
      result.oneSelectionCardCount = await oneCards.count();

      if (result.conceptButtonCount >= 2) {
        await conceptButtons.nth(1).click();
        await page.waitForTimeout(250);

        const selectionModeText2 = await page
          .locator('text=/Selection mode:/')
          .first()
          .textContent();
        result.twoSelectionMode = (selectionModeText2 || '').trim();

        const twoCards = page
          .locator('section.space-y-4 div.grid.gap-4 > div')
          .filter({ has: page.locator('h3, h2, .text-lg') });
        result.twoSelectionCardCount = await twoCards.count();
      } else {
        result.status = 'partial';
        result.notes = 'Only one concept available, two-selection not testable.';
      }

      if (
        result.oneSelectionMode &&
        result.oneSelectionMode.toLowerCase().includes('1-column') &&
        (result.twoSelectionMode
          ? result.twoSelectionMode.toLowerCase().includes('2-column')
          : true)
      ) {
        if (result.status === 'ok') {
          result.notes = 'Selection mode text updated correctly for one and two selection.';
        }
      } else if (result.status === 'ok') {
        result.status = 'partial';
        result.notes = 'Selection mode text did not match expected one/two-column labels.';
      }
    } catch (error) {
      result.status = 'error';
      result.notes = String(error.message || error).slice(0, 300);
    }

    results.push(result);
    await page.close();
  }

  await browser.close();

  const outPath = path.resolve(__dirname, 'smoke-frameworks-output.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
})();
