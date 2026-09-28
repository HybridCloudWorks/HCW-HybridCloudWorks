/**
 * Finds text colours other than `text-primary-foreground` on a solid
 * `bg-primary` surface, in one parsed JS/JSX/TS module (2026-09-28).
 *
 * `src/primary-foreground.test.js` runs it over src/ and says why the rule
 * exists; `primary-surface-scan.test.js` holds what it catches and passes.
 *
 * WHAT COUNTS AS A CLASS STRING. Read from the parsed module, not with a
 * grep, because the pairings a grep misses are the ones that shipped:
 * string literals, template literals (each branch of a `${a ? 'x' : 'y'}`
 * inside one), conditionals, `&&`/`||`/`??`, `+`, and `cn`/`clsx`/`twMerge`
 * calls (each combination of their arguments, object keys included). Each
 * class string is read state by state (class-colour-states.mjs), so
 * `bg-card hover:bg-primary hover:text-white` is caught on hover.
 *
 * AND THE MARKUP INSIDE. An element that paints a solid `bg-primary` has its
 * JSX descendants checked too, down to the first one with a background of
 * its own: `<div className="bg-primary"><span className="text-black
 * dark:text-white">` was the icon tile on the news and listing pages.
 *
 * A translucent tint (`bg-primary/10`) is not a primary surface: the page
 * shows through it, and the text on it is chosen for the page.
 */
import { parseSync } from 'vite';
import { colourTokens, states } from './class-colour-states.mjs';

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

const SOLID_PRIMARY = /^primary$/;
const PRIMARY_FOREGROUND = /^(?:primary-foreground|\(--primary-foreground\))(?:\/\d+)?$/;

const isNode = (value) =>
  Boolean(value) && typeof value === 'object' && typeof value.type === 'string';

/** Walk an ESTree tree; a visitor returning false skips that node's subtree. */
function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!isNode(node) || visit(node) === false) return;
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') walk(value, visit);
  }
}

// ------------------------------------------------ what a class expression can be --

function unique(list) {
  const out = [...new Set(list)];
  if (out.length > MAX_COMBINATIONS) {
    throw new Error(`a class expression has over ${MAX_COMBINATIONS} combinations`);
  }
  return out;
}

/** Every pairing of a class string from `a` with one from `b`. */
const joinClasses = (a, b) =>
  unique(a.flatMap((x) => b.map((y) => [x, y].filter(Boolean).join(' '))));

/** Every class string a list of arguments or elements can produce together. */
const joinAll = (nodes) => nodes.reduce((acc, node) => joinClasses(acc, classValues(node)), ['']);

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

function templateValues(node) {
  const cooked = (i) => node.quasis[i].value.cooked ?? '';
  return node.expressions.reduce(
    (acc, expression, i) =>
      unique(
        acc.flatMap((head) =>
          classValues(expression).map((value) => `${head}${value}${cooked(i + 1)}`)
        )
      ),
    [cooked(0)]
  );
}

function logicalValues(node) {
  const left = node.operator === '&&' ? [''] : classValues(node.left);
  return unique([...left, ...classValues(node.right)]);
}

function concatenationValues(node) {
  if (node.operator !== '+') return [''];
  const right = classValues(node.right);
  return unique(classValues(node.left).flatMap((a) => right.map((b) => a + b)));
}

/** Nodes that only wrap an expression: `(a && 'b')`, `{…}` in JSX, `x as string`. */
const inner = (node) => classValues(node.expression);

const EVALUATORS = {
  Literal: (node) => [typeof node.value === 'string' ? node.value : ''],
  JSXExpressionContainer: inner,
  ParenthesizedExpression: inner,
  TSAsExpression: inner,
  TSSatisfiesExpression: inner,
  TSNonNullExpression: inner,
  TemplateLiteral: templateValues,
  ConditionalExpression: (node) =>
    unique([...classValues(node.consequent), ...classValues(node.alternate)]),
  LogicalExpression: logicalValues,
  BinaryExpression: concatenationValues,
  CallExpression: (node) => (isClassHelper(node) ? joinAll(node.arguments) : ['']),
  ArrayExpression: (node) => joinAll(node.elements),
  // clsx({ 'bg-primary text-white': active }): each key may or may not apply.
  ObjectExpression: (node) =>
    node.properties.reduce((acc, property) => joinClasses(acc, ['', propertyKey(property)]), ['']),
};

