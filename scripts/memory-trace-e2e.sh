#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if ! command -v curl >/dev/null 2>&1; then
  echo "[memory:trace:e2e] curl is required but not found in PATH."
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "[memory:trace:e2e] bun is required but not found in PATH."
  exit 1
fi

AGENT_MOCKINGBIRD_BASE_URL="${AGENT_MOCKINGBIRD_BASE_URL:-http://127.0.0.1:${AGENT_MOCKINGBIRD_PORT:-3001}}"
MARKER="trace-e2e-$(date +%s)-$RANDOM"
MEMORY_TEXT="Durable trace marker ${MARKER} should be recalled for E2E verification."
SESSION_MODEL="${AGENT_MOCKINGBIRD_E2E_MODEL:-}"

echo "[memory:trace:e2e] base URL: ${AGENT_MOCKINGBIRD_BASE_URL}"
echo "[memory:trace:e2e] marker: ${MARKER}"

echo "[memory:trace:e2e] health check"
curl -fsS "${AGENT_MOCKINGBIRD_BASE_URL}/api/health" >/dev/null

echo "[memory:trace:e2e] writing durable memory seed"
curl -fsS "${AGENT_MOCKINGBIRD_BASE_URL}/api/memory/remember" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"fact\",\"source\":\"system\",\"content\":\"${MEMORY_TEXT}\"}" >/tmp/agent-mockingbird-memory-trace-remember.json

if [[ -z "${SESSION_MODEL}" ]]; then
  echo "[memory:trace:e2e] resolving model from existing sessions"
  if SESSIONS_JSON="$(curl -fsS "${AGENT_MOCKINGBIRD_BASE_URL}/api/sessions" 2>/dev/null)"; then
    SESSION_MODEL="$(
      printf '%s\n' "${SESSIONS_JSON}" \
        | bun -e '
          const payload = JSON.parse(await new Response(Bun.stdin.stream()).text());
          const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];
          const mainModel =
            sessions.find((session) => session?.id === "main" && typeof session?.model === "string")?.model ?? "";
          if (mainModel.trim()) {
            console.log(mainModel.trim());
            process.exit(0);
          }
          const firstModel =
            sessions.find((session) => typeof session?.model === "string" && session.model.trim())?.model ?? "";
          console.log(firstModel.trim());
        '
    )"
  fi
fi

if [[ -z "${SESSION_MODEL}" ]]; then
  echo "[memory:trace:e2e] resolving model from /api/opencode/models"
  if MODELS_JSON="$(curl -fsS "${AGENT_MOCKINGBIRD_BASE_URL}/api/opencode/models" 2>/dev/null)"; then
    SESSION_MODEL="$(
      printf '%s\n' "${MODELS_JSON}" \
        | bun -e '
          const payload = JSON.parse(await new Response(Bun.stdin.stream()).text());
          const models = Array.isArray(payload.models) ? payload.models : [];
          const firstId = models.find((model) => typeof model?.id === "string" && model.id.trim())?.id ?? "";
          console.log(firstId);
        '
    )"
  fi
fi

if [[ -z "${SESSION_MODEL}" ]]; then
  echo "[memory:trace:e2e] no model available. Configure OpenCode models or set AGENT_MOCKINGBIRD_E2E_MODEL."
  exit 1
fi

echo "[memory:trace:e2e] model: ${SESSION_MODEL}"
SESSION_CREATE_PAYLOAD="$(
  SESSION_MODEL="${SESSION_MODEL}" bun -e '
    const model = (process.env.SESSION_MODEL ?? "").trim();
    const payload = { title: "Memory Trace E2E", model };
    console.log(JSON.stringify(payload));
  '
)"

echo "[memory:trace:e2e] creating session"
SESSION_ID="$(
  curl -fsS "${AGENT_MOCKINGBIRD_BASE_URL}/api/sessions" \
    -H "Content-Type: application/json" \
    -d "${SESSION_CREATE_PAYLOAD}" \
    | bun -e 'const data=JSON.parse(await new Response(Bun.stdin.stream()).text()); console.log(data.session?.id ?? "");'
)"

if [[ -z "${SESSION_ID}" ]]; then
  echo "[memory:trace:e2e] failed to create session."
  exit 1
fi

echo "[memory:trace:e2e] session: ${SESSION_ID}"
echo "[memory:trace:e2e] sending chat prompt through runtime"
curl -fsS "${AGENT_MOCKINGBIRD_BASE_URL}/api/chat" \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"${SESSION_ID}\",\"content\":\"Please answer briefly. Use any relevant memory for this marker: ${MARKER}\"}" \
  >/tmp/agent-mockingbird-memory-trace-chat.json

echo "[memory:trace:e2e] loading session messages"
MESSAGES_JSON="$(curl -fsS "${AGENT_MOCKINGBIRD_BASE_URL}/api/sessions/${SESSION_ID}/messages")"
printf '%s\n' "${MESSAGES_JSON}" >/tmp/agent-mockingbird-memory-trace-messages.json

TRACE_SUMMARY="$(
  printf '%s\n' "${MESSAGES_JSON}" \
    | bun -e '
      const payload = JSON.parse(await new Response(Bun.stdin.stream()).text());
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const assistant = [...messages].reverse().find((message) => message.role === "assistant");
      if (!assistant) {
        console.log("NO_ASSISTANT");
        process.exit(0);
      }
      const trace = assistant.memoryTrace;
      if (!trace) {
        console.log("NO_TRACE");
        process.exit(0);
      }
      const injected = Number(trace.injectedContextResults ?? 0);
      const toolCalls = Array.isArray(trace.toolCalls) ? trace.toolCalls.length : 0;
      console.log(`TRACE injected=${injected} toolCalls=${toolCalls}`);
      if (injected < 1) process.exit(2);
    '
)"

if [[ "${TRACE_SUMMARY}" == "NO_ASSISTANT" ]]; then
  echo "[memory:trace:e2e] no assistant message found."
  exit 1
fi

if [[ "${TRACE_SUMMARY}" == "NO_TRACE" ]]; then
  echo "[memory:trace:e2e] no memoryTrace found on assistant message."
  exit 1
fi

echo "[memory:trace:e2e] ${TRACE_SUMMARY}"
echo "[memory:trace:e2e] PASS"
