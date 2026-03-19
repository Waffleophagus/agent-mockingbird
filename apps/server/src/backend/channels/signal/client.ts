interface SignalRpcOptions {
  baseUrl: string;
  timeoutMs?: number;
}

interface SignalSseEvent {
  event?: string;
  data?: string;
  id?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function normalizeBaseUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Signal base URL is required");
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/+$/, "");
  }
  return `http://${trimmed}`.replace(/\/+$/, "");
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function signalRpcRequest<T = unknown>(
  method: string,
  params: Record<string, unknown> | undefined,
  options: SignalRpcOptions,
): Promise<T> {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const body = JSON.stringify({
    jsonrpc: "2.0",
    method,
    params,
    id: crypto.randomUUID(),
  });
  const response = await fetchWithTimeout(
    `${baseUrl}/api/v1/rpc`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (response.status === 201) {
    return undefined as T;
  }
  const payload = (await response.json()) as {
    result?: T;
    error?: { code?: number; message?: string };
  };
  if (payload.error) {
    throw new Error(`Signal RPC ${payload.error.code ?? "unknown"}: ${payload.error.message ?? "request failed"}`);
  }
  return payload.result as T;
}

export async function signalCheck(baseUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS) {
  try {
    const response = await fetchWithTimeout(
      `${normalizeBaseUrl(baseUrl)}/api/v1/check`,
      { method: "GET" },
      timeoutMs,
    );
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `HTTP ${response.status}`,
      };
    }
    return {
      ok: true,
      status: response.status,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function streamSignalEvents(input: {
  baseUrl: string;
  account?: string | null;
  signal?: AbortSignal;
  onEvent: (event: SignalSseEvent) => void;
}) {
  const url = new URL(`${normalizeBaseUrl(input.baseUrl)}/api/v1/events`);
  if (input.account?.trim()) {
    url.searchParams.set("account", input.account.trim());
  }
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "text/event-stream",
    },
    signal: input.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Signal SSE failed (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let current: SignalSseEvent = {};

  const flush = () => {
    if (!current.data && !current.event && !current.id) return;
    input.onEvent(current);
    current = {};
  };

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let lineEnd = buffer.indexOf("\n");
    while (lineEnd !== -1) {
      let line = buffer.slice(0, lineEnd);
      buffer = buffer.slice(lineEnd + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);

      if (line === "") {
        flush();
        lineEnd = buffer.indexOf("\n");
        continue;
      }
      if (line.startsWith(":")) {
        lineEnd = buffer.indexOf("\n");
        continue;
      }

      const [rawField, ...rest] = line.split(":");
      const field = (rawField ?? "").trim();
      const rawValue = rest.join(":");
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
      if (field === "event") {
        current.event = value;
      } else if (field === "data") {
        current.data = current.data ? `${current.data}\n${value}` : value;
      } else if (field === "id") {
        current.id = value;
      }
      lineEnd = buffer.indexOf("\n");
    }
  }
  flush();
}
