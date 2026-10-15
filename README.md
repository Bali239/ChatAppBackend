# ChatApp backend

This is the TypeScript Express and Socket.IO backend package. It uses Google OAuth with Mongo-backed server sessions and connects to MongoDB before opening its HTTP listener. Chat APIs and realtime events are added incrementally on top of that identity boundary.

## Local setup

```sh
npm install
cp .env.example .env
# Set MONGODB_URI to a running local MongoDB instance or an Atlas URI.
npm run dev
```

The health endpoint is `GET http://localhost:<PORT>/health` (also available at `/api/v1/health`); the checked-in local example currently uses port `5000`, while the schema fallback is `4000`. `npm run build`, `npm start`, `npm run typecheck`, and `npm test` provide the production build, production start, strict type check, and test suite. The existing lint configuration belongs to the separate Next.js client; this backend package does not define a lint script.

## Environment

`MONGODB_URI` and `FRONTEND_URL` are required. `FRONTEND_URL` accepts one or more comma-separated exact HTTP(S) origins. Production requires HTTPS origins, `COOKIE_SECURE=true`, and the Cloudinary values below; `SameSite=None` also requires secure cookies. `PORT` is supplied by Render in deployment; locally it is read from `.env` (schema fallback `4000`). `.env.example` contains local development placeholders. Do not commit `.env` or put production secrets in source control.

Avatar uploads require `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `CLOUDINARY_AVATAR_UPLOAD_PRESET`. Keep the API secret server-side. Configure the named Cloudinary preset as **signed**, restrict formats to JPG/PNG/WebP, and set its maximum file size to 5 MB. The server signs a unique public ID and per-user hashed folder, then verifies the uploaded image through Cloudinary before saving it to the profile.

`SESSION_SECRET`, `COOKIE_NAME`, `COOKIE_SECURE`, and `COOKIE_SAME_SITE` configure the active HTTP and Socket.IO session boundary. State-changing HTTP routes use the session CSRF token. Do not expose session values in browser storage or logs.

For production, use a secret MongoDB URI from the deployment environment, set the exact HTTPS frontend origin(s), and terminate TLS correctly. Cookie settings must match the real deployment topology. Cross-site browser sessions may require `SameSite=None; Secure`, HTTPS, and CSRF protection for state-changing requests. Future sessions should use HTTP-only cookies, an appropriate expiry and revocation policy, and the Mongo-backed store; session IDs and tokens must not be placed in local storage.

## HTTP and Socket.IO

Express and Socket.IO share one Node HTTP server and the same Mongo-backed session middleware. Both use the configured origin allowlist and credentials policy. Socket handshakes validate session expiry and the active user; logout disconnects that user's sockets. The HTTP API has JSON parsing, cookie parsing, Helmet, compression, structured logging, a versioned prefix, and an in-memory rate limiter. Health reports process status separately from MongoDB readiness; the endpoint returns `503` while the database is unavailable.

Conversation and message access must authorize membership on every HTTP and socket operation; a successful handshake alone does not grant access to a conversation. Presence is initially process-local and requires shared infrastructure before horizontal scaling.

## Realtime Contract

All socket payloads are runtime-validated and use the authenticated session identity; client-supplied sender IDs are not accepted. Clients request `conversation:join` and `conversation:leave` with `{ conversationId }`; join succeeds only for a stored member. `message:send` accepts `{ conversationId, content, clientMessageId }`, persists before emitting `message:new`, and returns `message:ack` plus the optional acknowledgement callback. The idempotency key is unique per sender and conversation; a retry with different content is rejected.

`typing:start` and `typing:stop` accept `{ conversationId }`, are member-authorized, throttled, and expire after five seconds if a stop is lost. `message:delivered` accepts `{ conversationId, messageId }` and records delivery only when the authenticated recipient acknowledges an incoming visible message. `conversation:read` accepts the same position shape and advances a monotonic member read position only for a visible message in that conversation. The server emits `message:delivered`, `message:read`, `typing:update`, and `presence:update` to authenticated user rooms. **Sent** means persisted and acknowledged, **delivered** means recipient socket acknowledgement, and **read** means the recipient advanced their read position.

Presence uses in-memory per-user socket sets and covers multiple tabs on one server instance. It resets on process restart and is not shared across Render instances; horizontal scaling requires a shared presence store and compatible Socket.IO adapter. Socket events are transient; clients must reload cursor-paginated API history after reconnect.

## Database Preparation

Before enabling chat traffic on an existing database, run `npm run migrate:chat-data` from this package with the target `MONGODB_URI` configured. The idempotent command backfills the indexed normalized display-name field in bounded batches and creates indexes declared by the User, Conversation, ConversationMember, and Message models. Review the target URI carefully and run against staging first; the command performs writes but does not delete documents. It is a manual release step and is not run by server startup.

The server connects to MongoDB before listening and binds to `0.0.0.0`. `SIGINT` and `SIGTERM` stop the listener and Socket.IO clients before disconnecting Mongoose. See [docs/deployment.md](docs/deployment.md) for Vercel, Render, environment setup, connectivity checks, and the release checklist.