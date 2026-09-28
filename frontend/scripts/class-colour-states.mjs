/**
 * What a Tailwind class string paints, state by state (2026-09-28): the
 * background colour and the text colour in the plain state and in every
 * variant chain the string uses (`hover:`, `group-hover:`, `dark:`, `md:` ...).
 * Used by primary-surface-scan.mjs.
 *
 * A token applies in a state when the state has all of its variants, and the
 * most specific one wins, so in `bg-card hover:bg-primary text-white` the
 * hover state is `bg-primary` with `text-white`. Sizes and alignment
 * (`text-sm`, `text-center`, `text-[13px]`) are not colours, and neither are
 * the background utilities that set an image, a position or a size.
 */

const NOT_A_BACKGROUND_COLOUR =
  /^bg-(?:gradient-|linear-|radial|conic|none$|cover$|contain$|auto$|fixed$|local$|scroll$|clip-|origin-|repeat|no-repeat$|blend-|center$|top|bottom|left|right|size-|position-|\[url|\[length)/;
const NOT_A_TEXT_COLOUR =
  /^text-(?:xs|sm|base|lg|[2-9]?xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|shadow\b.*|\[\d.*\]|\[length:.*\]|\(length:.*\))$/;

/** A colon that separates variants: not one inside `[...]` or `(...)`. */
const VARIANT_COLON = /:(?![^[(]*[\])])/;

/** `hover:dark:!bg-primary` → { variants: ['hover', 'dark'], utility: 'bg-primary' }. */
function parseToken(token) {
  const variants = token.split(VARIANT_COLON);
  const utility = variants.pop().replace(/^!|!$/g, '');
  return { variants, utility };
}

/** The colour a utility sets with this prefix, or null when it sets none. */
const colourOf = (utility, prefix, notAColour) =>
  utility.startsWith(prefix) && !notAColour.test(utility) ? utility.slice(prefix.length) : null;

/** The background and text colour tokens in a class string, each with its variants. */
export function colourTokens(classes) {
  const tokens = classes.split(/\s+/).filter(Boolean).map(parseToken);
  const colours = (prefix, notAColour) =>
    tokens
      .map(({ variants, utility }) => ({ variants, colour: colourOf(utility, prefix, notAColour) }))
      .filter((token) => token.colour !== null);
  return {
    bg: colours('bg-', NOT_A_BACKGROUND_COLOUR),
    text: colours('text-', NOT_A_TEXT_COLOUR),
  };
}

/** The colour that applies in a state: the most specific token whose variants the state has. */
function applying(tokens, state) {
  const best = tokens
    .filter((token) => token.variants.every((variant) => state.includes(variant)))
    .reduce(
      (winner, token) => (token.variants.length >= (winner?.variants.length ?? 0) ? token : winner),
      null
    );
  return best?.colour ?? null;
}

/** Each state a class string styles: `{ state, bg, text }`, 'base' for the plain state. */
export function states(classes) {
  const { bg, text } = colourTokens(classes);
  const chains = new Map([['', []]]);
  for (const token of [...bg, ...text]) chains.set(token.variants.join(':'), token.variants);
  return [...chains].map(([chain, state]) => ({
    state: chain || 'base',
    bg: applying(bg, state),
    text: applying(text, state),
  }));
}
