# Verification Instructions

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


## 1. Setup

- Ensure `npm install` has been run to include `react-zoom-pan-pinch`.
- Ensure `react-chartjs-2` and `chart.js` are installed (they were in `package.json` but worth
  double checking if radar charts fail).

## 2. Admin Editor Test (`/admin/editor/:id`)

1.  Navigate to a blog draft in the Admin Editor.
2.  **Verify Widget Toolbar**: Check if the "Add Widget" toolbar appears above the editor.
3.  **Insert Widget**: Click "Did You Know?" or "Recommendation". Verify a shortcode/HTML snippet is
    inserted into the markdown draft.
4.  **Sidebar Content**: Check the new "Sidebar Content" section on the right.
5.  **Insert Sidebar Widget**: Click "+ Fact" or "+ Rec" in the sidebar section. Verify content is
    added to the sidebar textarea.
6.  **Save**: Save the draft. Ensure `sidebarContent` is persisted to Firestore.

## 3. Blog Detail Test (`/:provider/blog/:slug`)

1.  View the blog post you just edited.
2.  **Verify Sidebar**: Check for the "Extras" tab/button on the left side of the screen.
3.  **Toggle Sidebar**: Click it. Verify the "Context & Extras" panel slides out.
4.  **Verify Content**: Ensure the sidebar content you added (Did You Know box, etc.) is rendered
    correctly inside the panel.
5.  **Verify Widgets**: Ensure the markdown/HTML snippets (like `<DidYouKnow>`) are rendered as
    styled components or at least legible blockquotes/code blocks if standard markdown fallbacks
    were used.

## 4. Architecture Blueprint Test (`/admin/queue/:id` -> Review)

1.  Open an Architecture item in the Review Board.
2.  **Verify Hotspots UI**: Check for the "Interactive Hotspots" card on the left.
3.  **Add Hotspot**: Click "Add". Enter a label (e.g., "Load Balancer"), X: 50, Y: 50.
4.  **Save**: Save the blueprint.
5.  **View Public Page**: Navigate to the public architecture page.
6.  **Verify Interaction**: Hover/Click the diagram. Verify the hotspot appears. Click it. Verify
    the details panel appears below/overlaying the diagram.
7.  **Zoom/Pan**: Use the mouse wheel or controls to zoom/pan the diagram.

## 5. Framework Test (`/admin/queue/:id` -> Review)

1.  Open a Framework item in the Review Board.
2.  **Verify Scoring**: Check the "Maturity Scoring" sliders on the left.
3.  **Adjust Scores**: Change "Security" to 5, "Cost" to 2.
4.  **Verify Preview**: Check if the small Radar Chart updates in real-time.
5.  **Save**: Save the framework.
6.  **View Public Page**: Navigate to the public framework page.
7.  **Verify Chart**: Ensure the "Maturity Model" radar chart is displayed in the Overview tab.

## "Devil's Advocate" Self-Critique (Completed)

- **Critique**: "The sidebar relies on Markdown parsing which might not handle complex HTML widgets
  perfectly without `rehype-raw`."
  - **Mitigation**: I implemented a hybrid approach where standard Markdown syntax (blockquotes,
    code blocks) is styled to look like widgets, and I provided `PowerWidgets` components that
    _could_ be mapped if a custom parser is added later. For now, the Admin inserts snippets that
    standard Markdown renders legibly (e.g., blockquotes for recommendations).
- **Critique**: "Hotspots might not align if the image aspect ratio changes."
  - **Mitigation**: The `InteractiveDiagram` uses percentage-based positioning (`top: %`, `left: %`)
    which scales correctly with the image container.
- **Critique**: "Radar chart might be overwhelming on mobile."
  - **Mitigation**: `FrameworkRadar` is responsive and hidden/stacked on smaller screens via
    standard grid layouts.
