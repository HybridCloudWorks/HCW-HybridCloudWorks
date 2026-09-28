// @vitest-environment node
/**
 * Text on a solid `bg-primary` surface is `text-primary-foreground`, and that
 * pair is readable in every scope and both themes (2026-09-28).
 *
 * THE BUG. `--primary` is not one colour. On the light theme it is near-black;
 * on the dark theme it is WHITE (index.css, `.dark`); inside a provider's
 * pages (`.theme-azure` and the rest, set on the app wrapper by App.jsx) it is
 * that provider's colour on both themes. So `bg-primary text-white` is a
 * blank white box on any dark page outside a provider scope — two buttons in
 * components/labs were exactly that until #767 — and `bg-primary
 * text-foreground` is dark on dark on the light theme and white on white on
 * the dark one. The only text colour defined to read on `--primary` wherever
 * it is is `--primary-foreground`, because each scope sets the two together.
 *
 * TWO HALVES, AND THE SECOND DEPENDS ON THE FIRST.
 *   1. The tokens: in each scope and theme, `--primary-foreground` on
 *      `--primary` must meet WCAG AA for normal text (4.5:1). Before this
 *      test, two did not: AWS paired its darkened orange with black (4.30:1)
 *      and FinOps paired its green with white (3.01:1). Both were changed.
 *   2. The source: every class string in src/ that puts text on a solid
 *      `bg-primary` must use `text-primary-foreground`. With half 1 holding,
 *      that pairing is readable wherever the element happens to render.
 *
 * WHAT COUNTS AS A CLASS STRING. Read from the parsed module, not with a
 * grep, because the pairings a grep misses are the ones that shipped: every
 * string literal, every template literal (each branch of a `${a ? 'x' : 'y'}`
 * inside it), and every `cn`/`clsx`/`twMerge` call (each combination of its
 * arguments). Each class string is checked per state: the plain state and
 * every variant it uses (`hover:`, `group-hover:`, `dark:`, `md:` ...), so
 * `bg-card hover:bg-primary hover:text-white` is caught on hover.
 *
 * AND THE MARKUP INSIDE. An element that paints a solid `bg-primary` has its
 * JSX descendants checked too, down to the first one with a background of its
 * own: `<div className="bg-primary"><span className="text-black
 * dark:text-white">` was the icon tile on the news and listing pages.
 *
 * WHAT IS ALLOWED. A translucent tint, `bg-primary/10`, is not a primary
 * surface: it is the page showing through, and the text on it is chosen for
 * the page. Sizes and alignment (`text-sm`, `text-center`) are not colours.
 * ALLOWED below takes exceptions, each with its reason; it is empty, and an
 * entry nothing matches any more fails the test, so it can only shrink.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import postcss from 'postcss';
import { parseSync } from 'vite';
import { describe, expect, it } from 'vitest';
import { CANONICAL_PROVIDERS } from '@/lib/providers';

const SRC = join(process.cwd(), 'src');

/** WCAG 2.2 AA, normal-size text. */
const AA = 4.5;

// ---------------------------------------------------------------- tokens --

