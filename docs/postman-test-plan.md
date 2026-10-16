# Postman API Smoke and Workflow Test Plan

Run this plan against a **staging** deployment and database only. Authentication uses short-lived bearer access tokens; there are no session cookies or CSRF tokens. Keep bearer tokens and OAuth secrets local and do not export or share them.

## Setup

Create a local Postman environment with `baseUrl` (staging backend origin, no trailing slash), `frontendUrl`, `accessToken`, `userAId`, `userBId`, optional `userCId`, `conversationId`, `messageId`, and `cursor`. Leave tokens out of shared environments and exported collections.

Use Postman's local browser flow to sign in with a staging Google test account, or copy the access token from the OAuth completion response in the browser's local network tools. The frontend keeps the access token in memory; it expires after 15 minutes and a page reload requires a new sign-in. Set `Authorization: Bearer {{accessToken}}` on protected requests. Repeat sign-in for account B (and optionally C) when switching accounts.

## Common assertions

Successful JSON responses use `{ statusCode, message, data }`. For errors, assert HTTP status and `data.code`.

```javascript
pm.test("has the API response envelope", () => {
  const body = pm.response.json();
  pm.expect(body.statusCode).to.equal(pm.response.code);
  pm.expect(body.message).to.be.a("string");
  pm.expect(body).to.have.property("data");
});
```

## Health and authentication

| Step | Request | Expected |
| --- | --- | --- |
| 1 | `GET {{baseUrl}}/api/v1/health` | `200`, `data.ready: true`, MongoDB `connected` |
| 2 | Clear `Authorization`; `GET {{baseUrl}}/api/v1/auth/me` | `401`, `AUTH_REQUIRED` |
| 3 | Sign into staging as A with Google; obtain the in-memory bearer token | Browser returns to the configured frontend route; no auth cookie is set |
| 4 | `GET {{baseUrl}}/api/v1/auth/me` with `Authorization: Bearer {{accessToken}}` | `200`, expected account; save its ID as `userAId` |

The Google redirect URI is `https://<staging-backend>/api/v1/auth/google/callback`. OAuth uses a short-lived signed state and returns the access token in the URL fragment; the frontend validates state and immediately removes the fragment from browser history.

## Users and profile

As A, use `GET /api/v1/users?limit=20`, `GET /api/v1/users/search?q=<name>&limit=20`, and `GET /api/v1/users/{{userBId}}`; expect eligible user lists and B's public profile. Malformed IDs or invalid query values should return `400`; an unknown valid user ID should return `404`.

Save A's original display name. `PATCH /api/v1/users/me/profile` with bearer authorization and JSON `{"displayName":"Postman Staging A"}` should return `200`. Restore the original value afterward. Invalid profile payloads should return `400 VALIDATION_FAILED`.

## Conversations and history

1. As A, `POST /api/v1/conversations/direct/{{userBId}}` with bearer authorization and `{}`. Expect `200`; save `data.conversationId`. Repeat and confirm the same conversation ID.
2. `GET /api/v1/conversations?limit=20` and `GET /api/v1/conversations/{{conversationId}}/messages?limit=30` should return the conversation and visible history.
3. Send a staging message through the app as A/B. As the recipient, use its ID for `POST /api/v1/conversations/{{conversationId}}/read` with `{"messageId":"{{messageId}}"}`.
4. `POST /api/v1/conversations/{{conversationId}}/clear` with `{}`; confirm visible history is cleared for that account.
5. Sign in as optional account C and fetch A/B's message history. Expect `404 CONVERSATION_NOT_FOUND`.

## Uploads, logout, and errors

| Check | Request | Expected |
| --- | --- | --- |
| Avatar signature | `POST /api/v1/uploads/avatar/signature`, bearer auth, `{}` | `200` when Cloudinary is configured; otherwise `503 AVATAR_UPLOAD_UNAVAILABLE` |
| Logout | `POST /api/v1/auth/logout`, bearer auth | `200`, `data.loggedOut: true`; token is invalidated and active sockets disconnect |
| After logout | `GET /api/v1/auth/me` with the old bearer token | `401 AUTH_REQUIRED` |
| Invalid JSON | Malformed JSON to a JSON endpoint | `400 INVALID_JSON` |
| Unknown route | `GET /api/v1/does-not-exist` | `404 NOT_FOUND` |

The run passes when health is ready, both staging accounts authenticate, successful responses use the common envelope, and unauthenticated/invalid-input/nonmember requests are rejected as expected. Restore modified staging profile data. Never run write checks against production. Socket message creation and realtime delivery can be checked separately through Socket.IO.
