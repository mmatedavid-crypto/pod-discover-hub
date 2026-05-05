# Podiox

Minimal English-language podcast discovery and search.

## Stack
- **Frontend:** React 18 + Vite + Tailwind + React Router
- **Backend:** Lovable Cloud (Supabase Postgres + Auth + Edge Functions)
- **AI:** Lovable AI Gateway (Gemini / GPT) — no API key needed
- **RSS:** parsed server-side in the `fetch-rss` edge function

## Features
- Homepage with category sections, top 7–10 podcasts each
- Categories index + per-category page (top podcasts, latest episodes, popular topics)
- Podcast detail (links to Apple / Spotify / YouTube / Website + AI summary + episodes)
- Episode detail (AI summary + extracted topics, people, companies, tickers, ingredients)
- Search bar with `+` syntax: `cooking + asparagus`, `stocks + Occidental`, `AI + healthcare`
- Admin page: add podcast, fetch RSS, generate AI summary, mark featured

## Setup

### 1. Backend (already provisioned)
Lovable Cloud is already enabled. The schema (categories, podcasts, episodes, search_synonyms, user_roles) is migrated and seeded with 12 categories and 12 popular podcasts.

### 2. Make yourself admin
1. Go to `/auth` in the app, sign up with email + password.
2. Open Lovable Cloud → Users, copy your User ID.
3. Run this SQL in Cloud → SQL editor (the `/admin` page also shows the snippet):
   ```sql
   INSERT INTO public.user_roles (user_id, role)
   VALUES ('<your-user-id>', 'admin');
   ```
4. Refresh `/admin`.

### 3. Populate episodes
For each seeded podcast in `/admin`:
- Click **Fetch RSS** → pulls latest 25 episodes.
- Click **AI summary** → generates podcast summary.
- Click **AI enrich eps** → generates per-episode summaries + topics/people/companies/tickers.

### 4. Deploy
Click **Publish** in the top-right of the Lovable editor — your app goes live at a `.lovable.app` URL.
You can then attach `podiox.com` via Project Settings → Domains.

## Roadmap (not in MVP)
- Audio transcription
- Spotify audio download
- User accounts / comments / payments
