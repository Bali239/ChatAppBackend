# ChatApp backend

This is the TypeScript Express and Socket.IO backend package. It uses Google OAuth to issue short-lived bearer access tokens and connects to MongoDB before opening its HTTP listener.

## Local setup

```sh
npm install
cp .env.example .env
# Set MONGODB_URI to a running local MongoDB instance or an Atlas URI.
npm run dev
```

The health endpoint is `GET http://localhost:<PORT>/health` (also available at `/api/v1/health`); the checked-in local example currently uses port `5000`, while the schema fallback is `4000`. `npm run build`, `npm start`, `npm run typecheck`, and `npm test` provide the production build, production start, strict type check, and test suite. The existing lint configuration belongs to the separate Next.js client; this backend package does not define a lint script.

## Environment

`MONGODB_URI`, `FRONTEND_URL`, and `AUTH_TOKEN_SECRET` are required. `FRONTEND_URL` accepts one or more comma-separated exact HTTP(S) origins. Production requires HTTPS origins and the Cloudinary values below. `AUTH_TOKEN_SECRET` must be a private random value of at least 32 characters and must match across HTTP and Socket.IO. `PORT` is supplied by Render in deployment; locally it is read from `.env` (schema fallback `4000`). `.env.example` contains local development placeholders. Do not commit `.env` or put production secrets in source control.

Avatar uploads require `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and `CLOUDINARY_AVATAR_UPLOAD_PRESET`. Keep the API secret server-side. Configure the named Cloudinary preset as **signed**, restrict formats to JPG/PNG/WebP, and set its maximum file size to 5 MB. The server signs a unique public ID and per-user hashed folder, then verifies the uploaded image through Cloudinary before saving it to the profile.

Google OAuth is configured with the Google client ID, secret, and callback URL listed in `.env.example`. The callback returns an access token and refresh token in the URL fragment. The browser validates OAuth state, removes the fragment, and stores the tokens in local storage so sign-in survives page refreshes. Protected HTTP requests use `Authorization: Bearer`; Socket.IO sends the access token in its handshake auth payload. Access tokens expire after 15 minutes and refresh tokens rotate for up to 30 days. No authentication cookies are used.

For production, set a private MongoDB URI and `AUTH_TOKEN_SECRET` in the deployment environment, allow only the exact HTTPS frontend origin(s), and terminate TLS correctly. MongoDB stores refresh-token hashes and session rotation/revocation metadata; plaintext refresh tokens are never stored. Browser local storage is accessible to JavaScript, so protect the frontend against cross-site scripting and never log bearer tokens. Logout revokes the current session and disconnects its sockets.

## HTTP and Socket.IO

Express and Socket.IO share one Node HTTP server and validate bearer tokens against MongoDB. Both use the configured exact origin allowlist, with CORS credentials disabled. Socket handshakes validate token expiry, session revocation, and active user; logout disconnects sockets for the revoked session. The HTTP API has JSON parsing, Helmet, compression, structured logging, a versioned prefix, and an in-memory rate limiter. Health reports process status separately from MongoDB readiness; the endpoint returns `503` while the database is unavailable.

Conversation and message access must authorize membership on every HTTP and socket operation; a successful handshake alone does not grant access to a conversation. Presence is initially process-local and requires shared infrastructure before horizontal scaling.

## Realtime Contract

All socket payloads are runtime-validated and use the authenticated token identity; client-supplied sender IDs are not accepted. Clients request `conversation:join` and `conversation:leave` with `{ conversationId }`; join succeeds only for a stored member. `message:send` accepts `{ conversationId, content, clientMessageId }`, persists before emitting `message:new`, and returns `message:ack` plus the optional acknowledgement callback. The idempotency key is unique per sender and conversation; a retry with different content is rejected.

`typing:start` and `typing:stop` accept `{ conversationId }`, are member-authorized, throttled, and expire after five seconds if a stop is lost. `message:delivered` accepts `{ conversationId, messageId }` and records delivery only when the authenticated recipient acknowledges an incoming visible message. `conversation:read` accepts the same position shape and advances a monotonic member read position only for a visible message in that conversation. The server emits `message:delivered`, `message:read`, `typing:update`, and `presence:update` to authenticated user rooms. **Sent** means persisted and acknowledged, **delivered** means recipient socket acknowledgement, and **read** means the recipient advanced their read position.

Presence uses in-memory per-user socket sets and covers multiple tabs on one server instance. It resets on process restart and is not shared across Render instances; horizontal scaling requires a shared presence store and compatible Socket.IO adapter. Socket events are transient; clients must reload cursor-paginated API history after reconnect.

## Database Preparation

Before enabling chat traffic on an existing database, run `npm run migrate:chat-data` from this package with the target `MONGODB_URI` configured. The idempotent command backfills the indexed normalized display-name field in bounded batches and creates indexes declared by the User, Conversation, ConversationMember, and Message models. Review the target URI carefully and run against staging first; the command performs writes but does not delete documents. It is a manual release step and is not run by server startup.

The server connects to MongoDB before listening and binds to `0.0.0.0`. `SIGINT` and `SIGTERM` stop the listener and Socket.IO clients before disconnecting Mongoose. See [docs/deployment.md](docs/deployment.md) for Vercel, Render, environment setup, connectivity checks, and the release checklist.
