# Postman API Smoke and Workflow Test Plan

Use this plan against a **staging** deployment and staging database only. The API uses Google OAuth and Mongo-backed HTTP sessions. Keep session cookies, OAuth codes, and secrets local; do not save them in a shared collection or commit them to the repository.

## 1. Postman Setup

Create a Postman environment with these variables:

| Variable | Initial value | Purpose |
| --- | --- | --- |
| `baseUrl` | `https://<staging-render-host>` | Backend origin, without a trailing slash |
| `frontendUrl` | `https://<staging-frontend-host>` | Exact staging frontend origin |
| `userAId` | blank | ID returned by `/auth/me` for test account A |
| `userBId` | blank | ID returned by `/auth/me` for test account B |
| `userCId` | blank | Optional nonmember test account |
| `conversationId` | blank | Direct conversation created during the workflow |
| `messageId` | blank | ID of a staged message used for read-position checks |
| `cursor` | blank | Next-page cursor returned by a list endpoint |
| `csrfToken` | blank | CSRF token for the currently active test account session |

Use Postman’s cookie manager for `{{baseUrl}}`. Sign in to the staging app as a Google test account, then copy that account’s `__Host-chat_session` cookie into Postman’s local cookie jar for the exact staging Render hostname. Never put the cookie value in an environment variable, request body, shared workspace, or exported collection. When switching accounts, replace the cookie and fetch a fresh CSRF token.

Run the main workflow with two staging Google accounts (A and B). A third account (C) is needed only for the nonmember isolation check. Use disposable staging profiles and data.

## 2. Common Postman Assertions

For successful JSON endpoints, assert that the response has the expected status and the common envelope:

```javascript
pm.test("has the API response envelope", () => {
  const body = pm.response.json();
  pm.expect(body).to.have.property("statusCode", pm.response.code);
  pm.expect(body).to.have.property("message").that.is.a("string");
  pm.expect(body).to.have.property("data");
});
```

For error checks, assert both the HTTP status and `data.code`; do not treat a JSON error response as a successful API check just because it parsed.

## 3. Service and Session Checks

| Step | Request | Expected result |
| --- | --- | --- |
| 1 | `GET {{baseUrl}}/api/v1/health` | `200`; `data.ready` is `true`; `data.dependencies.mongodb` is `connected` |
| 2 | Clear the Postman cookie jar, then `GET {{baseUrl}}/api/v1/auth/me` | `401`; `data.code` is `AUTH_REQUIRED` |
| 3 | Sign in as account A in the staging frontend. Confirm Google returns to the staging backend callback and the frontend return URL. Add A’s backend cookie to Postman locally. | Browser completes OAuth and stores `__Host-chat_session` for the staging Render hostname |
| 4 | `GET {{baseUrl}}/api/v1/auth/csrf` | `200`; save `data.csrfToken` to `csrfToken` |
| 5 | `GET {{baseUrl}}/api/v1/auth/me` | `200`; `data.user` contains A’s expected `id`, `name`, and `email`; save the ID to `userAId` |

The callback URL must be configured for the staging backend in both Render and Google Cloud Console. The staging frontend origin must also be in the backend’s exact origin and redirect allowlists.

## 4. User and Conversation Workflow

### Users (as A)

1. `GET {{baseUrl}}/api/v1/users?limit=20` returns `200` and a `data.users` collection; A is not included in the eligible-user results.
2. `GET {{baseUrl}}/api/v1/users/search?q=<known-name-fragment>&limit=20` returns `200` with matching eligible users.
3. `GET {{baseUrl}}/api/v1/users/{{userBId}}` returns `200` with B’s public profile.
4. Verify validation and lookup failures: malformed user ID and out-of-range `limit` return `400` with `VALIDATION_FAILED`; a one-character search query returns `400` with `INVALID_SEARCH_QUERY`; a valid but unknown user ID returns `404` with `USER_NOT_FOUND`.
5. If a list/search response has `hasMore: true`, save `nextCursor` to `cursor` and repeat the request with `&cursor={{cursor}}`; verify the next page is returned.

