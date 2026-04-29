# Architecture Overview

## Component Diagram

```
┌────────────────────────────────────────────────────────────────┐
│                          Client(s)                             │
│           HTTP REST (fetch/axios)  +  WebSocket (socket.io)    │
└────────────────┬───────────────────────────┬───────────────────┘
                 │                           │
                 ▼                           ▼
┌────────────────────────────────────────────────────────────────┐
│                       NestJS App (port 3000)                   │
│                                                                │
│  ┌─────────────────────┐   ┌──────────────────────────────┐    │
│  │  REST Controllers   │   │   ChatGateway (/chat ns)     │    │
│  │  POST /api/v1/login │   │   OnGatewayConnection        │    │
│  │  GET /api/v1/rooms  │   │   OnGatewayDisconnect        │    │
│  │  POST /rooms/:id/.. │   │   SubscribeMessage           │    │
│  └────────┬────────────┘   └──────────────┬───────────────┘    │
│           │                               │                    │
│  ┌────────▼────────────────────────────── ▼───────────────┐    │
│  │                    Services                            │    │
│  │  AuthService  ·  RoomsService  ·  RedisService         │    │
│  └────────┬───────────────────────────────┬───────────────┘    │
│           │                               │                    │
└───────────┼───────────────────────────────┼────────────────────┘
            │                               │
            ▼                               ▼
   ┌─────────────────┐            ┌──────────────────┐
   │   PostgreSQL    │            │      Redis        │
   │  (Drizzle ORM)  │            │  sessions         │
   │  users          │            │  active users     │
   │  rooms          │            │  socket state     │
   │  messages       │            │  pub/sub channel  │
   └─────────────────┘            └──────────────────┘
```

### Flow: Sending a Message

```
Client ──POST /rooms/:id/messages──► REST Controller
                                          │
                                     RoomsService
                                       ├─ INSERT message → PostgreSQL
                                       └─ redis.publish("chat", { type:"message:new", ... })
                                                        │
                            ┌───────────────────────────┘
                            │  Redis pub/sub
                            ▼
                     ChatGateway (redisSub listener)
                            │
                     server.to(roomId).emit("message:new", ...)
                            │
                    All Socket.io clients in that room
                    (on every server instance)
```

---

## Session Strategy

1. **Login** — `POST /api/v1/login` accepts a `username`.  If the user does not exist in PostgreSQL it is created with a `usr_` prefixed nanoid. Either way, a 32-character random token is generated with `nanoid(32)`.
2. **Storage** — The token is stored in Redis as `session:<token> → userId` with a 24-hour TTL (`SETEX`).
3. **Validation** — Every protected HTTP request passes through `AuthGuard`, which reads the `Authorization: Bearer <token>` header, performs `GET session:<token>` in Redis, then loads the user row from PostgreSQL. Expired or unknown tokens return `401`.
4. **Expiry** — TTL is enforced by Redis. There is no refresh mechanism; clients re-login after expiry to obtain a new token.
5. **WebSocket** — The token is passed as a query parameter on connection (`?token=…`). The gateway performs the same Redis + DB lookup on `handleConnection`, disconnecting immediately on failure.

---

## Redis Pub/Sub — WebSocket Fan-out

When `POST /rooms/:id/messages` is called:

1. The message is saved to PostgreSQL.
2. `RedisService.publish("chat", JSON.stringify({ type:"message:new", roomId, message }))` is called.
3. Every running app instance has a `redisSub` client subscribed to the `"chat"` channel via `SUBSCRIBE`.
4. The `message` handler in `ChatGateway.onModuleInit` receives the payload on **all instances**.
5. Each instance calls `server.to(roomId).emit("message:new", ...)`, which delivers to all sockets in that room **local to that instance**.

The same channel carries `room:deleted` events so the delete REST call fans out to all connected clients on every instance without any direct socket reference.

This design means horizontal scaling requires zero shared in-memory state — all coordination goes through Redis.

---

## Active User Tracking

- On WebSocket connect: `SADD room:users:<roomId> <username>`, `SET socket:user:<socketId> <username>`, `SET socket:room:<socketId> <roomId>`.
- On disconnect or `room:leave`: `SREM room:users:<roomId> <username>`, delete the two socket keys.
- `GET /rooms` and `GET /rooms/:id` read active user count via `SCARD room:users:<roomId>`.
- Socket state keys (socket→user, socket→room) avoid any in-process JS Maps so they survive process restarts and work across multiple instances.

---

## Estimated Concurrent User Capacity (Single Instance)

| Resource | Limit |
|----------|-------|
| Node.js event loop | ~10 000–50 000 idle WebSocket connections |
| Postgres pool (default 10 connections) | bottleneck at ~500–1 000 msg/s |
| Redis (single-threaded, ~100k ops/s) | not the bottleneck |
| RAM | ~50–200 MB for 10 000 sockets |

**Practical estimate: 5 000–10 000 concurrent WebSocket connections** on a 1 vCPU / 512 MB instance, assuming typical chat traffic (≤1 msg/s per user). The Postgres connection pool is the first bottleneck under write load.

---

## Scaling to 10× Load

1. **Horizontal app scaling** — Run 3–5 app replicas behind a load balancer with sticky sessions (or omit sticky sessions because pub/sub ensures all instances handle events). The current pub/sub design already supports this.
2. **Postgres connection pooling** — Add PgBouncer in front of PostgreSQL to multiplex many app connections onto a small Postgres connection pool. Increase the Drizzle pool size per instance.
3. **Redis Cluster** — Move to Redis Cluster or a managed Redis (ElastiCache / Upstash) for higher throughput and HA. The `@socket.io/redis-adapter` supports cluster mode.
4. **Read replicas** — Route `SELECT` queries (room listing, message history) to a read replica.
5. **Message pagination** — Add a `created_at` index on `messages(room_id, created_at DESC)` for fast cursor pagination.
6. **Rate limiting** — Add per-user rate limiting on `POST /rooms/:id/messages` to prevent abuse.

---

## Known Limitations & Trade-offs

| Area | Limitation |
|------|------------|
| **Sessions** | No token refresh. Users must re-login after 24 h. |
| **Active user set** | A `username` can appear once per room regardless of how many tabs the same user opens. The last disconnect removes them from the set even if another tab is still connected. A socket-count approach (e.g. incrementing a counter) would fix this but adds complexity. |
| **Message ordering** | Messages are returned ordered by `created_at DESC` (newest first). Ties at the same millisecond are undefined. |
| **No message delivery guarantee** | If a WebSocket client is disconnected at delivery time, the message is not re-queued. Clients must use the REST history endpoint to catch up. |
| **Cascade deletes** | Deleting a room cascades to messages at the DB level, which is efficient but means deleted messages are unrecoverable. |
| **Pub/sub channel** | A single `"chat"` channel carries all room events. At very high volume this becomes a hotspot. Per-room channels would reduce unnecessary fan-out. |
| **No TLS / auth on WebSocket** | In production, TLS termination should happen at the load balancer. The token passed in the query string is visible in server logs — use headers or a handshake handoff in production. |
