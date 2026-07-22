import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useProviderConfig } from '@/context/ProviderContext';
import { Search } from 'lucide-react';

/**
 * @param {string} title - Page title
 * @param {string} description - Page description
 * @param {React.ReactNode} children - Grid content or other elements
 * @param {boolean} showSearch - Whether to show search bar
 */
export function ContentHubTemplate({ title, description, children, showSearch = true, actions }) {
  const _providerConfig = useProviderConfig();

  return (
    <div className="container mx-auto px-4 py-8">
      <Helmet>
        <title>{title} | HCW</title>
        <meta name="description" content={description} />
      </Helmet>

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8 border-b border-border/50 pb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-foreground mb-2">
            {title}
          </h1>
          <p className="text-muted-foreground max-w-2xl">{description}</p>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          {showSearch && (
            <div className="relative w-full md:w-64" role="search">
              <Search
                className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"
                aria-hidden="true"
              />
              <input placeholder="Search..." className="pl-8" aria-label="Search items" />
            </div>
          )}
          {actions}
        </div>
      </div>

      {/* Content Area */}
      <div className="min-h-[50vh]">{children}</div>
    </div>
  );
}

export default ContentHubTemplate;
