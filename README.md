# Road Safety MVP (Web First)

Web-first MVP for Road Safety with a monorepo structure:

- `apps/web` - Next.js + TypeScript + Tailwind CSS
- `apps/api` - Node.js + Express + TypeScript + Socket.IO
- `infra/sql` - PostgreSQL schema and seed SQL

## Features delivered

- OpenStreetMap + Leaflet live map
- Browser geolocation + periodic live location updates to backend
- SOS emergency button + API endpoint
- Emergency contacts CRUD (API + UI)
- Incident reporting (API + UI) + recent incidents list
- Nearby responders from backend mock dataset with distance filtering
- Socket.IO realtime events for incidents and location updates
- `.env.example` files for both web and api
- Basic validation and centralized API error handling

## Prerequisites

- Node.js 20+
- npm 10+
- PostgreSQL 14+

## 1) Database setup

Create a PostgreSQL database (example: `roadsafety`) and run:

```bash
psql "$DATABASE_URL" -f infra/sql/001_schema.sql
psql "$DATABASE_URL" -f infra/sql/002_seed.sql
```

## 2) API setup (`apps/api`)

```bash
cd /home/runner/work/roadSfatey/roadSfatey/apps/api
cp .env.example .env
# update DATABASE_URL and optionally CORS_ORIGIN
npm install
npm run dev
```

Runs on `http://localhost:4000`.

## 3) Web setup (`apps/web`)

```bash
cd /home/runner/work/roadSfatey/roadSfatey/apps/web
cp .env.example .env.local
# update NEXT_PUBLIC_API_URL if needed
npm install
npm run dev
```

Runs on `http://localhost:3000`.

## API quick reference

- `GET /health`
- `GET /api/contacts?userId=demo-user`
- `POST /api/contacts`
- `PUT /api/contacts/:id`
- `DELETE /api/contacts/:id?userId=demo-user`
- `GET /api/incidents?limit=20`
- `POST /api/incidents`
- `POST /api/sos`
- `POST /api/location-updates`
- `GET /api/responders/nearby?latitude=12.97&longitude=77.59&radiusKm=15`

## Assumptions

- Single default demo user (`demo-user`) is used for MVP interactions.
- Authentication is intentionally out of scope for MVP.
- Responders are mock seed records in PostgreSQL for demo purposes.

## Next steps

- Add auth/session (JWT or OAuth)
- Add role-based dashboards (dispatcher/responders)
- Add push/SMS notifications for SOS
- Add automated tests for API and web flows