### CSRF and profile (as A)

1. Save A’s original display name from `/auth/me` for later restoration.
2. Send `PATCH {{baseUrl}}/api/v1/users/me/profile` with JSON `{"displayName":"Postman Staging A"}` and no `X-CSRF-Token`; expect `403` with `CSRF_INVALID`.
3. Repeat with `X-CSRF-Token: {{csrfToken}}`; expect `200` and the updated display name.
4. Restore A’s original display name using the current CSRF token.
5. Send an empty or invalid profile update body with a valid CSRF token; expect `400` with `VALIDATION_FAILED`.

### Direct conversation and history

1. As A, send `POST {{baseUrl}}/api/v1/conversations/direct/{{userBId}}` with `X-CSRF-Token: {{csrfToken}}`, `Content-Type: application/json`, and body `{}`. Expect `200`; save `data.conversationId` as `conversationId`.
2. Repeat the request and verify it returns the same `conversationId` (direct conversation creation is idempotent).
3. `GET {{baseUrl}}/api/v1/conversations?limit=20` returns `200` and includes that conversation.
4. `GET {{baseUrl}}/api/v1/conversations/{{conversationId}}/messages?limit=30` returns `200` with the visible message page.
5. For a positive read-position check, sign in as A and B in the staging app and exchange one test message in the created conversation. As the receiving account, fetch message history and save the received message ID as `messageId`.
6. As the receiver, send `POST {{baseUrl}}/api/v1/conversations/{{conversationId}}/read` with the active CSRF token and body `{"messageId":"{{messageId}}"}`. Expect `200` with the read position updated.
7. Send `POST {{baseUrl}}/api/v1/conversations/{{conversationId}}/clear` with the active CSRF token and body `{}`. Expect `200`; fetch history again and confirm the cleared message is no longer visible to that account.
8. Verify invalid conversation IDs or read positions return `400` with `VALIDATION_FAILED` or `INVALID_READ_POSITION` as appropriate.

### Account isolation (optional third staging account C)

1. As C, establish a staging session and fetch a new CSRF token.
2. Request A-B’s `GET /api/v1/conversations/{{conversationId}}/messages`.
3. Expect `404` with `CONVERSATION_NOT_FOUND`; C must not receive A or B’s history.

## 5. Upload, Logout, and Error Checks

| Check | Request | Expected result |
| --- | --- | --- |
| Avatar signature | `POST {{baseUrl}}/api/v1/uploads/avatar/signature` with valid session, CSRF header, JSON content type, and `{}` | `200` with signature data when staging Cloudinary is configured; otherwise `503` with `AVATAR_UPLOAD_UNAVAILABLE` |
| Logout without CSRF | `POST {{baseUrl}}/api/v1/auth/logout` with valid A session but no CSRF header | `403` with `CSRF_INVALID` |
| Logout with CSRF | Same request with A’s current `X-CSRF-Token` | `200`; `data.loggedOut` is `true`; response expires the session cookie |
| Session after logout | `GET {{baseUrl}}/api/v1/auth/me` after logout | `401` with `AUTH_REQUIRED` |
| Invalid JSON | Send malformed JSON to a JSON endpoint | `400` with `INVALID_JSON` |
| Unknown route | `GET {{baseUrl}}/api/v1/does-not-exist` | `404` with `NOT_FOUND` |

## 6. Pass Criteria and Limits

The HTTP smoke run passes when health reports MongoDB ready, both test accounts can authenticate, expected success responses match the common envelope, and unauthorized, invalid-CSRF, invalid-input, and nonmember requests return the expected status and code. Restore modified staging profile data and leave production untouched.

This plan covers HTTP endpoints. Message creation and realtime delivery use Socket.IO events rather than an HTTP route; the staged message used above is created in the staging app. Dedicated Socket.IO event checks are outside this plan.
