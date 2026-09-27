/**
 * The lab payload (#672). What must hold: the agent's own parser
 * (vps-agent/lib/docker-runner.js) unpacks it into exactly the emitted
 * files, contents byte for byte and registry sources untouched, so what the
 * lab validates is what the visitor downloads; every header is a valid
 * ustar header; paths the agent would refuse are refused here first; and
 * the largest build the page can make fits the server's 64 KB.
 */
import { describe, expect, it } from 'vitest';

import { decodeTarPayload, parseTar } from '../../../../vps-agent/lib/docker-runner.js';
import { COMPONENT_IDS, DEFAULT_STATE, MAX_LANDING_ZONES, emitFiles } from './index';
import { buildLabPayload, tarFiles, toBase64 } from './labPayload';

const LARGEST = {
  selected: COMPONENT_IDS,
  options: { corpCount: MAX_LANDING_ZONES, onlineCount: MAX_LANDING_ZONES },
};

const unpack = (payload) =>
  parseTar(decodeTarPayload(payload)).map((entry) => ({
    path: entry.path,
    type: entry.type,
    content: new TextDecoder().decode(entry.data),
  }));

describe('buildLabPayload', () => {
  it('is the terraform-validate body the server takes, as a base64 gzipped tar', async () => {
    const { body, bytes } = await buildLabPayload(emitFiles(DEFAULT_STATE));
    expect(Object.keys(body).sort()).toEqual(['payload', 'payloadEncoding', 'type']);
    expect(body.type).toBe('terraform-validate');
    expect(body.payloadEncoding).toBe('tar');
    expect(body.payload).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(bytes).toBe(body.payload.length);
    // gzip's magic number, which is how the agent knows to gunzip.
    expect(Array.from(Buffer.from(body.payload, 'base64').subarray(0, 2))).toEqual([0x1f, 0x8b]);
  });

  it('unpacks, with the agent’s parser, into exactly the emitted files', async () => {
    const files = emitFiles(DEFAULT_STATE);
    const { body } = await buildLabPayload(files);
    expect(unpack(body.payload)).toEqual(
      files.map((f) => ({ path: f.path, type: 'file', content: f.content }))
    );
  });

  it('keeps every registry source and version line as written', async () => {
    const files = emitFiles(DEFAULT_STATE);
    const { body } = await buildLabPayload(files);
    const sent = unpack(body.payload)
      .map((f) => f.content)
      .join('\n');
    expect(sent).toContain('source  = "Azure/avm-ptn-alz/azurerm"');
    expect(sent).not.toContain('/opt/avm');
  });

  it('fits the largest build the page can make inside the 64 KB cap', async () => {
    const { bytes } = await buildLabPayload(emitFiles(LARGEST));
    expect(bytes).toBeLessThanOrEqual(64 * 1024);
  });
});

describe('tarFiles', () => {
  it('writes valid ustar headers: magic, octal size and checksum', () => {
    const tar = tarFiles([{ path: 'main.tf', content: 'terraform {}\n' }]);
    const header = tar.subarray(0, 512);
    const text = (start, length) =>
      new TextDecoder().decode(header.subarray(start, start + length)).replace(/\0.*$/s, '');
    expect(text(0, 100)).toBe('main.tf');
    expect(text(257, 6)).toBe('ustar');
    expect(parseInt(text(124, 12), 8)).toBe(13);
    expect(String.fromCharCode(header[156])).toBe('0');

    const stored = parseInt(text(148, 8).trim(), 8);
    const blanked = Uint8Array.from(header);
    blanked.fill(0x20, 148, 156);
    expect(stored).toBe(blanked.reduce((sum, byte) => sum + byte, 0));
    // One header, one data block, then the two zero blocks.
    expect(tar.length).toBe(512 * 4);
  });

  it('counts UTF-8 bytes, not characters', () => {
    const [entry] = parseTar(Buffer.from(tarFiles([{ path: 'a.tf', content: 'é' }])));
    expect(entry.data.length).toBe(2);
  });

  it.each([
    '../escape.tf',
    '/abs.tf',
    'a/../b.tf',
    'dir\\file.tf',
    './x.tf',
    'a//b.tf',
    'x'.repeat(101),
  ])('refuses %j, which the agent would refuse', (path) => {
    expect(() => tarFiles([{ path, content: '' }])).toThrow(/tar: refusing path/);
  });

  it('encodes a large payload in chunks without overflowing the stack', () => {
    const bytes = new Uint8Array(200_000).fill(65);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });
});
