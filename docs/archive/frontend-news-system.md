# Frontend News System

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Status:** ✅ Production Ready **Last Updated:** February 26, 2026 **Components:**
`CuratedArticlesGrid`, `RssFeedTimeline`, `NewsPage`, `useNewsData`

---

## 1. Overview & Architecture

The **Smart RSS Curation System** automatically aggregates, filters, and displays news content
across all 6 cloud providers (AWS, Azure, GCP, GitHub, Terraform, FinOps). It replaces manual
curation with an intelligent scoring algorithm that promotes high-quality, relevant content to the
top "Curated Articles" section.

### Data Flow

```mermaid
graph TD
    RSS[RSS Feeds (30+ items)] --> Engine[Curation Engine]
    Firestore[Firestore Articles] --> Engine

    subgraph "Smart Curation Logic"
        Engine -->|Score & Rank| ScoredItems[Scored Items]
        ScoredItems -->|Top 12| Curated[Curated Articles]
        ScoredItems -->|Remaining| Live[Live Feed]
    end

    Curated --> Grid[CuratedArticlesGrid (3x4)]
    Live --> Timeline[RssFeedTimeline]

    AI[AI Insights] --> Sidebar[AiInsightsPanel]
```

### Key Components

1.  **`NewsPage.jsx`**: Main layout orchestrator. Handles responsiveness (desktop/tablet/mobile) and
    data fetching via `useNewsData`.
2.  **`CuratedArticlesGrid.jsx`**: Displays the top 12 highest-scoring articles in a responsive
    grid.
3.  **`RssFeedTimeline.jsx`**: Shows the remaining articles in a scrollable timeline with category
    filters.
4.  **`useNewsData.js`**: Custom hook containing the **Curation Engine** logic.

---

## 2. Smart Curation Algorithm

The curation engine assigns a `relevanceScore` to every RSS item and Firestore article based on
weighted factors.

### Scoring Factors

| Factor             | Weight           | Description                                                                                                               |
| :----------------- | :--------------- | :------------------------------------------------------------------------------------------------------------------------ |
| **Tag Matching**   | **+5** per match | Matches item tags against provider-specific "Relevant Tags" (e.g., "AI/ML" for AWS). Accumulates (e.g., 2 matches = +10). |
| **Category Match** | **+3**           | Bonus if the item's category matches a priority category.                                                                 |
| **Recency**        | **+2**           | Bonus for articles published within the last 7 days.                                                                      |
| **Title Keywords** | **+1** per match | Scans title for high-value keywords (e.g., "Architecture", "Security", "Best Practice").                                  |

### Provider-Specific Relevant Tags

- **AWS/Azure/GCP:**
  `['AI/ML', 'Security', 'Architecture', 'Containers', 'Database', 'DevOps', 'Serverless', 'Cost', 'Networking', 'GA', 'Update', 'Preview']`
- **GitHub:** `['AI/ML', 'Security', 'DevOps', 'Copilot', 'Actions', 'Automation', 'GA', 'Update']`
- **Terraform:**
  `['IaC', 'DevOps', 'Modules', 'Cloud', 'Architecture', 'Best Practices', 'Update', 'GA']`
- **FinOps:**
  `['Cost', 'Optimization', 'AI/ML', 'FinOps', 'Framework', 'Cloud', 'Efficiency', 'Update', 'GA']`

---

## 3. UI/UX Design & Layout

### Responsive Breakpoints

- **Desktop (1024px+)**:
  - **Layout**: 2-column. Main content (70%) + Sidebar (30%).
  - **Grid**: 3 columns × 4 rows.
  - **Sidebar**: AI Insights panel visible.
- **Tablet (640-1023px)**:
  - **Layout**: Single column.
  - **Grid**: 2 columns × 6 rows.
  - **Sidebar**: Moves below the Live Feed.
- **Mobile (<640px)**:
  - **Layout**: Single column, full width.
  - **Grid**: 1 column × 12 rows (stacked).
  - **Sidebar**: Moves to bottom.

### Article Card Design (`CuratedArticlesGrid`)

- **Dimensions**: Fixed `340px` height.
  - **Image**: 192px (60%) height.
  - **Content**: 148px (40%) height.
- **Visual Style**: Glassmorphism (`backdrop-blur-md`, `bg-white/5`).
- **Interactions**:
  - **Hover**: Lifts up (-4px), glows with primary color shadow, image scales 105%.
  - **Click**: Opens source URL in new tab.
- **Category Badges**: Color-coded based on category (e.g., AI/ML = Purple, Security = Red).

### Live Feed Design (`RssFeedTimeline`)

- **Layout**: Vertical timeline.
- **Features**:
  - Filter pills (All, AI/ML, Security, etc.).
  - Relative timestamps (e.g., "2h ago").
  - Direct links to source.

---

## 4. Customization Options

The system allows for significant visual customization via the `News-Article-Card-Design-Guide`
(merged here for reference).

### 9 Key Customization Knobs

1.  **Image Size**: Default 192px (60%). Can increase to 224px (65%).
2.  **Overlay Intensity**: Adjust gradient opacity for text readability over images.
3.  **Border Radius**: Default `rounded-2xl` (16px). Can change to `xl` (12px) or `3xl` (24px).
4.  **Shadow Effect**: Adjust hover glow intensity.
5.  **Badge Position**: Default Top-Right. Can move to other corners.
6.  **Content Padding**: Default `p-3.5`. Can adjust to `p-3` (compact) or `p-4` (spacious).
7.  **Font Sizes**: Title/Summary/Meta sizes are adjustable tailwind classes.
8.  **Tag Display**: Default max 2 tags. Can show more or hide tags.
9.  **Grid Columns**: Default 3. Can change to 2 (wider cards) or 4 (denser).

---

## 5. Implementation Status (Phase 1 Complete)

- ✅ **Components Created**: `CuratedArticlesGrid.jsx` (New), `NewsPage.jsx` (Updated).
- ✅ **Logic Implemented**: `useNewsData.js` updated with scoring algorithm.
- ✅ **Responsive**: Validated on Desktop, Tablet, and Mobile.
- ✅ **Dark Mode**: Fully supported.
- ✅ **Performance**: Lazy loading images, optimized rendering (no virtualization needed for <50
  items).

### Next Steps (Phase 2 & 3)

- [ ] **Design Feedback**: Review card aesthetics (Option 1-9 above).
- [ ] **Refine Scoring**: Tweak weights based on real-world data observation.
- [ ] **Provider Replication**: Ensure specific configurations for non-AWS providers are optimized.
- [ ] **Advanced Filtering**: Add "Trending" or "Most Viewed" sorts (future).

---

## 6. Reference: Color Mapping

| Category         | Color   | Usage                                |
| :--------------- | :------ | :----------------------------------- |
| **AI/ML**        | Purple  | `bg-purple-500/20 text-purple-300`   |
| **Security**     | Rose    | `bg-rose-500/20 text-rose-300`       |
| **Architecture** | Blue    | `bg-blue-500/20 text-blue-300`       |
| **DevOps**       | Indigo  | `bg-indigo-500/20 text-indigo-300`   |
| **Cost/FinOps**  | Emerald | `bg-emerald-500/20 text-emerald-300` |
| **Serverless**   | Amber   | `bg-amber-500/20 text-amber-300`     |
| **Update/GA**    | Green   | `bg-green-500/20 text-green-300`     |

---

**Related Files**:

- `src/components/news/CuratedArticlesGrid.jsx`
- `src/hooks/useNewsData.js`
- `src/pages/shared/NewsPage.jsx`
