import React, { useState } from 'react';
// Imported from its ESM subpath, not the package root. The root index re-exports
// the highlight.js build, whose language index requires
// `highlight.js/lib/languages/c-like` — removed in highlight.js 11. A bundler
// tree-shakes that branch away, which is why production was fine, but Vitest
// evaluates the index and the import throws. That is the whole reason §5.1 of the
// public-pages handoff told route tests to mock the detail templates.
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import hcl from 'react-syntax-highlighter/dist/esm/languages/prism/hcl';
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';

const LANGUAGES = {
  bash,
  json,
  yaml,
  python,
  javascript,
  typescript,
  jsx,
  hcl,
  powershell,
  docker,
  sql,
  go,
  csharp,
  markdown,
};
Object.entries(LANGUAGES).forEach(([name, lang]) => SyntaxHighlighter.registerLanguage(name, lang));

const ALIASES = {
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  py: 'python',
  js: 'javascript',
  ts: 'typescript',
  tsx: 'jsx',
  terraform: 'hcl',
  tf: 'hcl',
  ps1: 'powershell',
  pwsh: 'powershell',
  dockerfile: 'docker',
  golang: 'go',
  'c#': 'csharp',
  cs: 'csharp',
  md: 'markdown',
};

const resolveLanguage = (raw) => {
  const lang = String(raw || '').toLowerCase();
  const resolved = ALIASES[lang] || lang;
  return LANGUAGES[resolved] ? resolved : 'bash';
};

/**
 * Fenced code block with syntax highlighting, language badge, and copy button.
 * Used as the `code` renderer override in ReactMarkdown.
 */
export default function CodeBlock({ language, value }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable (http/permissions) — leave button as-is
    }
  };

  const displayLang = String(language || 'code').toLowerCase();

  return (
    <div className="not-prose relative group my-6 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 bg-[#282c34]">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800/80 border-b border-slate-700">
        <span className="text-xs font-mono font-semibold text-slate-400 uppercase tracking-wider">
          {displayLang}
        </span>
        <button
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold text-slate-300 hover:text-white bg-slate-700/60 hover:bg-slate-600/80 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">
            {copied ? 'check' : 'content_copy'}
          </span>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={resolveLanguage(language)}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '0.875rem',
          background: 'transparent',
        }}
        wrapLongLines={false}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
}

/**
 * ReactMarkdown `components` override wiring fenced blocks to CodeBlock while
 * leaving inline code styled by prose classes.
 */
export const markdownCodeComponents = {
  code({ inline, className, children, ...props }) {
    const match = /language-(\S+)/.exec(className || '');
    const value = String(children).replace(/\n$/, '');
    // Fenced blocks arrive wrapped in <pre>; inline code has no language class
    // and no newlines. react-markdown v10 no longer passes `inline`.
    const isBlock = match || value.includes('\n');
    if (!inline && isBlock) {
      return <CodeBlock language={match?.[1]} value={value} />;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  // Unwrap <pre> since CodeBlock renders its own container
  pre({ children }) {
    return <>{children}</>;
  },
};