/** hsl(h s% l%) as index.css writes the components, to relative luminance. */
function luminance(hsl) {
  const match = String(hsl).match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!match) throw new Error(`not an "h s% l%" value: ${hsl}`);
  const [h, s, l] = [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
  const a = s * Math.min(l, 1 - l);
  const channel = (n) => {
    const k = (n + h / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `--primary` and `--primary-foreground` per selector, the later declaration winning. */
function primaryTokensBySelector(css) {
  const bySelector = {};
  postcss.parse(css).walkDecls(/^--primary(?:-foreground)?$/, (decl) => {
    if (decl.parent.type !== 'rule') return;
    for (const selector of decl.parent.selectors) {
      bySelector[selector.trim()] ??= {};
      bySelector[selector.trim()][decl.prop] = decl.value.trim();
    }
  });
  return bySelector;
}

/**
 * The pair each scope resolves to on each theme. `.dark` is on <html>; a
 * provider's `.theme-*` is on the app wrapper inside it, so the provider's own
 * declaration is the nearer one and wins on both themes unless a
 * `.dark .theme-*` rule sets it again.
 */
function resolvedPairs(bySelector) {
  const pick = (...selectors) => {
    const merged = {};
    for (const selector of selectors.reverse()) Object.assign(merged, bySelector[selector]);
    return [merged['--primary'], merged['--primary-foreground']];
  };
  const pairs = [
    ['site, light', pick(':root')],
    ['site, dark', pick('.dark', ':root')],
  ];
  for (const provider of CANONICAL_PROVIDERS) {
    const scope = `.theme-${provider}`;
    pairs.push([`${provider}, light`, pick(scope, ':root')]);
    pairs.push([`${provider}, dark`, pick(`.dark ${scope}`, scope, '.dark', ':root')]);
  }
  return pairs;
}

const TOKENS = primaryTokensBySelector(readFileSync(join(SRC, 'index.css'), 'utf8'));

describe('--primary-foreground on --primary', () => {
  it('reads both tokens from the site scopes and from every provider scope', () => {
    for (const selector of [':root', '.dark', ...CANONICAL_PROVIDERS.map((p) => `.theme-${p}`)]) {
      expect(Object.keys(TOKENS[selector] ?? {}).sort(), selector).toEqual([
        '--primary',
        '--primary-foreground',
      ]);
    }
  });

  it.each(resolvedPairs(TOKENS))('meets AA in the %s scope', (_, [primary, foreground]) => {
    const ratio = contrast(primary, foreground);
    expect(
      ratio,
      `--primary ${primary} / --primary-foreground ${foreground} is ${ratio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(AA);
  });

  it('computes contrast the way WCAG does', () => {
    expect(contrast('0 0% 100%', '0 0% 0%')).toBeCloseTo(21, 5);
    // rgb(0, 125, 184), the Azure scope's primary: 4.54:1 against white in Chromium.
    expect(contrast('199 100% 36%', '0 0% 100%')).toBeCloseTo(4.54, 1);
  });
});

// ---------------------------------------------------------------- source --

/**
 * Exceptions: `{ file, classes, reason }`, where `classes` is a substring of
 * the offending class string. Empty: every pairing in src/ was fixable.
 */
const ALLOWED = Object.freeze([]);

const SOURCE = /\.(?:jsx?|tsx?)$/;
const TEST = /\.(?:test|spec)\.|\.fixture\./;
const CLASS_HELPERS = new Set([
  'cn',
  'clsx',
  'classnames',
  'classNames',
  'cx',
  'twMerge',
  'twJoin',
]);
/** Enough for every class expression in src/; a larger one is simplified, not skipped. */
const MAX_COMBINATIONS = 512;

function walkFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walkFiles(path) : [path];
  });
}

/** Walk an ESTree tree; a visitor returning false skips that node's subtree. */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (typeof node.type === 'string' && visit(node) === false) return;
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'type' && value && typeof value === 'object') walk(value, visit);
  }
}

const unique = (list) => {
  const out = [...new Set(list)];
  if (out.length > MAX_COMBINATIONS) {
    throw new Error(`a class expression has over ${MAX_COMBINATIONS} combinations`);
  }
  return out;
};
const joinClasses = (a, b) =>
  unique(a.flatMap((x) => b.map((y) => [x, y].filter(Boolean).join(' '))));
const isClassHelper = (node) =>
  node.type === 'CallExpression' &&
  node.callee?.type === 'Identifier' &&
  CLASS_HELPERS.has(node.callee.name);

/** An object key written as a name or a string; '' for a computed one. */
function propertyKey(property) {
  if (property.key?.type === 'Literal') return String(property.key.value);
  if (property.key?.type === 'Identifier' && !property.computed) return property.key.name;
  return '';
}

/** Every class string an expression can produce; '' for anything it cannot know. */
function classValues(node) {
  switch (node?.type) {
    case 'Literal':
      return [typeof node.value === 'string' ? node.value : ''];
    case 'JSXExpressionContainer':
      return classValues(node.expression);
    case 'TemplateLiteral':
      return node.expressions.reduce(
        (acc, expression, i) =>
          unique(
            acc.flatMap((head) =>
              classValues(expression).map(
                (value) => `${head}${value}${node.quasis[i + 1].value.cooked ?? ''}`
              )
            )
          ),
        [node.quasis[0].value.cooked ?? '']
      );
    case 'ConditionalExpression':
      return unique([...classValues(node.consequent), ...classValues(node.alternate)]);
    case 'LogicalExpression':
      return node.operator === '&&'
        ? unique(['', ...classValues(node.right)])
        : unique([...classValues(node.left), ...classValues(node.right)]);
    case 'BinaryExpression':
      return node.operator === '+'
        ? unique(classValues(node.left).flatMap((a) => classValues(node.right).map((b) => a + b)))
        : [''];
    case 'CallExpression':
      return isClassHelper(node)
        ? node.arguments.reduce((acc, arg) => joinClasses(acc, classValues(arg)), [''])
        : [''];
    case 'ArrayExpression':
      return node.elements.reduce((acc, element) => joinClasses(acc, classValues(element)), ['']);
    case 'ObjectExpression':
      // clsx({ 'bg-primary text-white': active }): each key may or may not apply.
      return node.properties.reduce(
        (acc, property) => joinClasses(acc, ['', propertyKey(property)]),
        ['']
      );
    default:
      return [''];
  }
}

/** `hover:dark:!bg-primary` → { variants: ['hover', 'dark'], utility: 'bg-primary' }. */
function parseToken(token) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of token) {
    if (ch === '[' || ch === '(') depth += 1;
    if (ch === ']' || ch === ')') depth -= 1;
    if (ch === ':' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  return { variants: parts, utility: current.replace(/^!|!$/g, '') };
}

const NOT_A_BACKGROUND_COLOUR =
  /^bg-(?:gradient-|linear-|radial|conic|none$|cover$|contain$|auto$|fixed$|local$|scroll$|clip-|origin-|repeat|no-repeat$|blend-|center$|top|bottom|left|right|size-|position-|\[url|\[length)/;
const NOT_A_TEXT_COLOUR =
  /^text-(?:xs|sm|base|lg|[2-9]?xl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|shadow\b.*|\[\d.*\]|\[length:.*\]|\(length:.*\))$/;

/** The background and text colour tokens in a class string. */
function colourTokens(classes) {
  const bg = [];
  const text = [];
  for (const token of classes.split(/\s+/).filter(Boolean)) {
    const { variants, utility } = parseToken(token);
    if (utility.startsWith('bg-') && !NOT_A_BACKGROUND_COLOUR.test(utility)) {
      bg.push({ variants, colour: utility.slice(3) });
    } else if (utility.startsWith('text-') && !NOT_A_TEXT_COLOUR.test(utility)) {
      text.push({ variants, colour: utility.slice(5) });
    }
  }
  return { bg, text };
}

/** The token that applies in a state: the most specific whose variants the state has. */
function applying(tokens, state) {
  let best = null;
  for (const token of tokens) {
    const applies = token.variants.every((variant) => state.includes(variant));
    if (applies && (!best || token.variants.length >= best.variants.length)) best = token;
  }
  return best?.colour ?? null;
}

/** Each state a class string styles, with the background and text colour it has there. */
function states(classes) {
  const { bg, text } = colourTokens(classes);
  const chains = new Set(['', ...[...bg, ...text].map((token) => token.variants.join(':'))]);
  return [...chains].map((chain) => {
    const state = chain ? chain.split(':') : [];
    return { state: chain || 'base', bg: applying(bg, state), text: applying(text, state) };
  });
}

const SOLID_PRIMARY = /^primary$/;
const PRIMARY_FOREGROUND = /^(?:primary-foreground|\(--primary-foreground\))(?:\/\d+)?$/;

/** `[state, text]` for every state that puts a non-foreground colour on solid primary. */
function pairingOffences(classes) {
  return states(classes)
    .filter(
      ({ bg, text }) => bg && SOLID_PRIMARY.test(bg) && text && !PRIMARY_FOREGROUND.test(text)
    )
    .map(({ state, text }) => [state, text]);
}

/** Text colours a descendant of a primary tile sets, other than the foreground. */
function descendantOffences(classes) {
  return colourTokens(classes)
    .text.filter(({ colour }) => !PRIMARY_FOREGROUND.test(colour))
    .map(({ variants, colour }) => [variants.join(':') || 'base', colour]);
}

const className = (element) =>
  element.openingElement.attributes.find(
    (attribute) => attribute.type === 'JSXAttribute' && attribute.name?.name === 'className'
  )?.value;

/** Does this class string paint a solid primary surface when nothing is hovered or focused? */
const paintsPrimary = (classes) =>
  states(classes).some(({ state, bg }) => state === 'base' && bg && SOLID_PRIMARY.test(bg));

/**
 * Every offence in one module: `{ line, state, text, classes }`. Class
 * expressions are evaluated wherever they are, innermost reported, so a
 * literal inside a `cn()` is named once, at its own line.
 */
function offencesIn(source, filename) {
  const { program, errors } = parseSync(filename, source);
  if (errors.length) throw new Error(`${filename} did not parse: ${errors[0].message}`);
  const lineOf = (offset) => source.slice(0, offset).split('\n').length;
  const found = [];
  const record = (node, [state, text], classes) =>
    found.push({
      start: node.start,
      end: node.end,
      line: lineOf(node.start),
      state,
      text,
      classes,
    });

  walk(program, (node) => {
    const isClassExpression =
      (node.type === 'Literal' && typeof node.value === 'string') ||
      node.type === 'TemplateLiteral' ||
      node.type === 'ConditionalExpression' ||
      node.type === 'LogicalExpression' ||
      (node.type === 'BinaryExpression' && node.operator === '+') ||
      isClassHelper(node);
    if (isClassExpression) {
      for (const classes of classValues(node)) {
        for (const offence of pairingOffences(classes)) record(node, offence, classes);
      }
    }
    if (node.type === 'JSXElement' && classValues(className(node)).some(paintsPrimary)) {
      walk(node.children, (child) => {
        if (child.type !== 'JSXElement') return true;
        const childClasses = classValues(className(child));
        // A descendant with a background of its own is its own surface.
        if (childClasses.some((classes) => colourTokens(classes).bg.length)) return false;
        for (const classes of childClasses) {
          for (const offence of descendantOffences(classes)) record(child, offence, classes);
        }
        return true;
      });
    }
    return true;
  });

  const inner = found.filter(
    (f) =>
      !found.some(
        (g) =>
          g !== f &&
          g.start >= f.start &&
          g.end <= f.end &&
          g.end - g.start < f.end - f.start &&
          g.state === f.state &&
          g.text === f.text
      )
  );
  const seen = new Set();
  return inner
    .filter((f) => {
      const key = `${f.line}|${f.state}|${f.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ line, state, text, classes }) => ({ line, state, text, classes }));
}

const allowed = (file, offence) =>
  ALLOWED.some((entry) => entry.file === file && offence.classes.includes(entry.classes));

const describeOffence = (file, { line, state, text }) =>
  `${file}:${line} ${state === 'base' ? '' : `${state}: `}bg-primary with text-${text} (use text-primary-foreground)`;

describe('the scan itself', () => {
  const scan = (source) =>
    offencesIn(source, 'probe.jsx').map(({ state, text }) => `${state} text-${text}`);

  it.each([
    ["const c = 'px-4 bg-primary text-white';", ['base text-white']],
    ["const c = 'bg-primary hover:bg-primary/80 text-white';", ['base text-white']],
    [
      "const c = 'bg-card/60 hover:bg-primary hover:text-white text-foreground';",
      ['hover text-white'],
    ],
    ["const c = 'bg-card text-white hover:bg-primary';", ['hover text-white']],
    ["const c = 'group-hover:bg-primary group-hover:text-white';", ['group-hover text-white']],
    ["const c = 'bg-primary text-foreground';", ['base text-foreground']],
    ["const c = 'bg-primary text-black';", ['base text-black']],
    ["const c = 'bg-primary text-primary-foreground dark:text-white';", ['dark text-white']],
    ["const c = '!bg-primary text-white';", ['base text-white']],
    ['const c = `px-2 ${on ? `bg-primary` : `bg-card`} text-white`;', ['base text-white']],
    ["const c = cn('rounded bg-primary', on && 'text-white');", ['base text-white']],
    ["const c = clsx({ 'bg-primary': on }, 'text-white');", ['base text-white']],
    [
      'const T = () => <div className="bg-primary p-3"><span className="text-black dark:text-white">i</span></div>;',
      ['base text-black', 'dark text-white'],
    ],
    [
      'const T = () => <div className="bg-primary">{items.map((i) => <b key={i} className="text-white">{i}</b>)}</div>;',
      ['base text-white'],
    ],
    [
      'const T = () => <a className="bg-primary text-primary-foreground"><span className="text-slate-500">x</span></a>;',
      ['base text-slate-500'],
    ],
  ])('catches %s', (source, expected) => {
    expect(scan(source)).toEqual(expected);
  });

  it.each([
    "const c = 'bg-primary text-primary-foreground hover:bg-primary/90';",
    "const c = 'bg-primary px-4 text-sm text-center font-bold text-primary-foreground/80';",
    "const c = 'bg-primary/10 text-white';",
    "const c = 'bg-primary/15 text-primary';",
    "const c = 'bg-card/60 hover:bg-primary hover:text-primary-foreground text-foreground';",
    "const c = on ? 'bg-primary text-primary-foreground' : 'bg-card text-white';",
    "const c = 'bg-primary-foreground text-white';",
    "const c = 'w-1 h-6 bg-primary rounded-full';",
    "const c = 'bg-primary text-(--primary-foreground)';",
    'const T = () => <div className="bg-primary"><span className="bg-card text-white">x</span></div>;',
    'const T = () => <div className="bg-primary text-primary-foreground"><span className="text-primary-foreground/70">x</span></div>;',
    'const T = () => <div className="bg-card hover:bg-primary"><span className="text-slate-500">x</span></div>;',
  ])('passes %s', (source) => {
    expect(scan(source)).toEqual([]);
  });
});

describe('solid bg-primary in src/', () => {
  const files = walkFiles(SRC)
    .map((path) => relative(SRC, path).replace(/\\/g, '/'))
    .filter((file) => SOURCE.test(file) && !TEST.test(file))
    .sort();
  const offences = Object.fromEntries(
    files.map((file) => [file, offencesIn(readFileSync(join(SRC, file), 'utf8'), file)])
  );

  it('scans the whole tree, the pages that had the pairing included', () => {
    expect(files.length).toBeGreaterThan(400);
    expect(files).toContain('components/shared/ProviderBlogPage.jsx');
    expect(files).toContain('pages/azure/EducationPage.jsx');
    expect(files).toContain('components/accessibility/AccessibleButton.tsx');
  });

  it('puts only text-primary-foreground on a solid primary surface', () => {
    const report = Object.entries(offences).flatMap(([file, list]) =>
      list.filter((offence) => !allowed(file, offence)).map((o) => describeOffence(file, o))
    );
    expect(report).toEqual([]);
  });

  it('has no allowance that nothing needs any more', () => {
    for (const entry of ALLOWED) {
      expect(entry.reason, `${entry.file}: every allowance says why`).toMatch(/\S/);
      expect(
        (offences[entry.file] ?? []).some((offence) => offence.classes.includes(entry.classes)),
        `${entry.file} no longer pairs "${entry.classes}": remove it from ALLOWED`
      ).toBe(true);
    }
  });
});