/** Every class string an expression can produce; '' for anything it cannot know. */
export function classValues(node) {
  const evaluate = EVALUATORS[node?.type];
  return evaluate ? evaluate(node) : [''];
}

// ------------------------------------------------ what counts as an offence --

const isSolidPrimary = (colour) => SOLID_PRIMARY.test(colour ?? '');
const isForeignText = (colour) => colour !== null && !PRIMARY_FOREGROUND.test(colour);

/** `[state, text]` for every state that puts a non-foreground colour on solid primary. */
export function pairingOffences(classes) {
  return states(classes)
    .filter(({ bg, text }) => isSolidPrimary(bg) && isForeignText(text))
    .map(({ state, text }) => [state, text]);
}

/** Text colours a descendant of a primary surface sets, other than the foreground. */
const descendantOffences = (classes) =>
  colourTokens(classes)
    .text.filter(({ colour }) => isForeignText(colour))
    .map(({ variants, colour }) => [variants.join(':') || 'base', colour]);

/** Does this class string paint a solid primary surface when nothing is hovered or focused? */
const paintsPrimary = (classes) =>
  states(classes).some(({ state, bg }) => state === 'base' && isSolidPrimary(bg));

/** Does any of these class strings give the element a background of its own? */
const hasOwnSurface = (values) => values.some((classes) => colourTokens(classes).bg.length > 0);

// ------------------------------------------------ one module --

const CLASS_EXPRESSIONS = new Set([
  'TemplateLiteral',
  'ConditionalExpression',
  'LogicalExpression',
]);

function isClassExpression(node) {
  if (CLASS_EXPRESSIONS.has(node.type)) return true;
  if (node.type === 'Literal') return typeof node.value === 'string';
  if (node.type === 'BinaryExpression') return node.operator === '+';
  return isClassHelper(node);
}

/** Offences found in some class strings of a node, located at that node. */
const located = (node, values, find) =>
  values.flatMap((classes) =>
    find(classes).map(([state, text]) => ({
      start: node.start,
      end: node.end,
      state,
      text,
      classes,
    }))
  );

const classNameOf = (element) =>
  element.openingElement.attributes.find(
    (attribute) => attribute.type === 'JSXAttribute' && attribute.name?.name === 'className'
  )?.value;

/** Offences in the markup inside an element that paints solid primary. */
function markupOffences(element) {
  if (!classValues(classNameOf(element)).some(paintsPrimary)) return [];
  const found = [];
  walk(element.children, (child) => {
    if (child.type !== 'JSXElement') return true;
    const values = classValues(classNameOf(child));
    // A descendant with a background of its own is its own surface.
    if (hasOwnSurface(values)) return false;
    found.push(...located(child, values, descendantOffences));
    return true;
  });
  return found;
}

const within = (a, b) => a.start >= b.start && a.end <= b.end;
const smaller = (a, b) => a.end - a.start < b.end - b.start;
const sameOffence = (a, b) => a.state === b.state && a.text === b.text;

/** Keep each offence at the innermost node that has it: a literal inside a `cn()` is named once. */
const innermost = (found) =>
  found.filter((f) => !found.some((g) => within(g, f) && smaller(g, f) && sameOffence(g, f)));

/** Every offence in one module: `{ line, state, text, classes }`, one per line and pairing. */
export function offencesIn(source, filename) {
  const { program, errors } = parseSync(filename, source);
  if (errors.length) throw new Error(`${filename} did not parse: ${errors[0].message}`);
  const found = [];
  walk(program, (node) => {
    if (isClassExpression(node)) found.push(...located(node, classValues(node), pairingOffences));
    if (node.type === 'JSXElement') found.push(...markupOffences(node));
    return true;
  });
  const lineOf = (offset) => source.slice(0, offset).split('\n').length;
  const byKey = new Map();
  for (const { start, state, text, classes } of innermost(found)) {
    const line = lineOf(start);
    byKey.set(`${line}|${state}|${text}`, { line, state, text, classes });
  }
  return [...byKey.values()];
}
