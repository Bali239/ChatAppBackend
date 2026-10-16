# Deployment Guide

This workspace contains two independent Git repositories. Deploy the client and server separately; no deployment or hosted service has been performed as part of this guide.

## Environment Matrix

| Variable | Owner | Local development | Vercel Preview | Vercel Production / Render |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Vercel client build | `http://localhost:5000/api/v1` (match server `PORT`) | Staging backend URL ending in `/api/v1` | Production Render URL ending in `/api/v1` |
| `NEXT_PUBLIC_SOCKET_URL` | Vercel client build | Backend origin, e.g. `http://localhost:5000` | Staging backend origin | Production Render origin |
| `MONGODB_URI` | Server runtime | Local MongoDB or development Atlas database | Staging Render secret | Production Render secret |
| `GEMINI_API_KEY` | Server runtime secret | Optional for `@ai` replies | Optional staging secret | Optional production secret |
| `FRONTEND_URL` | Server runtime | Exact `http://localhost:3000` origin | Exact stable Preview origin(s), on staging only | Exact production Vercel origin(s) |
| `AUTH_TOKEN_SECRET` | Server runtime secret | Private random value, at least 32 characters | Separate staging secret | Private production secret, at least 32 characters |
| `CLOUDINARY_CLOUD_NAME` | Server runtime | Optional while avatar uploads are disabled | Staging Cloudinary account | Production Cloudinary account |
| `CLOUDINARY_API_KEY` | Server runtime secret | Optional while avatar uploads are disabled | Staging secret | Production secret |
| `CLOUDINARY_API_SECRET` | Server runtime secret | Optional while avatar uploads are disabled | Staging secret | Production secret |
| `CLOUDINARY_AVATAR_UPLOAD_PRESET` | Server runtime | Optional while avatar uploads are disabled | Signed staging preset | Signed production preset |
| `PORT` | Render runtime / local server | `.env` value; example is `5000` | Render-assigned | Render-assigned |
| `NODE_ENV` | Server runtime | `development` | `production` on Render | `production` |
| `LOG_LEVEL` | Server runtime | `info` | `info` | `info` or `warn` |

The public Next.js variables are embedded at build time. Changing them in Vercel requires a new build. They are URLs, not secrets. Do not add MongoDB credentials, OAuth credentials, `AUTH_TOKEN_SECRET`, or other private values to `NEXT_PUBLIC_*` variables.

## Local Development

1. Start a local MongoDB instance or use a dedicated development database. Copy `server/.env.example` to `server/.env`, set `MONGODB_URI`, and keep `FRONTEND_URL` set to the exact frontend origin.
2. Start the backend from the server repository with `npm ci && npm run dev`. The checked-in example sets `PORT=5000`; if you choose another port, use the same port in both client URLs.
3. Copy `client/.env.example` to `client/.env.local`, set `NEXT_PUBLIC_API_URL` to `http://localhost:<PORT>/api/v1` and `NEXT_PUBLIC_SOCKET_URL` to `http://localhost:<PORT>`, then run `npm ci && npm run dev` in the client repository.
4. Check `http://localhost:<PORT>/api/v1/health`. It returns `200` only when MongoDB is connected and `503` otherwise.
5. For local Google login, add `http://localhost:3000` as an Authorized JavaScript origin and `http://localhost:5000/api/v1/auth/google/callback` as an Authorized redirect URI on the Google OAuth Web client. Keep the matching local values in `server/.env`; the Vercel/Render production redirect is a separate URI.

## Vercel Client

The client is its own repository, so set the Vercel project root to that repository's root (`./`), not a `client/` subdirectory. Use the detected Next.js framework and `npm run build`; retain the committed `package-lock.json` and default install detection. Use a supported Node.js release (Next.js 16 requires Node.js 20.9 or newer).

Configure `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SOCKET_URL` separately in Vercel's Development, Preview, and Production environments. Development points to local services. Preview must point only to a staging Render service and staging database. Production points to the production Render service. Use a stable, explicitly configured Preview domain if the backend needs to allow Preview; never reflect arbitrary `*.vercel.app` origins or share production database credentials with Preview.

## Render Backend

The server is its own repository; use that repository root as the Render service root. [`render.yaml`](../render.yaml) defines a Node Web Service with:

- Build: `npm ci --include=dev && npm run build`
- Start: `npm start` (runs the compiled `dist/server.js`)
- Health check: `/api/v1/health`
- Automatic deploys disabled so deployment remains an explicit release action

Render supplies `PORT`. The server binds to `0.0.0.0`, connects to MongoDB before listening, and returns `503` from the health path until MongoDB is ready. Supply `MONGODB_URI` as a Render secret and set `FRONTEND_URL` to exact HTTPS origins. Use separate staging and production services/databases. Choose an always-on Render plan appropriate for long-lived Socket.IO connections; do not rely on ephemeral in-memory state across restarts.

For Atlas, use a dedicated database user with least privilege and add the Render service's currently documented outbound IP ranges to Atlas Network Access. Allow local developer IPs only as needed. Avoid `0.0.0.0/0`; never place the connection string in source control or logs.

## Chat Database Migration

Before enabling chat traffic on an existing database, run `npm run migrate:chat-data` from the server package with the intended `MONGODB_URI`. This manual, idempotent migration backfills `normalizedDisplayName` for existing users in bounded batches and creates the indexes declared by the chat models. It does not run automatically at startup and does not delete data. Run it against staging first, verify the selected database, and schedule it as a release operation because index creation can consume database resources.

