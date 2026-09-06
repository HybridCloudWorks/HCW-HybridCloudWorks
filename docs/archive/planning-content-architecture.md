# Content Strategy & Architecture

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## Architecture Decision

**Decision:** Use a **Client-Side Data Fetching** model with **React + Vite** and **Firestore** as
the headless CMS.

**Why:**

- **Simplicity**: No complex build pipelines or server-side rendering infrastructure to manage.
- **Real-time**: Content updates are instantly available without rebuilding or revalidating.
- **Cost**: Leveraging Firebase's generous free tier and low-cost reads.
- **Performance**: Initial app shell loads instantly from CDN; content fetches are fast via
  Firestore.

---

## Technical Implementation

### Component Structure

The application uses a **Template Pattern** where generic page components (`BlogTemplate`,
`FrameworkTemplate`) are populated with data fetched based on the URL.

```javascript
// src/pages/templates/BlogTemplatePage.jsx (simplified)

import { useParams } from 'react-router-dom';
import { useFirestoreDocument } from '@/hooks/useFirestore'; // Custom hook
import { useProviderConfig } from '@/context/ProviderContext';

export default function BlogTemplatePage() {
  const { provider, slug } = useParams();
  const theme = useProviderConfig();

  // Fetch content: /unique_content/{provider}/blog/{slug}
  const {
    data: post,
    loading,
    error,
  } = useFirestoreDocument(`unique_content/${provider}/blog/${slug}`);

  if (loading) return <Loader />;
  if (error) return <NotFound />;

  return (
    <article className="blog-post" style={{ '--primary': theme.color }}>
      <header className="blog-header">
        <Badge color={theme.color}>{provider.toUpperCase()}</Badge>
        <h1>{post.title}</h1>
        <Meta author={post.author} date={post.publishedAt} />
      </header>
      <div dangerouslySetInnerHTML={{ __html: post.content }} />
    </article>
  );
}
```

### Firestore Schema

The database schema is designed for efficient read access by the client application.

```javascript
firestore/
├── providers/{providerId}
│   ├── theme: { ... } (synced with frontend config)
│   └── metadata: { ... }
│
├── unique_content/{providerId}/{contentType}  // Collection
│   ├── {slug}                                 // Document ID matches URL slug
│   │   ├── title: "String"
│   │   ├── content: "HTML/Markdown String"
│   │   ├── author: "String"
│   │   ├── publishedAt: Timestamp
│   │   ├── tags: [Array]
│   │   ├── seo: {
│   │   │   title: "String",
│   │   │   description: "String"
│   │   │ }
│   │   └── ...
```

### Content Types & URL Mapping

| Content Type     | URL Pattern                     | Collection Path                          | Template Component        |
| :--------------- | :------------------------------ | :--------------------------------------- | :------------------------ |
| **Blog Post**    | `/:provider/blog/:slug`         | `unique_content/{provider}/blog`         | `BlogPage`                |
| **Framework**    | `/:provider/framework/:slug`    | `unique_content/{provider}/framework`    | `FrameworkPage`           |
| **Architecture** | `/:provider/architecture/:slug` | `unique_content/{provider}/architecture` | `ArchitectureDesignsPage` |

---

## Content Creation Workflow

### 1. Authoring

Content creators write content (Markdown or HTML) and define metadata.

### 2. Publishing

Content is pushed to Firestore. This can be done via:

- **Scripts**: A Node.js script uploads Markdown files from the local repo.
- **Admin UI**: (Future) value-add feature for direct editing.
- **API**: Automated aggregation from RSS feeds (e.g., for `terrafrom/rss`).

### 3. Consumption

Users navigate to a URL. The Single Page Application (SPA):

1.  Loads the application shell (Header, Nav, Footer).
2.  Identifies the `provider` and `slug` from the URL.
3.  Fetches the document from Firestore.
4.  Renders the content using the provider's theme.

---

## SEO Strategy (SPA)

Since the content is rendered client-side, we use **React Helmet Async** to manage metadata for
social sharing and browser tabs.

```javascript
<Helmet>
  <title>{post.seo.title || post.title} | HCW</title>
  <meta name="description" content={post.seo.description} />
  <meta property="og:title" content={post.title} />
  {/* ... other tags */}
</Helmet>
```

_Note: For enhanced search engine indexing, we may explore Pre-rendering solutions or migrate to
Server-Side Rendering (SSR) if SEO becomes a critical blocker, but for the MVP, standard Google
Crawler execution of JS is sufficient._

---

## Performance Considerations

- **Caching**: Firestore SDK handles offline persistence and caching.
- **Code Splitting**: Templates are lazy-loaded only when needed.
- **Optimistic UI**: Use skeletons/loaders while fetching data.

## Security

- **Firestore Rules**:
  - `allow read: if true;` (Public content)
  - `allow write: if request.auth != null && request.auth.token.admin == true;` (Admin only)

---

**Version**: 2.0 (SPA Architecture)
**Date**: February 10, 2026
