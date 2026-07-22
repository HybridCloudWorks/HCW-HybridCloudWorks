#!/usr/bin/env node
/**
 * Pretty-print the contrast failures from documentation/reports/axe-theme-scan.json
 * (produced by scripts/axe-theme-scan.mjs).
 */
import fs from 'node:fs';

const reportPath = 'documentation/reports/axe-theme-scan.json';
const raw = fs.readFileSync(reportPath, 'utf8');
const report = JSON.parse(raw);
const results = Array.isArray(report) ? report : report.results;

let total = 0;
for (const entry of results) {
  const contrast = entry.violations.filter((v) => v.id === 'color-contrast');
  if (contrast.length === 0) continue;

  console.log(`\n=== ${entry.theme.toUpperCase()} ${entry.route ?? entry.path} ===`);
  for (const violation of contrast) {
    console.log(
      `Rule: ${violation.id} | Impact: ${violation.impact || 'n/a'} | Nodes: ${violation.nodeCount ?? violation.nodes.length}`
    );
    for (const node of violation.nodes ?? []) {
      const target = Array.isArray(node.target)
        ? node.target.join(' | ')
        : String(node.target || '');
      const html = String(node.html || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
      const data = node.any?.[0]?.data ?? {};
      console.log(`- target: ${target}`);
      if (data.fgColor || data.bgColor) {
        console.log(
          `  colors: fg ${data.fgColor} on bg ${data.bgColor} = ${data.contrastRatio} (need ${data.expectedContrastRatio})`
        );
      }
      console.log(`  html: ${html}`);
      total++;
    }
  }
}

console.log(`\nTotal contrast failures: ${total}`);
