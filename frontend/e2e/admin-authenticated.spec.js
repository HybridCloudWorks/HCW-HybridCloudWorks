import { test, expect, STATUS_ANSWERS, STUB_USER } from './fixtures/entra.js';

/**
 * The admin portal, signed in (estate review 2026-10-06: QA-1, AP-F1, AP-F2).
 *
 * Every test here signs in the way a person does — open a route, press "Sign
 * in with Microsoft", come back — through the credential-free identity in
 * fixtures/entra.js. The bundle is the production code path built with the
 * placeholder configuration in fixtures/stub-build-env.js; the stub answers the
 * identity host and the API at the network boundary, and nothing in the
 * application knows it is under test.
 *
 * Each test names, in a comment, the change to the product that makes it fail.
 * A test that cannot fail is the defect QA-1 recorded. On 2026-10-07 each named
 * change was made to the source, the bundle rebuilt and the test run against
 * it: eleven made their test fail, and the one that did not is recorded where
 * it applies rather than claimed.
 */

/** The routes the phone shell is checked on (AP-F1 acceptance, QA-1). */
const PHONE_ROUTES = ['/admin', '/admin/queue', '/admin/platform', '/admin/health'];

/** Main-frame URLs, in order, so a test can see the journey and not only its end. */
function recordNavigations(page) {
  const urls = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(new URL(frame.url()));
  });
  return urls;
}

/**
 * Let the page settle, then return how many admin checks it made. A bound on
 * this is the regression check for the renewal loop fixed in entraAuth.js: an
 * `unknown` answer made the page re-check about 160 times a second.
 */
async function settledStatusCalls(page, identity) {
  await page.waitForTimeout(1500);
  return identity.statusRequests.length;
}

test.describe('signing in', () => {
  test('the callback lands on the route the person asked for, not the portal root', async ({
    page,
    identity,
  }) => {
    // Fails if: MSAL's return-to-start is turned off (`handleRedirectPromise`
    // with `navigateToLoginRequestUrl: false`; the callback page then sends
    // everyone to `/admin`), or the redirect URI stops being the callback
    // route. NOT if AuthCallbackPage's `/admin` fallback loses its pathname
    // check: run against that change on 2026-10-07 it still passed, because
    // MSAL 5 returns to the start page with a full navigation, so the page is
    // gone before the fallback line runs.
    const navigations = recordNavigations(page);
    await identity.signIn('/admin/platform');

    await expect(
      page.locator('#admin-main').getByRole('heading', { level: 1, name: 'Platform Settings Hub' })
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/admin/platform');
    // The authorization response is gone from the address bar and history.
    expect(page.url()).not.toContain('code=');

    // It really went through the callback, carrying the code.
    expect(
      navigations.some((url) => url.pathname === '/auth/callback' && url.hash.includes('code='))
    ).toBe(true);
    const [authorize] = identity.authorizeRequests;
    expect(new URL(authorize.redirect_uri).pathname).toBe('/auth/callback');
    expect(authorize.prompt).toBe('select_account');
    expect(authorize.scope.split(' ')).toContain('api://e2e-hcw-api/access_as_admin');

    // The token the identity host issued is the one the API was shown.
    expect(identity.statusRequests[0].authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(identity.authorizeRequests).toHaveLength(1);
  });

  test('a registry refusal shows the denial and nothing of the admin', async ({
    page,
    identity,
  }) => {
    // Fails if: the guard renders its children for a signed-in non-admin, the
    // denial card changes its copy, or a refusal is treated as an expired
    // session (a second trip to /authorize).
    identity.answerAdminStatus(STATUS_ANSWERS.notAdmin);
    await identity.signIn('/admin/queue');

    await expect(page.getByText('Access Denied')).toBeVisible();
    await expect(
      page.getByText(`${STUB_USER.email} is not authorized. Contact the site admin.`)
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bootstrap My Admin Access' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'ContentForge' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Content Queue' })).toHaveCount(0);
    expect(identity.authorizeRequests).toHaveLength(1);
  });

  test('a token without the admin scope shows the configuration card and does not retry', async ({
    page,
    identity,
  }) => {
    // The API's `WWW-Authenticate: Bearer error="insufficient_scope"`
    // (require-role.js). Fails if: useAdminAuth classifies it as a session
    // problem (it would redirect to /authorize, and come back refused again),
    // the card stops showing the API's description, or the renewal loop
    // returns (the status-call bound).
    identity.answerAdminStatus(STATUS_ANSWERS.insufficientScope);
    await identity.signIn('/admin/queue');

    await expect(page.getByText('Admin access is misconfigured')).toBeVisible();
    await expect(
      page.getByText('The access token is missing the access_as_admin scope.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in again' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'ContentForge' })).toHaveCount(0);

    expect(await settledStatusCalls(page, identity)).toBeLessThanOrEqual(4);
    expect(identity.authorizeRequests).toHaveLength(1);
  });

  test('an expired token leads to one re-authentication, once per tab, then an honest card', async ({
    page,
    identity,
  }) => {
    // The API's `WWW-Authenticate: Bearer error="invalid_token"`. Fails if:
    // the automatic re-authentication is removed (one trip to /authorize, not
    // two), the once-per-tab guard is removed (a redirect loop: more trips
    // and no card), or the renewal loop returns (the status-call bound). The
    // reload step also holds the guard to sessionStorage: a module variable
    // would forget across it (reasoned, not run as a mutation).
    identity.answerAdminStatus(STATUS_ANSWERS.invalidToken);
    await page.goto('/admin/queue');
    await page.getByRole('button', { name: /sign in with microsoft/i }).click();

    await expect(page.getByText('Could not verify your access')).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText('Your sign-in needs renewing before we can check your admin access.')
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in again' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/admin/queue');

    // One sign-in, then exactly one re-authentication: no account picker on
    // the second, because it renews the session it has rather than starting
    // a new one.
    expect(identity.authorizeRequests).toHaveLength(2);
    expect(identity.authorizeRequests[0].prompt).toBe('select_account');
    expect(identity.authorizeRequests[1].prompt).toBeUndefined();
    expect(identity.authorizeRequests[1].scope.split(' ')).toContain(
      'api://e2e-hcw-api/access_as_admin'
    );
    expect(await settledStatusCalls(page, identity)).toBeLessThanOrEqual(6);

    // Once per TAB: a reload is exactly when a module variable would reset.
    await page.reload();
    await expect(page.getByText('Could not verify your access')).toBeVisible();
    expect(identity.authorizeRequests).toHaveLength(2);
  });
});

