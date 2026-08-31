/**
 * The one place author-written HTML is sanitized.
 *
 * WHY A SHARED MODULE AND NOT THREE `DOMPurify.sanitize` CALLS. The three call
 * sites — RichTextBody and BlogDetailTemplate's two markdown/HTML branches —
 * render the same class of content: prose an author typed into the CMS. Three
 * bare calls means three configurations that can drift, and the drift is
 * invisible: a weaker one still renders the page.
 *
 * WHAT THIS ADDS OVER THE DEFAULT CONFIGURATION: protection against DOM
 * clobbering. DOMPurify's defaults strip `<script>` but keep `id` and `name` on
 * ordinary elements, so an author could write
 *
 *     <div id="some-id-the-app-looks-up">…</div>
 *
 * and `document.getElementById` would return THEIR element — it returns the
 * first match in document order, of any tag, and article bodies render inside
 * the app's own markup. That is not hypothetical here: it is how the
 * pre-render seed could be supplied by the article it belonged to, before the
 * seed moved onto the mount point (T-714, `scripts/prerender.mjs`).
 *
 * `SANITIZE_NAMED_PROPS` prefixes every `id` and `name` with `user-content-`,
 * which is GitHub's approach and better than forbidding them: nothing
 * disappears, the values simply cannot collide with the application's own.
 *
 * WHY THE HOOK. Prefixing `id` alone would break in-page anchors — `<a
 * href="#intro">` would no longer find `<h2 id="user-content-intro">`.
 * DOMPurify does not rewrite the link side; GitHub does it themselves, and so
 * does this. The result is that a document's internal links keep working
 * exactly as written, which is what makes this change carry no behavioural
 * cost to weigh.
 *
 * Markdown bodies do not reach here at all — `react-markdown` builds elements
 * rather than HTML, and React escapes text. There is no `rehype-slug` in the
 * pipeline, so markdown headings carry no ids and never had anchors to keep.
 */
import DOMPurify from 'dompurify';

/** GitHub's prefix, for the same reason: it reads as "this came from a user". */
export const USER_CONTENT_PREFIX = 'user-content-';

/**
 * Installed on first use rather than at import.
 *
 * The pre-render imports these components in Node, where `dompurify` is only
 * usable after `scripts/prerender.mjs` has installed a jsdom window
 * (`prerender.mjs` names DOMPurify as the reason it does). Adding the hook at
 * module scope would run before that shim on any import-order change; doing it
 * on the first `sanitizeHtml` call cannot.
 */
let hookInstalled = false;

function installFragmentLinkHook() {
  if (hookInstalled) return;
  hookInstalled = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName !== 'A') return;
    const href = node.getAttribute('href');

    // `#` alone is a top-of-page link with no target to follow; an external URL
    // carrying a fragment resolves against a document this prefix does not
    // apply to. Only a same-document fragment is rewritten.
    if (!href || href.length < 2 || href[0] !== '#') return;
    if (href.startsWith(`#${USER_CONTENT_PREFIX}`)) return;

    node.setAttribute('href', `#${USER_CONTENT_PREFIX}${href.slice(1)}`);
  });
}

/**
 * Sanitize author-written HTML for `dangerouslySetInnerHTML`.
 *
 * Returns a string. A non-string input is coerced, so a null body renders as
 * empty rather than as the word "null".
 */
export function sanitizeHtml(dirty) {
  installFragmentLinkHook();
  return DOMPurify.sanitize(String(dirty ?? ''), { SANITIZE_NAMED_PROPS: true });
}

export default sanitizeHtml;
