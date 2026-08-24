import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeMxfile, parseMxGraphModel, parseDrawioFile } from './parseDrawio';

// jsdom rewrites import.meta.url to an http:// URL, so resolve from the repo
// root (vitest always runs there) rather than from this file.
const FIXTURE = readFileSync(
  join(process.cwd(), 'src/lib/drawio/__fixtures__/event-driven.drawio'),
  'utf8'
);

/** Compress a model the way the draw.io web app does: URI-encode → raw-deflate → base64. */
async function compressLikeDrawio(modelXml) {
  const encoded = new TextEncoder().encode(encodeURIComponent(modelXml));
  const stream = new Response(encoded).body.pipeThrough(new CompressionStream('deflate-raw'));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe('decodeMxfile', () => {
  it('reads the inline (desktop) form off a real export', async () => {
    const pages = await decodeMxfile(FIXTURE);
    expect(pages).toHaveLength(1);
    expect(pages[0].name).toBe('Page-1');
    expect(pages[0].xml).toContain('<mxGraphModel');
  });

  it('inflates the compressed (web) form, including the URI-decode step', async () => {
    const model =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="a" value="Hello World &amp; Friends" vertex="1" parent="1">' +
      '<mxGeometry x="10" y="20" width="30" height="40" as="geometry"/></mxCell>' +
      '</root></mxGraphModel>';
    const payload = await compressLikeDrawio(model);
    const pages = await decodeMxfile(
      `<mxfile><diagram id="d1" name="P">${payload}</diagram></mxfile>`
    );

    const { shapes } = parseMxGraphModel(pages[0].xml);
    // 'Hello World' proves decodeURIComponent ran — skipping it leaves 'Hello%20World',
    // which still parses as XML and would pass a laxer assertion.
    expect(shapes).toEqual([
      expect.objectContaining({ id: 'a', label: 'Hello World & Friends', absX: 10, absY: 20 }),
    ]);
  });

  it('rejects non-XML and files with no <diagram>', async () => {
    await expect(decodeMxfile('not xml at all <<<')).rejects.toThrow(/valid XML/);
    await expect(decodeMxfile('<mxfile></mxfile>')).rejects.toThrow(/<diagram>/);
    await expect(
      decodeMxfile('<mxfile><diagram id="d" name="P"></diagram></mxfile>')
    ).rejects.toThrow(/empty/);
  });
});

describe('parseMxGraphModel geometry', () => {
  it('resolves absolute position through nested containers', async () => {
    const { shapes } = await parseDrawioFile(FIXTURE);
    const byId = Object.fromEntries(shapes.map((s) => [s.id, s]));

    // svc-apigw sits in svc-group-apigw (60,80) inside aws-cloud (230,140), own (36,30).
    // Wrong parent handling cannot produce these numbers.
    expect(byId['svc-apigw']).toMatchObject({
      absX: 230 + 60 + 36,
      absY: 140 + 80 + 30,
      width: 48,
      height: 48,
      centerX: 230 + 60 + 36 + 24,
      centerY: 140 + 80 + 30 + 24,
    });

    // One level of nesting, different ancestor chain.
    expect(byId['users-icon']).toMatchObject({ absX: 50 + 30, absY: 190 + 30 });
  });

  it('strips HTML from labels', async () => {
    const { shapes } = await parseDrawioFile(FIXTURE);
    const apigw = shapes.find((s) => s.id === 'svc-apigw');
    expect(apigw.label).toBe('Amazon API Gateway REST endpoint');
    expect(apigw.label).not.toMatch(/</);
  });

  it('computes bounds as the union of all shape rects', async () => {
    const { bounds } = await parseDrawioFile(FIXTURE);
    // Left/top edge is the title group at (50,30); right and bottom edges come
    // from the legend group that sits beside the AWS cloud, not the cloud
    // (230+1220=1450) — the legend is exactly the kind of shape a naive
    // "ignore groups" mutation would drop.
    expect(bounds).toMatchObject({ minX: 50, minY: 30, maxX: 2160, maxY: 1220 });
    expect(bounds.width).toBe(2110);
    expect(bounds.height).toBe(1190);
  });

  it('skips edge labels (relative geometry) and zero-size cells', () => {
    const model =
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>' +
      '<mxCell id="edge-label" value="20 req/s" vertex="1" parent="1">' +
      '<mxGeometry relative="1" width="40" height="20" as="geometry"/></mxCell>' +
      '<mxCell id="point" vertex="1" parent="1"><mxGeometry x="5" y="5" as="geometry"/></mxCell>' +
      '<mxCell id="real" vertex="1" parent="1">' +
      '<mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell>' +
      '</root></mxGraphModel>';
    const { shapes } = parseMxGraphModel(model);
    expect(shapes.map((s) => s.id)).toEqual(['real']);
  });

  it('terminates on a parent cycle instead of hanging', () => {
    const model =
      '<mxGraphModel><root>' +
      '<mxCell id="a" vertex="1" parent="b"><mxGeometry x="1" y="1" width="10" height="10" as="geometry"/></mxCell>' +
      '<mxCell id="b" vertex="1" parent="a"><mxGeometry x="2" y="2" width="10" height="10" as="geometry"/></mxCell>' +
      '</root></mxGraphModel>';
    const { shapes } = parseMxGraphModel(model);
    expect(shapes).toHaveLength(2);
  });

  it('throws on model XML that does not parse', () => {
    expect(() => parseMxGraphModel('<mxGraphModel><unclosed')).toThrow(/did not parse/);
  });
});

describe('parseDrawioFile', () => {
  it('reports page identity and count', async () => {
    const result = await parseDrawioFile(FIXTURE);
    expect(result.page).toEqual({ id: 'diagram-1', name: 'Page-1' });
    expect(result.pageCount).toBe(1);
    expect(result.shapes.length).toBeGreaterThan(20);
  });

  it('selects a page by id and falls back to the first for an unknown id', async () => {
    const two =
      '<mxfile>' +
      '<diagram id="p1" name="One"><mxGraphModel><root>' +
      '<mxCell id="only-one" vertex="1"><mxGeometry x="1" y="1" width="2" height="2" as="geometry"/></mxCell>' +
      '</root></mxGraphModel></diagram>' +
      '<diagram id="p2" name="Two"><mxGraphModel><root>' +
      '<mxCell id="only-two" vertex="1"><mxGeometry x="1" y="1" width="2" height="2" as="geometry"/></mxCell>' +
      '</root></mxGraphModel></diagram>' +
      '</mxfile>';
    const second = await parseDrawioFile(two, { pageId: 'p2' });
    expect(second.page.id).toBe('p2');
    expect(second.shapes[0].id).toBe('only-two');
    const fallback = await parseDrawioFile(two, { pageId: 'nope' });
    expect(fallback.page.id).toBe('p1');
  });
});
