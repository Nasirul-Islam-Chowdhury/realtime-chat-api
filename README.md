# Anonymous Chat API

A real-time group chat service built with NestJS, PostgreSQL, Drizzle ORM, Redis, and Socket.io.

---

## Prerequisites

- Node.js 20+
- Docker & Docker Compose (for local Postgres + Redis)

---

## Quick Start (Local)

### 1. Install dependencies

```bash
npm install
```

### 2. Start infrastructure

```bash
docker-compose up postgres redis -d
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env if your credentials differ
```

Default `.env`:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hypomatrix
REDIS_URL=redis://localhost:6379
PORT=3000
```

### 4. Run database migrations

```bash
npm run migrate
```

### 5. Start the server

```bash
# Development (watch mode)
npm run start:dev

# Production build
npm run build && npm run start:prod
```

The API is available at `http://localhost:3000`.

---

## Full Docker Stack

To run everything (app + Postgres + Redis) in Docker:

```bash
docker-compose up --build
```

---

## REST API

**Base path:** `/api/v1`
**Content type:** `application/json`
**Auth:** `Authorization: Bearer <sessionToken>` on all routes except `POST /login`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/login` | Get or create user, return session token |
| GET | `/api/v1/rooms` | List all rooms |
| POST | `/api/v1/rooms` | Create a room |
| GET | `/api/v1/rooms/:id` | Get room details |
| DELETE | `/api/v1/rooms/:id` | Delete a room (creator only) |
| GET | `/api/v1/rooms/:id/messages` | Paginated message history |
| POST | `/api/v1/rooms/:id/messages` | Send a message |

All responses follow the envelope format:

```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```

---

## WebSocket

Connect to the `/chat` namespace:

```
ws://localhost:3000/chat?token=<sessionToken>&roomId=<roomId>
```

**Server → Client events:**

| Event | Recipient | Payload |
|-------|-----------|---------|
| `room:joined` | Connecting client only | `{ activeUsers: string[] }` |
| `room:user_joined` | All other clients in room | `{ username, activeUsers }` |
| `message:new` | All clients in room | `{ id, username, content, createdAt }` |
| `room:user_left` | All clients in room | `{ username, activeUsers }` |
| `room:deleted` | All clients in room | `{ roomId }` |

**Client → Server events:**

| Event | Payload | Description |
|-------|---------|-------------|
| `room:leave` | none | Graceful disconnect |

---

## Running Tests

```bash
npm test
```