test.describe('the collapsed rail on a desktop (AP-F2)', () => {
  test.skip(({ isMobile }) => isMobile, 'the rail is the desktop shell; a phone gets the drawer');

  test('shows each item its label on hover and on focus, unclipped, under its name', async ({
    page,
    identity,
  }) => {
    // Fails if: the label goes back to a title attribute (nothing is
    // rendered), it is positioned inside the nav's scroll container (the
    // point beside the rail is not the label), or it stops matching the name.
    await identity.signIn('/admin');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    const rail = page.getByRole('navigation', { name: 'ContentForge' });
    const queue = rail.getByRole('link', { name: /^Review Queue/ });
    const label = queue.getByText('Review Queue', { exact: true });
    await expect(label).toHaveCount(0);

    await queue.hover();
    await expect(label).toBeVisible();
    await expect(queue).toHaveAccessibleName(/^Review Queue/);
    // The label is outside the 64 px rail, and it is what the browser paints
    // there: a label clipped by the scroll container would not be hit.
    const box = await label.boundingBox();
    const railBox = await rail.boundingBox();
    expect(box.x + box.width / 2).toBeGreaterThan(railBox.x + railBox.width);
    const painted = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.textContent ?? '',
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    );
    expect(painted).toBe('Review Queue');

    await page.mouse.move(600, 600);
    await expect(label).toHaveCount(0);

    await queue.focus();
    await expect(label).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(label).toHaveCount(0);
  });
});

test.describe('the phone shell on a Pixel 5 (AP-F1)', () => {
  test.skip(({ isMobile }) => !isMobile, 'the drawer is the phone shell; mobile-chrome runs it');

  for (const route of PHONE_ROUTES) {
    test(`${route}: a full-width column, a drawer that opens and closes, no sideways scroll`, async ({
      page,
      identity,
    }) => {
      // Fails if: the rail comes back below md (the column drops to about
      // 263 px), the menu button goes, the drawer stops closing on Escape, or
      // anything on the page is wider than the phone.
      await identity.signIn(route);
      const column = page.locator('#admin-main');
      await expect(column.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'ContentForge' })).toBeHidden();

      const width = await column.evaluate((element) => element.getBoundingClientRect().width);
      expect(width).toBeGreaterThanOrEqual(340);

      const menuButton = page.getByRole('button', { name: 'Open menu' });
      await expect(menuButton).toBeVisible();
      await menuButton.click();
      const drawer = page.getByRole('dialog', { name: 'ContentForge' });
      await expect(drawer).toBeVisible();
      const menu = drawer.getByRole('navigation', { name: 'ContentForge menu' });
      await expect(menu.getByRole('link', { name: /^Review Queue/ })).toBeVisible();
      await expect(menu.getByText('Platform Settings', { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(menuButton).toBeFocused();

      const overflow = await page.evaluate(() => {
        const main = document.getElementById('admin-main');
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          column: main.scrollWidth - main.clientWidth,
        };
      });
      expect(overflow).toEqual({ page: 0, column: 0 });
    });
  }
});
