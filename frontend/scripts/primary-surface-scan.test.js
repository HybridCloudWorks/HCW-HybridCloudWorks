// @vitest-environment node
/**
 * What primary-surface-scan.mjs catches and what it lets through. The rule
 * and the scan of src/ are in src/primary-foreground.test.js.
 */
import { parseSync } from 'vite';
import { describe, expect, it } from 'vitest';
import { classValues, offencesIn, pairingOffences } from './primary-surface-scan.mjs';

const scan = (source) =>
  offencesIn(source, 'probe.jsx').map(({ state, text }) => `${state} text-${text}`);

describe('offencesIn', () => {
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
    ["const c = cn('bg-primary', (on && 'text-white'));", ['base text-white']],
    ["const c = 'bg-primary ' + 'text-white';", ['base text-white']],
    ["const c = ['bg-primary', size ?? 'text-white'];", []],
    ["const c = clsx(['bg-primary', size ?? 'text-white']);", ['base text-white']],
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
    "const c = 'bg-primary text-[13px] text-primary-foreground';",
    'const T = () => <div className="bg-primary"><span className="bg-card text-white">x</span></div>;',
    'const T = () => <div className="bg-primary text-primary-foreground"><span className="text-primary-foreground/70">x</span></div>;',
    'const T = () => <div className="bg-card hover:bg-primary"><span className="text-slate-500">x</span></div>;',
  ])('passes %s', (source) => {
    expect(scan(source)).toEqual([]);
  });

  it('names an offence once, at the innermost node that has it', () => {
    const found = offencesIn("const c = cn(\n  'x',\n  'bg-primary text-white'\n);", 'probe.js');
    expect(found.map(({ line, text }) => [line, text])).toEqual([[3, 'white']]);
  });

  it('refuses a module it cannot parse rather than passing it', () => {
    expect(() => offencesIn('const = ;', 'broken.js')).toThrow(/did not parse/);
  });
});

/** The expression in `x = <code>;`, as the scan sees it. */
const expression = (code) => parseSync('probe.ts', `x = ${code};`).program.body[0].expression.right;

describe('the pieces', () => {
  it.each([
    ["`p-2 ${on ? 'a' : 'b'} c`", ['p-2 a c', 'p-2 b c']],
    ["cn('a', on && 'b', { c: x })", ['a', 'a c', 'a b', 'a b c']],
    ["cn('a', (on && 'b'))", ['a', 'a b']],
    ["(on ? 'a' : 'b') as string", ['a', 'b']],
    ["label ?? 'a'", ['', 'a']],
    ["'a ' + 'b'", ['a b']],
    ['someVariable', ['']],
    ["format('a')", ['']],
  ])('reads %s as %j', (code, expected) => {
    expect(classValues(expression(code))).toEqual(expected);
  });

  it.each([
    ['bg-primary md:bg-card text-white', [['base', 'white']]],
    ['bg-card md:bg-primary text-white', [['md', 'white']]],
    ['bg-primary text-primary-foreground hover:text-black', [['hover', 'black']]],
    ['bg-primary text-primary-foreground [&:hover]:text-white', [['[&:hover]', 'white']]],
    ['bg-primary text-primary-foreground dark:hover:!text-white', [['dark:hover', 'white']]],
    ['bg-primary text-(length:--size) text-primary-foreground', []],
    ['bg-[url(/a:b.png)] bg-primary text-primary-foreground', []],
    ['bg-cover bg-center text-white', []],
  ])('reads the states of %j', (classes, expected) => {
    expect(pairingOffences(classes)).toEqual(expected);
  });
});
