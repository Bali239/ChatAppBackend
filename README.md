# ChatApp backend

This is the TypeScript Express and Socket.IO backend package. It connects to MongoDB before opening its HTTP listener. No authentication or chat features are implemented yet.

## Local setup

```sh
npm install
cp .env.example .env
# Set MONGODB_URI to a running local MongoDB instance or an Atlas URI.
npm run dev
```

The API health endpoint is `GET http://localhost:4000/api/v1/health`. `npm run build`, `npm start`, `npm run typecheck`, and `npm test` provide the production build, production start, strict type check, and test suite. The existing lint configuration belongs to the separate Next.js client; this backend package does not define a lint script.

## Environment

`MONGODB_URI` and `FRONTEND_URL` are required. `FRONTEND_URL` accepts one or more comma-separated exact origins. `PORT` defaults to `4000`; `NODE_ENV` defaults to `development`; `LOG_LEVEL` defaults to `info`. `.env.example` contains local development placeholders. Do not commit `.env` or put production secrets in source control.

`SESSION_SECRET`, `COOKIE_NAME`, `COOKIE_SECURE`, and `COOKIE_SAME_SITE` are validated configuration placeholders for a future session implementation. No session middleware consumes these values yet, and no login or session authentication is available.

For production, use a secret MongoDB URI from the deployment environment, set the exact HTTPS frontend origin(s), and terminate TLS correctly. Cookie settings must match the real deployment topology. Cross-site browser sessions may require `SameSite=None; Secure`, HTTPS, and CSRF protection for state-changing requests. Future sessions should use HTTP-only cookies, an appropriate expiry and revocation policy, and the Mongo-backed store; session IDs and tokens must not be placed in local storage.

## HTTP and Socket.IO

Express and Socket.IO share one Node HTTP server. Both use the same configured origin allowlist and credentials policy. The HTTP API has JSON parsing, cookie parsing, Helmet, compression, structured logging, a versioned prefix, and an in-memory rate limiter. Health reports process status separately from MongoDB readiness; the endpoint returns `503` while the database is unavailable.

The Socket.IO gateway currently provides connection lifecycle logging only. It has no session validation, event handlers, or room access. It is development infrastructure only and is **not suitable for private production chat traffic** until cookie-session authentication is implemented and enforced during the socket handshake. Future HTTP and Socket.IO authentication must validate the same session, and room membership must be authorized server-side.

The server connects to MongoDB before listening. `SIGINT` and `SIGTERM` close Socket.IO and the HTTP server, then disconnect Mongoose.