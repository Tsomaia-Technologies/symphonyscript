# RFC-032: Documentation Site (Docusaurus)

**Status**: Draft  
**Priority**: Low (Future)  
**Estimated Effort**: 2 days  
**Breaking Change**: None

---

## 1. Problem Statement

Manual docs in `docs/` work for development, but lack:

- **Search functionality** — Can't find methods quickly
- **Professional appearance** — GitHub markdown isn't polished
- **Versioned docs** — No way to see docs for older versions
- **Mobile-friendly** — Markdown rendering varies

---

## 2. Requirements

| ID   | Requirement                        | Priority  |
| ---- | ---------------------------------- | --------- |
| FR-1 | Full-text search                   | Must Have |
| FR-2 | Versioned documentation            | Should    |
| FR-3 | Mobile-responsive design           | Should    |
| FR-4 | Syntax highlighting for TypeScript | Must Have |
| FR-5 | Auto-deploy on push                | Should    |

---

## 3. Proposed Solution: Docusaurus

Use Docusaurus 3.x for static site generation.

### 3.1 Why Docusaurus

- Built by Meta, widely adopted
- First-class TypeScript support
- Built-in search (Algolia or local)
- Versioning out of the box
- MDX support (interactive examples)

### 3.2 Alternatives Considered

| Tool           | Pros                      | Cons                       |
| -------------- | ------------------------- | -------------------------- |
| **Docusaurus** | Full-featured, versioning | Heavier setup              |
| VitePress      | Fast, Vue-based           | Less mature versioning     |
| Nextra         | Next.js native            | Less documentation-focused |
| GitBook        | Beautiful                 | Paid for teams             |

---

## 4. Site Structure

```
website/
├── docusaurus.config.js
├── sidebars.js
├── docs/                  # Copied from repo docs/
│   ├── getting-started.md
│   ├── api/
│   ├── guides/
│   └── examples/
├── src/
│   └── pages/
│       └── index.js       # Landing page
├── static/
│   └── img/               # Logo, screenshots
└── versioned_docs/        # Auto-generated
```

---

## 5. Migration from docs/

1. Keep `docs/` as source of truth
2. Copy to `website/docs/` during build
3. Add frontmatter for Docusaurus (title, sidebar_position)
4. No duplication — single source

```yaml
# docs/getting-started.md
---
sidebar_position: 1
---
# Getting Started
```

---

## 6. Deployment

### GitHub Pages (Free)

```yaml
# .github/workflows/docs.yml
name: Deploy Docs
on:
  push:
    branches: [main]
    paths: ["docs/**", "website/**"]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: cd website && npm ci && npm run build
      - uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./website/build
```

### Custom Domain

- `docs.symphonyscript.dev` via CNAME

---

## 7. Search Configuration

### Option A: Local Search (Recommended)

Use `@easyops-cn/docusaurus-search-local`:

```js
// docusaurus.config.js
themes: [
  [
    "@easyops-cn/docusaurus-search-local",
    {
      hashed: true,
      language: ["en"],
      highlightSearchTermsOnTargetPage: true,
    },
  ],
];
```

### Option B: Algolia DocSearch

Free for open source, but requires application.

---

## 8. Prerequisites

Before implementing this RFC:

- [ ] RFC-029 complete (manual docs exist)
- [ ] Community interest justifies setup effort
- [ ] Domain purchased (optional)

---

## 9. Files to Create

| Path                           | Description             |
| ------------------------------ | ----------------------- |
| `website/`                     | Docusaurus project root |
| `website/docusaurus.config.js` | Site configuration      |
| `website/sidebars.js`          | Navigation structure    |
| `.github/workflows/docs.yml`   | Auto-deploy workflow    |

---

## 10. Approval

- [ ] Approved by maintainer
