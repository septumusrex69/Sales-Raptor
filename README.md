# Sales Raptor CRM

A lightweight internal sales & lead management CRM built for Bredell Ferreira. Tracks the full sales process — lead capture, qualification, deal pipeline, tasks, activities and reporting — in one clear workflow from first enquiry to signed client.

## Stack

- React 19 + TypeScript + Vite
- Tailwind CSS v4
- React Router
- Recharts (dashboard & report charts)
- In-memory mock data store (`src/store/AppStore.tsx`) — no backend required to explore the app

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173.

```bash
npm run build   # type-check + production build
npm run lint     # oxlint
```

## Feature Coverage (MVP)

- **Dashboard** — KPI cards, sales pipeline funnel, leads by source, top deals, recent activities, tasks due
- **Leads** — filterable list, quick actions (call/email/WhatsApp/convert/reassign/mark lost), lead detail with activity timeline
- **Deals** — Kanban pipeline (drag & drop) + table view, deal detail with Overview/Activities/Tasks/Documents/Proposals/Notes/History tabs, Won/Lost flows
- **Contacts & Companies** — linked records with deals, activities, tasks and notes
- **Tasks** — views (My Tasks, Overdue, Today, This Week, Completed), priorities, reschedule
- **Calendar** — Month/Week/Day views of tasks and deal close dates
- **Activities** — company-wide activity feed with filters
- **Reports** — lead, pipeline, salesperson, source and lost-deal analysis, sales forecast
- **Settings** — profile, users, teams, pipelines, custom fields, lead sources, lost reasons, notifications, integrations
- **Global search & Quick Add** — available from every page

All data is seeded mock data held in memory for the session (see `src/data/mockData.ts`); there is no persistence layer yet.
