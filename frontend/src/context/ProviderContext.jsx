import React, { createContext, lazy, useContext } from 'react';
import { useParams, Outlet } from 'react-router-dom';

const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

/**
 * Valid cloud providers supported by the application
 */
export const VALID_PROVIDERS = [
  'azure',
  'aws',
  'gcp',
  'github',
  'terraform',
  'finops',
  'vmware',
  'ansible',
];

/**
 * Provider Context - provides the current cloud provider throughout the app
 */
const ProviderContext = createContext(null);

/**
 * Hook to access the current provider from any component
 * @returns {string|null} The current provider ('azure', 'aws', 'gcp', 'github', 'terraform', 'finops') or null
 */
export function useProvider() {
  const context = useContext(ProviderContext);
  return context;
}

/**
 * Hook to get provider-specific configuration
 * @returns {object} Provider configuration including name, theme, blog path, etc.
 */
export function useProviderConfig() {
  const provider = useProvider();

  const configs = {
    azure: {
      name: 'Azure',
      displayName: 'Microsoft Azure',
      theme: 'theme-azure',
      blogPath: 'blog',
      color: 'hsl(var(--primary))',
      rssFeeds: [
        {
          name: 'Azure Blog',
          url: 'https://azure.microsoft.com/en-us/blog/feed/',
        },
        {
          name: 'Azure Updates',
          url: 'https://azurecomcdn.azureedge.net/en-us/updates/feed/',
        },
      ],
      blogSource: 'https://azure.microsoft.com/en-us/blog/',
      podcast: {
        feedUrl: 'https://feed.podbean.com/PublicCloudWorks/feed.xml',
        subscribeLinks: {
          spotify: 'https://open.spotify.com/show/66tno2OzalMJZOvSDqM77Y',
          amazon:
            'https://music.amazon.com/podcasts/d139c50a-8163-425c-8315-4e19cc9370ee/hybrid-cloud-works',
          apple: 'https://podcastsconnect.apple.com/my-podcasts',
          podbean: 'https://feed.podbean.com/PublicCloudWorks/feed.xml',
        },
      },
    },
    aws: {
      name: 'AWS',
      displayName: 'Amazon Web Services',
      theme: 'theme-aws',
      blogPath: 'foundational-posts',
      color: 'hsl(var(--primary))',
      rssFeeds: [
        { name: 'AWS Blog', url: 'https://aws.amazon.com/blogs/aws/feed/' },
        {
          name: 'AWS Whats New',
          url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/',
        },
      ],
      blogSource: 'https://aws.amazon.com/blogs/aws/',
    },
    gcp: {
      name: 'Google Cloud',
      displayName: 'Google Cloud Platform',
      theme: 'theme-gcp',
      blogPath: 'foundational-posts',
      color: 'hsl(var(--primary))',
      rssFeeds: [
        {
          name: 'Google Cloud Blog',
          url: 'https://cloud.google.com/blog/feed',
        },
        {
          name: 'GCP Release Notes',
          url: 'https://cloud.google.com/feeds/gcp-release-notes.xml',
        },
      ],
      blogSource: 'https://cloud.google.com/blog/',
    },
    github: {
      name: 'GitHub',
      displayName: 'GitHub',
      theme: 'theme-github',
      blogPath: 'foundational-posts',
      color: 'hsl(var(--primary))',
      rssFeeds: [
        { name: 'GitHub Blog', url: 'https://github.blog/feed/' },
        {
          name: 'GitHub Changelog',
          url: 'https://github.blog/changelog/feed/',
        },
      ],
      blogSource: 'https://github.blog/',
    },
    terraform: {
      name: 'Terraform',
      displayName: 'HashiCorp Terraform',
      theme: 'theme-terraform',
      blogPath: 'foundational-posts',
      color: 'hsl(var(--primary))',
      rssFeeds: [
        {
          name: 'HashiCorp Blog',
          url: 'https://www.hashicorp.com/blog/feed.xml',
        },
      ],
      blogSource: 'https://www.hashicorp.com/blog/',
    },
    finops: {
      name: 'FinOps',
      displayName: 'FinOps Foundation',
      theme: 'theme-finops',
      blogPath: 'foundational-posts',
      color: 'hsl(var(--primary))',
      rssFeeds: [{ name: 'FinOps Foundation', url: 'https://www.finops.org/feed/' }],
      blogSource: 'https://www.finops.org/',
    },
    vmware: {
      name: 'VMware',
      displayName: 'VMware by Broadcom',
      theme: 'theme-vmware',
      blogPath: 'foundational-posts',
      color: 'hsl(var(--primary))',
      rssFeeds: [{ name: 'VMware Blogs', url: 'https://blogs.vmware.com/feed/' }],
      blogSource: 'https://blogs.vmware.com/',
    },
    ansible: {
      name: 'Ansible',
      displayName: 'Red Hat Ansible',
      theme: 'theme-ansible',
      blogPath: 'foundational-posts',
      color: 'hsl(var(--primary))',
      rssFeeds: [
        { name: 'Ansible Blog', url: 'https://www.ansible.com/blog/rss.xml' },
        { name: 'Red Hat Blog', url: 'https://www.redhat.com/en/rss/blog' },
      ],
      blogSource: 'https://www.ansible.com/blog',
    },
  };

  return provider ? configs[provider] : null;
}

/**
 * ProviderLayout - Validates provider param and provides context to child routes
 * Wraps all provider-specific routes with validation and context
 */
export function ProviderLayout() {
  const { provider } = useParams();

  // Validate provider is one of our supported providers
  if (!provider || !VALID_PROVIDERS.includes(provider)) {
    return <NotFoundPage />;
  }

  return (
    <ProviderContext.Provider value={provider}>
      <Outlet />
    </ProviderContext.Provider>
  );
}

export default ProviderContext;
