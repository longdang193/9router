# CGW Chat Shim

This directory contains a loopback-only OpenAI-compatible adapter for the
installed CGW runtime. It translates one plain-text, single-turn Chat
Completions request into one direct CGW Responses request.

## Scope

- `GET /v1/models` exposes only aliases configured in
  `CGW_SHIM_MODEL_ALIASES_JSON`.
- `POST /v1/chat/completions` accepts exactly one non-empty `user` message.
- `reasoning_effort` accepts `low`, `medium`, or `high` and is sent to CGW as
  the per-request Responses `reasoning.effort` value.
- `stream: true` returns buffered compatibility SSE; it is not live token
  streaming.
- Client tool declarations are ignored because CGW Chat is text-only; tools are never
  executed. System messages, multi-turn context, images, audio, and response-format
  options are rejected before dispatch.
- The service binds only to loopback and requires a dedicated local bearer key.
- CGW inference is performed directly against its local `/v1/responses` bridge;
  it never launches `codex exec` and never routes CGW aliases through 9Router's
  Codex provider.
- A missing CGW bearer fails closed before dispatch. Upstream failures after
  dispatch include `x-9router-no-replay: 1` as an advisory diagnostic for the
  parent 9Router replay policy.
- Requests that disconnect while waiting in the bounded queue are removed before
  CGW dispatch, so abandoned retries do not consume CGW execution capacity.

The default queue admits one active CGW request and keeps up to eight additional
requests waiting. The tenth simultaneous request receives HTTP `429`. This is
the shim's CGW chat queue, not a native `codex exec` queue. Herdr's normal
`combo-web-*` single-flight admission should keep this queue nearly empty;
direct clients, bypassed Herdr launches, or duplicate retries can still fill it.
If native `codex exec` output appears, the request used a different or stale
adapter path and did not come through this direct CGW transport.

## Configuration

The shim automatically loads `.env` from the repository root when any shim
entrypoint starts. Existing process environment variables remain authoritative.
Keep the real `.env` uncommitted.

Start the long-running shim with:

```powershell
node tools/cgw-codex-shim/run.js
```

The equivalent variables are:

```dotenv
CGW_SHIM_HOST=127.0.0.1
CGW_SHIM_PORT=20129
CGW_SHIM_API_KEY=use-a-dedicated-local-key
CGW_SHIM_MODEL_ALIASES_JSON={"gpt-6.1-sol":"chatgpt-web/gpt-6-sol","gpt-5.6-sol":"chatgpt-web/gpt-5.6-sol"}
CGW_SHIM_CGW_BASE_URL=http://127.0.0.1:17841/v1
# Use one of these local-only bearer sources. Never commit the value.
CGW_SHIM_CGW_BEARER_FILE=C:\\Users\\me\\.codex\\cgw-bearer.env
# CGW_SHIM_CGW_BEARER=use-a-current-native-bearer
```

The bearer file may contain a raw token or one of these assignments:

```dotenv
CGW_SHIM_CGW_BEARER=...
OPENAI_ACCESS_TOKEN=...
ACCESS_TOKEN=...
```

The bearer must be accepted by the authenticated CGW Responses bridge. An
OpenAI API key beginning with `sk-` is not a substitute for this bearer. The
shim reads the bearer at request time and never logs or returns it.

The default limits are bounded and can be overridden with
`CGW_SHIM_MAX_BODY_BYTES`, `CGW_SHIM_MAX_CONCURRENT`, `CGW_SHIM_MAX_QUEUE`,
`CGW_SHIM_TIMEOUT_MS`, and `CGW_SHIM_TERMINATION_GRACE_MS`.
The default request-body budget is 1 MiB: it accommodates native sub-agent
context envelopes while retaining a finite protection against oversized
requests. Set `CGW_SHIM_MAX_BODY_BYTES` explicitly when a smaller deployment
budget is required.
The default CGW request budget is 600 seconds to accommodate slower
authenticated browser-backed turns. Set `CGW_SHIM_TIMEOUT_MS` explicitly when
the deployment has a tighter provider deadline. A timeout after dispatch is
reported as non-replayable; do not retry until the original attempt is
retired and its outcome is reconciled.

## Checks

```powershell
node --test tools/cgw-codex-shim/test/*.test.js
node tools/cgw-codex-shim/smoke.js --help
```

For a live inference smoke, configure a valid bearer and run:

```powershell
node tools/cgw-codex-shim/smoke.js --model gpt-6.1-sol --prompt "Reply with CGW_SHIM_CHAT_OK only."
```

The command prints only the selected alias and returned text. It does not print
the bearer key or request headers.