## Cloudinary Avatar Setup

Create a separate Cloudinary upload preset for each environment. Set it to **signed**, allow only `jpg`, `png`, and `webp`, and configure a maximum file size of `5242880` bytes. Do not expose `CLOUDINARY_API_SECRET` to Vercel or any `NEXT_PUBLIC_*` variable. The authenticated server signature binds the upload to a generated public ID and a per-user hashed folder. After direct upload, the client submits only the public ID; the server looks up and verifies the resource, owner folder, resource type, format, and actual byte count before changing the profile. Run an end-to-end upload check against staging credentials before enabling production uploads.

## CORS and Authentication Boundary

Express and Socket.IO use the same exact `FRONTEND_URL` allowlist. CORS credentials are disabled; protected HTTP calls send `Authorization: Bearer <access-token>`, and Socket.IO sends the token in its `auth` handshake payload. A browser origin not on the list is rejected; requests without an `Origin` header remain usable for non-browser clients. CORS is not authentication or authorization. An allowed origin does not grant access to user data.

Google OAuth uses a short-lived signed state. After callback verification, the API sends a 15-minute access token and a 30-day refresh token in the URL fragment; the frontend validates the state, strips the fragment from browser history, and stores the tokens in local storage so a page refresh keeps the user signed in. MongoDB stores only a SHA-256 hash of each active refresh token, with session identity, expiry, revocation, and rotation metadata. The refresh endpoint rotates tokens and revokes a session if a previously rotated token is reused. Browser local storage is accessible to JavaScript, so protect the frontend against cross-site scripting and never log bearer tokens. Logout revokes the current session and disconnects its sockets. No authentication cookies or CSRF endpoint are used.

The Socket.IO handshake validates the bearer token and checks the active user and token revocation version. Conversation joins, message sends, delivery/read receipts, and typing events verify membership server-side. CORS alone must never be treated as an access control. Process-local presence is limited to one backend instance until a shared presence store and compatible Socket.IO adapter are deployed. Socket events are not durable; clients must recover missed messages through the cursor-paginated history API after reconnect.

## Connectivity Checks

Run the automated checks from each repository root:

```sh
# Client
npm ci
npm run lint && npm run typecheck && npm test && npm run build

# Server
npm ci
npm run typecheck && npm test && npm run build
```

The server integration test starts a local ephemeral listener and checks health, trusted CORS, untrusted-origin rejection, bearer-authenticated HTTP and Socket.IO, and an unavailable endpoint without a real database. To probe a hosted service manually, use its health URL and compare a trusted origin response with an untrusted one:

```sh
curl -i https://your-backend.onrender.com/api/v1/health
curl -i -H 'Origin: https://your-frontend.example' https://your-backend.onrender.com/api/v1/health
curl -i -H 'Origin: https://untrusted.example' https://your-backend.onrender.com/api/v1/health
```

The trusted response should include the exact `Access-Control-Allow-Origin`; it should not include `Access-Control-Allow-Credentials`. The untrusted response must not grant CORS permission. Verify Socket.IO from the browser network panel or an authorized client; do not infer a successful WebSocket connection from a healthy HTTP response alone.

## Troubleshooting

- **Failed Vercel build:** confirm the Vercel root is the client repository root, Node.js is supported, `npm ci` uses the committed lockfile, and public API/socket variables are configured for the target environment before building.
- **Unhealthy Render service:** inspect deploy logs, confirm `npm run build` outputs `dist/server.js`, verify Render supplies `PORT`, and check that `MONGODB_URI` and `FRONTEND_URL` are set. The health endpoint intentionally remains `503` until MongoDB connects.
- **MongoDB connection failure:** check URI syntax, database user permissions, Atlas Network Access, DNS/SRV resolution, and Render outbound IP configuration. Never paste credentials into logs or issue reports.
- **CORS failure:** compare the browser's exact scheme/host/port with `FRONTEND_URL`; check preflight status and credential headers. Do not use `*` or unrestricted origin reflection with credentials.
- **Socket.IO failure:** check the client endpoint is the backend origin (not `/api/v1`), confirm Socket.IO protocol compatibility and backend logs, and remember that restarts can disconnect clients. Reconnection does not preserve session or business state.

## Release Checklist

- [ ] Client and server changes are reviewed in their respective repositories; lockfiles match manifests.
- [ ] Client lint, typecheck, tests, and production build pass; server typecheck, tests, and production build pass.
- [ ] Preview points to staging only, with no production database or secret reuse.
- [ ] Vercel Production has the correct API base URL and separate Socket.IO origin.
- [ ] Render has `NODE_ENV=production`, secret `MONGODB_URI`, private `AUTH_TOKEN_SECRET`, exact HTTPS `FRONTEND_URL`, and a health check at `/api/v1/health`.
- [ ] Atlas network access allows only required sources; credentials are not in tracked files.
- [ ] Hosted health and CORS checks pass, and the browser confirms Socket.IO connectivity.
- [ ] No private chat traffic is enabled before shared HTTP/socket authentication and authorization are implemented.

Local builds and checks can verify code and the isolated integration path. They do not verify Vercel or Render deployment, live Atlas access, or OAuth behavior on deployed domains; those require provider access, configured secrets, and the deployed domains.
