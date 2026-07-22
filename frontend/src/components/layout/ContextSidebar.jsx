import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronRight, Lightbulb, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as Widgets from '@/components/widgets/PowerWidgets'; // Import all widgets

/**
 * Context Sidebar
 * A pull-out left hand menu for "extra pizzazz" content.
 */
export default function ContextSidebar({ content }) {
  const [isOpen, setIsOpen] = useState(false); // Default closed

  if (!content) return null; // Don't render if no sidebar content

  // Custom components for ReactMarkdown to render our widgets
  const components = {
    // We can map HTML tags to our React components if the markdown parser supports it (rehype-raw needed usually)
    // Or we can rely on standard markdown elements being styled.
    // However, for "Power Widgets", we might need a custom parser or just trust that the
    // admin entered valid HTML/Component syntax if we were using a more advanced MDX renderer.
    // For this standard ReactMarkdown setup, let's assume the user enters standard Markdown
    // and we wrap it, OR we parse custom directives.

    // SINCE we are using standard ReactMarkdown, let's support a simple convention:
    // Blockquotes ">" map to a stylized recommendation box
    blockquote: ({ ...props }) => (
      <div className="my-4 pl-4 border-l-4 border-primary bg-primary/5 p-4 rounded-r-lg italic text-muted-foreground">
        {props.children}
      </div>
    ),
    // Code blocks can be mapped to our CodeHighlight
    code: ({ inline, className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <Widgets.CodeHighlight language={match[1]} className="my-4">
          {String(children).replace(/\n$/, '')}
        </Widgets.CodeHighlight>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  };

  // NOTE: To truly support <DidYouKnow> tags written in the editor, we would need
  // 'rehype-raw' and 'rehype-react' to parse HTML and map it to components.
  // Given the constraints, let's provide a "renderHtml" prop approach or just
  // dangerouslySetInnerHTML if we trust the admin input (we do, it's an admin portal).
  // But mixing React components is tricky without MDX.

  // ALTERNATIVE: Let's parse the specific widget tags manually or use a library that handles it.
  // For simplicity and robustness given the current stack, let's treat the sidebar content
  // as potentially containing HTML that we want to substitute with our widgets,
  // OR we just use a helper to render them if they are in a structured format.

  // Let's go with a "Hybrid" approach: The sidebar content is rendered via a custom
  // component that can handle our specific "pseudo-tags" if we wanted,
  // but for now let's just render it as Markdown and allow HTML (rehype-raw would be best).

  // Since we don't have rehype-raw installed in the plan (I didn't see it),
  // I will use a simple regex replacer to find our specific widget patterns
  // and render them as actual React components if possible,
  // OR just rely on standard HTML rendering if safety allows.

  // Simpler approach for this task: The sidebar content is Markdown.
  // We encourage the admin to use "Callouts" (blockquotes, bold headers) which we style heavily.

  return (
    <>
      {/* Toggle Button (Visible when closed) */}
      {!isOpen && (
        <motion.div initial={{ x: -100 }} animate={{ x: 0 }} className="fixed left-0 top-32 z-40">
          <Button
            onClick={() => setIsOpen(true)}
            variant="secondary"
            className="rounded-l-none border-l-0 shadow-md h-12 pr-4 pl-2 bg-background/80 backdrop-blur border-y border-r border-border"
            aria-label="Open context menu"
          >
            <ChevronRight className="h-4 w-4 mr-1" />
            <span className="text-xs font-bold uppercase tracking-wider writing-vertical-lr hidden sm:inline-block">
              Extras
            </span>
          </Button>
        </motion.div>
      )}

      {/* Sidebar Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop for mobile */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
            />

            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="fixed left-0 top-0 bottom-0 w-80 bg-background/95 backdrop-blur border-r border-border shadow-2xl z-50 overflow-y-auto pt-20 px-6 pb-10"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-yellow-500" />
                  Context & Extras
                </h3>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close context menu"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <div className="prose prose-sm dark:prose-invert prose-headings:font-bold prose-headings:text-foreground prose-p:text-muted-foreground">
                {/*
                    We are using a custom renderer here.
                    If the content contains our raw HTML widgets (like <DidYouKnow>),
                    ReactMarkdown usually escapes them unless rehype-raw is used.

                    For this implementation, let's assume the user writes MARKDOWN
                    and we style specific patterns (like Blockquotes) as widgets.
                 */}
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                  {content}
                </ReactMarkdown>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
