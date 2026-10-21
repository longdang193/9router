# CGW / 9Router Compatibility Matrix

Recorded on 2026-10-21 (Europe/Berlin) during the direct CGW transport gate.

| Component | Observed value | Result |
| --- | --- | --- |
| Development checkout | current working tree | Direct CGW transport under test |
| Installed 9Router | `9router-app` `0.5.104` | Running on `http://127.0.0.1:20128` |
| CGW runtime | `codex-chatgpt-web` `6.1.12-win32-x64` | Responses bridge on `http://127.0.0.1:17841` |
| Shim | `tools/cgw-codex-shim/run.js` | Chat Completions compatibility on `http://127.0.0.1:20129` |
| CGW transport | Direct `POST /v1/responses` | Does not invoke `codex exec` or 9Router Codex provider |
| Model selection | `gpt-5.6-sol`, `gpt-6.1-sol` | Alias target is sent unchanged to CGW |
| Thinking override | `reasoning_effort=low|medium|high` | Sent as Responses `reasoning.effort` |
| Test validation | `POST /api/v1/chat/completions` with `hi` | Requires a real completion and matching returned model |

## Root cause corrected

The previous shim translated Chat Completions into `codex exec`, configured that
child to call 9Router on port `20128`, and qualified targets as
`codex/gpt-*`. That path selected a Codex OAuth connection and consumed Codex
quota even though the public model prefix was `cgw`.

The shim now translates directly to CGW's authenticated Responses bridge on
port `17841`. It fails closed when no CGW bearer is configured, so it cannot
silently fall back to native Codex execution.

## Authentication

CGW requires a valid native bearer in the incoming request. The shim accepts
that bearer only from the local `CGW_SHIM_CGW_BEARER` environment variable or
`CGW_SHIM_CGW_BEARER_FILE`. A regular `sk-*` API key is rejected by CGW and is
not treated as a fallback.
