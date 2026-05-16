# Frontend Requirements

## Required Frontend Stack

The frontend application lives in:

```text
app.ui-reactjs/
```

It must use:

- React
- Vite
- TypeScript
- TailwindCSS
- shadcn/ui
- React Query
- Zustand
- WaveSurfer.js
- HLS.js
- TanStack Table
- Recharts
- Tremor React
- Lucide React

---

## Frontend Architecture Rules

### React + Vite

Use React with Vite for fast development and production builds.

Rules:

- use functional components
- use TypeScript everywhere
- avoid JavaScript-only files unless necessary
- keep components small and reusable
- use route-based code splitting where useful

---

## Styling

Use:

- TailwindCSS for styling
- shadcn/ui for base UI components
- Tremor React for dashboard analytics components
- Lucide React for icons

Rules:

- avoid custom CSS unless necessary
- prefer design tokens and Tailwind utilities
- keep admin/staff/artist/listener layouts visually distinct but consistent

---

## State Management

Use:

- React Query for server state
- Zustand for client UI state

React Query should manage:

- API fetching
- caching
- mutations
- invalidation
- optimistic updates

Zustand should manage:

- audio player state
- sidebar state
- active queue
- selected track
- local UI preferences
- Skiza editor state

---

## Tables

Use TanStack Table for:

- track library
- duplicate review
- staff activity logs
- audit logs
- sync jobs
- backup jobs
- user management

Tables must support:

- sorting
- filtering
- pagination
- column visibility
- row selection
- bulk actions

---

## Charts and Dashboards

Use:

- Tremor React for dashboard cards and analytics layouts
- Recharts for custom visualizations

Charts should support:

- stream trends
- storage usage
- listener growth
- top tracks
- top artists
- sync health
- backup health
- worker queue metrics

---

## Audio and Streaming

Use:

- HLS.js for adaptive bitrate playback
- WaveSurfer.js for waveform preview/editing

HLS.js is required for:

- adaptive bitrate streaming
- low-bandwidth playback
- future CDN-backed streaming

WaveSurfer.js is required for:

- Skiza editor
- clip selection
- waveform display
- region selection
- playback preview

---

## Skiza Editor Requirements

The Skiza editor must support:

- waveform loading
- region selection
- clip start/end editing
- preview playback
- fade in/out controls
- loudness normalization option
- save draft
- submit for review
- export status display

Do not hardcode Safaricom-specific logic directly into the frontend.

Use provider-based backend APIs.

---

## Recommended Frontend Folder Structure

```text
app.ui-reactjs/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── components.json
│
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── api/
    ├── hooks/
    ├── store/
    ├── routes/
    ├── layouts/
    ├── pages/
    │   ├── admin/
    │   ├── staff/
    │   ├── artist/
    │   ├── listener/
    │   └── auth/
    │
    ├── components/
    │   ├── ui/
    │   ├── player/
    │   ├── tables/
    │   ├── charts/
    │   ├── skiza/
    │   ├── upload/
    │   ├── artists/
    │   ├── tracks/
    │   └── dashboard/
    │
    ├── features/
    │   ├── auth/
    │   ├── admin/
    │   ├── staff/
    │   ├── artist/
    │   ├── listener/
    │   ├── tracks/
    │   ├── streaming/
    │   ├── skiza/
    │   ├── analytics/
    │   └── uploads/
    │
    ├── lib/
    ├── utils/
    └── types/
```

---

## UI Design Requirements

The UI should feel like:

```text
Plex + Spotify + archival CMS + analytics dashboard
```

Design goals:

- clean
- fast
- media-first
- dashboard-friendly
- usable by non-technical staff
- optimized for large music libraries

---

## Required Pages

### Admin

- dashboard
- users
- artists
- tracks
- uploads
- duplicates
- analytics
- sync jobs
- backup jobs
- audit logs
- Skiza approvals

### Staff

- dashboard
- my uploads
- assigned tracks
- metadata tasks
- duplicate review
- Skiza editor
- activity log

### Artist

- dashboard
- my tracks
- my albums
- profile
- analytics
- ownership requests

### Listener

- home
- search
- artist page
- album page
- track page
- playlists
- favorites
- now playing

---

## API Integration Rules

- all API calls must go through `src/api`
- use typed request/response models
- use React Query hooks for API state
- never fetch directly inside deeply nested components unless necessary
- handle loading, empty, and error states

---

## Accessibility

Frontend must support:

- keyboard navigation
- semantic HTML
- readable contrast
- screen-reader labels
- visible focus states
