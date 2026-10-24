import { beforeEach, describe, expect, it, vi } from "vitest";

const RELAY_URL = "http://127.0.0.1:20128/v1/chatgpt-web/responses";

function request(method = "POST") {
  return new Request(RELAY_URL, {
    method,
    headers: method === "POST" ? { "content-type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify({ model: "chatgpt-web/medium" }) : undefined,
  });
}

describe("retired ChatGPT Web Responses route", () => {
  let route;

  beforeEach(async () => {
    vi.restoreAllMocks();
    route = await import("../../src/app/api/v1/chatgpt-web/responses/route.js");
  });

  it.each(["GET", "POST", "OPTIONS"])("returns 410 for %s without forwarding", async (method) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await route[method](request(method));
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.error.code).toBe("RETIRED_MODEL");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
