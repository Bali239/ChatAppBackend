# ChatApp backend

This is the TypeScript Express and Socket.IO backend package. It connects to MongoDB before opening its HTTP listener. No authentication or chat features are implemented yet.

## Local setup

```sh
npm install
cp .env.example .env
# Set MONGODB_URI to a running local MongoDB instance or an Atlas URI.
npm run dev
```

The health endpoint is `GET http://localhost:<PORT>/health` (also available at `/api/v1/health`); the checked-in local example currently uses port `5000`, while the schema fallback is `4000`. `npm run build`, `npm start`, `npm run typecheck`, and `npm test` provide the production build, production start, strict type check, and test suite. The existing lint configuration belongs to the separate Next.js client; this backend package does not define a lint script.

## Environment

`MONGODB_URI` and `FRONTEND_URL` are required. `FRONTEND_URL` accepts one or more comma-separated exact HTTP(S) origins. Production requires HTTPS origins and `COOKIE_SECURE=true`; `SameSite=None` also requires secure cookies. `PORT` is supplied by Render in deployment; locally it is read from `.env` (schema fallback `4000`). `.env.example` contains local development placeholders. Do not commit `.env` or put production secrets in source control.

`SESSION_SECRET`, `COOKIE_NAME`, `COOKIE_SECURE`, and `COOKIE_SAME_SITE` are validated configuration placeholders for a future session implementation. No session middleware consumes these values yet, and no login or session authentication is available.

For production, use a secret MongoDB URI from the deployment environment, set the exact HTTPS frontend origin(s), and terminate TLS correctly. Cookie settings must match the real deployment topology. Cross-site browser sessions may require `SameSite=None; Secure`, HTTPS, and CSRF protection for state-changing requests. Future sessions should use HTTP-only cookies, an appropriate expiry and revocation policy, and the Mongo-backed store; session IDs and tokens must not be placed in local storage.

## HTTP and Socket.IO

Express and Socket.IO share one Node HTTP server. Both use the same configured origin allowlist and credentials policy. The HTTP API has JSON parsing, cookie parsing, Helmet, compression, structured logging, a versioned prefix, and an in-memory rate limiter. Health reports process status separately from MongoDB readiness; the endpoint returns `503` while the database is unavailable.

The Socket.IO gateway currently provides connection lifecycle logging only. It has no session validation, event handlers, or room access. It is development infrastructure only and is **not suitable for private production chat traffic** until cookie-session authentication is implemented and enforced during the socket handshake. Future HTTP and Socket.IO authentication must validate the same session, and room membership must be authorized server-side.

The server connects to MongoDB before listening and binds to `0.0.0.0`. `SIGINT` and `SIGTERM` stop the listener and Socket.IO clients before disconnecting Mongoose. See [docs/deployment.md](docs/deployment.md) for Vercel, Render, environment setup, connectivity checks, and the release checklist.