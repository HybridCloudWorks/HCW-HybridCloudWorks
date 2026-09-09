/**
 * prompt-fence.js — the delimiters that separate instruction from material in
 * a prompt, and the one function that keeps material from closing them.
 *
 * WHY THIS IS ITS OWN MODULE. The fence was born in
 * `listen-and-learn/article-script.js` (#435) and was reused from there by the
 * AI router for source grounding (#433). That import pulled the whole article
 * module — and its own imports, `script.js` and `public-reads.js` — into the
 * router's module graph, which every function that touches a model loads on
 * cold start, and it made the generic router depend on one feature. Copilot's
 * review of PR #445 named both. So the fence lives here, with NO imports of its
 * own, and both sides import it. `article-script.js` re-exports the three names
 * unchanged, because other Listen & Learn modules import them from there.
 *
 * WHAT THE FENCE IS FOR. Text a model is asked to work from — an article, a
 * fetched page, a transcript — is untrusted input even when it is our own:
 * ContentForge drafts from external sources, an article about prompt injection
 * would quote the very phrases the prompt guards against, and a web page can
 * say anything. The defence has two halves. The prompt states that everything
 * between the markers is data, never instruction — that sentence belongs to
 * each prompt, beside its other rules. And the material itself passes through
 * `fenceArticleText`, which neutralises any copy of the markers it carries,
 * because a fence the source can close is not a fence. The neutralised form
 * keeps the words and loses one angle bracket on each side, so a reader can
 * still see what the source contained.
 *
 * The delimiter names keep their ARTICLE spelling: they are exported under
 * those names from `article-script.js`, and the marker text is part of prompts
 * that tests pin. A rename would be churn with no safety gained.
 */

export const ARTICLE_OPEN = '<<<BEGIN ARTICLE>>>';
export const ARTICLE_CLOSE = '<<<END ARTICLE>>>';

/** Neutralise any delimiter the source carries, so it cannot break out. */
export function fenceArticleText(text) {
  return String(text || '')
    .split(ARTICLE_OPEN)
    .join('<<BEGIN ARTICLE>>')
    .split(ARTICLE_CLOSE)
    .join('<<END ARTICLE>>');
}
