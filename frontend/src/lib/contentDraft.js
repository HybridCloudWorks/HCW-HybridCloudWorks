function getHeadingMatch(line = '') {
  const match = String(line).match(/^(#{1,6})\s+(.+?)\s*$/);
  if (!match) return null;

  return {
    level: match[1].length,
    title: match[2].trim(),
  };
}

function isTldrHeading(title = '') {
  return /^tl;?dr\b/i.test(String(title).trim());
}

const DEFAULT_TLDR_SECTION = '## TL;DR :)\n\n- Add the final takeaway summary here.\n';

export function moveTldrSectionToEnd(markdown = '') {
  const source = String(markdown || '');
  if (!source.trim()) return source;

  const lines = source.split('\n');
  let startIndex = -1;
  let headingLevel = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const heading = getHeadingMatch(lines[index]);
    if (heading && isTldrHeading(heading.title)) {
      startIndex = index;
      headingLevel = heading.level;
      break;
    }
  }

  if (startIndex < 0) return source;

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const heading = getHeadingMatch(lines[index]);
    if (heading && heading.level <= headingLevel) {
      endIndex = index;
      break;
    }
  }

  const before = lines.slice(0, startIndex).join('\n').trimEnd();
  const section = lines.slice(startIndex, endIndex).join('\n').trim();
  const after = lines.slice(endIndex).join('\n').trim();

  if (!section) return source;

  return [before, after, section].filter(Boolean).join('\n\n').trim();
}

export function ensureTldrSectionAtEnd(markdown = '') {
  const source = String(markdown || '').trim();
  if (!source) return DEFAULT_TLDR_SECTION.trim();

  const normalized = moveTldrSectionToEnd(source);
  const hasTldr = normalized.split('\n').some((line) => {
    const heading = getHeadingMatch(line);
    return heading && isTldrHeading(heading.title);
  });

  if (hasTldr) return normalized;
  return `${normalized}\n\n${DEFAULT_TLDR_SECTION.trim()}`.trim();
}
