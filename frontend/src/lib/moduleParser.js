/**
 * Module Parser
 * Converts special HTML-like tags in markdown to module data structures
 *
 * Supported formats:
 * <module type="fact" align="left">content here</module>
 * <module type="recommendation" align="right">content here</module>
 * <module type="links" align="left">{"links": [{"title": "Link 1", "url": "https://..."}]}</module>
 * <module type="picture" align="left">{"imageUrl": "url", "caption": "text"}</module>
 * <module type="video" align="left">{"videoUrl": "https://youtube.com/watch?v=...", "caption": "text"}</module>
 * <module type="spacer">{"style": "gradient"}</module>
 * <module type="text" align="left">plain text content</module>
 * <module type="code" align="left">code snippet content</module>
 * <module type="design" align="all">mermaid diagram source</module>
 * <module type="pull_quote">{"text": "...", "attribution": "..."}</module>
 * <module type="stat_board">{"stats": [{"value": "40%", "label": "..."}]}</module>
 * <module type="comparison">{"columns": [...], "rows": [[...]]}</module>
 * <module type="timeline">{"steps": [{"title": "...", "body": "..."}]}</module>
 * <module type="callout">{"eyebrow": "...", "title": "...", "body": "..."}</module>
 */

// The type list and each JSON payload schema are specified in
// wiki/Blog-Machine.md (the cross-package contract of record); the backend
// twin sets live in functions/src/lib/cms/content-modules.js, and each side
// carries a test asserting its list matches the documented set.
export const RAW_MODULE_TYPES = ['fact', 'recommendation', 'text', 'code', 'design'];

export const JSON_MODULE_TYPES = [
  'links',
  'picture',
  'video',
  'spacer',
  'pull_quote',
  'stat_board',
  'comparison',
  'timeline',
  'callout',
];

export const MAX_MODULES = 14;

export function parseModulesFromMarkdown(markdown) {
  if (!markdown) return { text: '', modules: [] };

  const modules = [];
  const moduleRegex = /<module\s+type="(\w+)"(?:\s+align="([^"]*)")?\s*>([\s\S]*?)<\/module>/g;

  let match;
  let lastIndex = 0;
  const textParts = [];

  while ((match = moduleRegex.exec(markdown)) !== null) {
    // Add text before this module
    if (match.index > lastIndex) {
      textParts.push(markdown.substring(lastIndex, match.index));
    }

    const [, moduleType, alignInput, content] = match;
    const align = alignInput || 'left';

    let moduleData = { type: moduleType, align };

    // Parse content based on type
    try {
      if (RAW_MODULE_TYPES.includes(moduleType)) {
        moduleData.content = content;
      } else if (moduleType === 'spacer') {
        // Try to parse as JSON, or use defaults
        try {
          moduleData = { ...moduleData, ...JSON.parse(content) };
        } catch {
          moduleData.style = 'gradient';
          moduleData.height = 'h-1';
        }
      } else if (JSON_MODULE_TYPES.includes(moduleType)) {
        moduleData = { ...moduleData, ...JSON.parse(content) };
      }
    } catch {
      console.warn(`Failed to parse module data for type ${moduleType}:`, content);
    }

    modules.push(moduleData);

    // Add placeholder text so module maintains position
    textParts.push(`<!-- MODULE_${modules.length - 1} -->`);

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < markdown.length) {
    textParts.push(markdown.substring(lastIndex));
  }

  return {
    text: textParts.join(''),
    modules,
  };
}

export function rebuildMarkdownWithModules(text, modules = []) {
  const sourceText = String(text || '');
  let moduleIndex = 0;

  // Replace each placeholder in order with the corresponding module.
  let rebuilt = sourceText.replace(/<!-- MODULE_\d+ -->/g, () => {
    if (moduleIndex >= modules.length) return '';
    const next = moduleDataToString(modules[moduleIndex]);
    moduleIndex += 1;
    return next;
  });

  // Append any remaining modules when there are more modules than placeholders.
  if (moduleIndex < modules.length) {
    const remainder = modules.slice(moduleIndex).map((module) => moduleDataToString(module));
    rebuilt = `${rebuilt}\n\n${remainder.join('\n\n')}`;
  }

  return rebuilt.trim();
}

/**
 * Convert module data to HTML tag string for storage
 */
export function moduleDataToString(module) {
  const { type, align = 'left', ...data } = module;

  if (RAW_MODULE_TYPES.includes(type)) {
    return `<module type="${type}" align="${align}">${data.content || ''}</module>`;
  }

  if (JSON_MODULE_TYPES.includes(type)) {
    const jsonContent = JSON.stringify(data);
    return `<module type="${type}" align="${align}">${jsonContent}</module>`;
  }

  return '';
}

/**
 * Insert a module into markdown at specified position
 * If position is -1, appends to end
 */
export function insertModuleIntoMarkdown(markdown, module, position = -1) {
  const moduleStr = moduleDataToString(module);
  const newSection = `\n\n${moduleStr}\n\n`;

  if (position === -1) {
    return markdown + newSection;
  }

  // TODO: implement positional insert if needed
  return markdown + newSection;
}

/**
 * Remove a module from markdown by index
 */
export function removeModuleFromMarkdown(markdown, moduleIndex) {
  const { text, modules } = parseModulesFromMarkdown(markdown);

  // Remove the module at index
  modules.splice(moduleIndex, 1);

  return rebuildMarkdownWithModules(text, modules);
}

/**
 * Get plain text version without modules
 */
export function getPlainTextWithoutModules(markdown) {
  const { text } = parseModulesFromMarkdown(markdown);
  // Remove placeholders
  return text.replace(/<!-- MODULE_\d+ -->/g, '').trim();
}
