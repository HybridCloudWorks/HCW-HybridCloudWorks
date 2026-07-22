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
 */

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
      if (
        moduleType === 'fact' ||
        moduleType === 'recommendation' ||
        moduleType === 'text' ||
        moduleType === 'code'
      ) {
        moduleData.content = content;
      } else if (moduleType === 'links' || moduleType === 'picture' || moduleType === 'video') {
        // Try to parse as JSON
        moduleData = { ...moduleData, ...JSON.parse(content) };
      } else if (moduleType === 'spacer') {
        // Try to parse as JSON, or use defaults
        try {
          moduleData = { ...moduleData, ...JSON.parse(content) };
        } catch {
          moduleData.style = 'gradient';
          moduleData.height = 'h-1';
        }
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

  if (type === 'fact' || type === 'recommendation' || type === 'text' || type === 'code') {
    return `<module type="${type}" align="${align}">${data.content}</module>`;
  }

  if (type === 'links' || type === 'picture' || type === 'video' || type === 'spacer') {
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
