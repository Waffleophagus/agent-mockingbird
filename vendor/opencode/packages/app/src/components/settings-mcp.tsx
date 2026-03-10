import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { For, onMount, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { prettyJson, waffleJson } from "@/utils/waffle"
import { WaffleCard, WaffleNotice, WaffleSettingsPage, WaffleSettingsSection, WaffleTextArea, WaffleToolbar } from "./settings-waffle-shared"

type McpServer =
  | {
      id: string
      type: "remote"
      enabled: boolean
      url: string
      headers?: Record<string, string>
      oauth?: "auto" | "off"
      timeoutMs?: number
    }
  | {
      id: string
      type: "local"
      enabled: boolean
      command: string[]
      environment?: Record<string, string>
      timeoutMs?: number
    }

type McpStatusMap = Record<
  string,
  {
    status?: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration" | "unknown"
    error?: string
  }
>

type McpPayload = {
  servers: McpServer[]
  status: McpStatusMap
}

export const SettingsMcp: Component = () => {
  const [state, setState] = createStore({
    loading: true,
    saving: false,
    busyId: "",
    error: "",
    payload: null as McpPayload | null,
    text: "[]",
  })

  async function load() {
    setState("loading", true)
    setState("error", "")
    try {
      const payload = await waffleJson<McpPayload>("/api/waffle/mcp")
      setState("payload", payload)
      setState("text", prettyJson(payload.servers))
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to load MCP config")
    } finally {
      setState("loading", false)
    }
  }

  async function save() {
    let parsed: McpServer[]
    try {
      parsed = JSON.parse(state.text) as McpServer[]
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Invalid MCP JSON")
      return
    }

    if (!Array.isArray(parsed)) {
      setState("error", "MCP payload must be a JSON array.")
      return
    }

    setState("saving", true)
    setState("error", "")
    try {
      const payload = await waffleJson<McpPayload>("/api/waffle/mcp", {
        method: "PUT",
        body: JSON.stringify({ servers: parsed }),
      })
      setState("payload", payload)
      setState("text", prettyJson(payload.servers))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "MCP config saved",
      })
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to save MCP config")
    } finally {
      setState("saving", false)
    }
  }

  async function runAction(id: string, action: "connect" | "disconnect" | "auth/start" | "auth/remove") {
    setState("busyId", id)
    try {
      const payload = await waffleJson<{ status: McpStatusMap; authorizationUrl?: string }>(
        `/api/waffle/mcp/${encodeURIComponent(id)}/${action}`,
        {
          method: "POST",
        },
      )
      if (payload.authorizationUrl) {
        window.open(payload.authorizationUrl, "_blank", "noopener,noreferrer")
      }
      setState("payload", (current) => (current ? { ...current, status: payload.status } : current))
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to update MCP server")
    } finally {
      setState("busyId", "")
    }
  }

  onMount(() => {
    void load()
  })

  const statusFor = (id: string) => state.payload?.status?.[id]?.status ?? "unknown"

  return (
    <WaffleSettingsPage
      title="MCP"
      description="Edit MCP server definitions and drive connection or auth flows through Agent Mockingbird's same-origin APIs."
      actions={
        <WaffleToolbar>
          <Button variant="ghost" size="large" onClick={() => void load()} disabled={state.loading || state.saving}>
            Refresh
          </Button>
          <Button size="large" onClick={() => void save()} disabled={state.loading || state.saving}>
            Save
          </Button>
        </WaffleToolbar>
      }
    >
      <Show when={state.error}>
        <WaffleNotice tone="error">{state.error}</WaffleNotice>
      </Show>

      <WaffleSettingsSection title="Configured servers" description="Connection status and auth actions for configured MCP servers.">
        <Show
          when={(state.payload?.servers.length ?? 0) > 0}
          fallback={<div class="px-4 py-4 text-14-regular text-text-weak">No MCP servers configured.</div>}
        >
          <For each={state.payload?.servers ?? []}>
            {(server) => (
              <div class="px-4 py-3 border-b border-border-weak-base last:border-none flex flex-wrap items-center justify-between gap-4">
                <div class="flex flex-col gap-1 min-w-0">
                  <div class="text-14-medium text-text-strong">{server.id}</div>
                  <div class="text-12-regular text-text-weak">
                    {server.type === "remote" ? server.url : server.command.join(" ")}
                  </div>
                  <div class="text-12-regular text-text-weak">Status: {statusFor(server.id)}</div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <Button
                    variant="ghost"
                    size="large"
                    disabled={state.busyId === server.id}
                    onClick={() => void runAction(server.id, statusFor(server.id) === "connected" ? "disconnect" : "connect")}
                  >
                    {statusFor(server.id) === "connected" ? "Disconnect" : "Connect"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="large"
                    disabled={state.busyId === server.id}
                    onClick={() => void runAction(server.id, "auth/start")}
                  >
                    Start auth
                  </Button>
                  <Button
                    variant="ghost"
                    size="large"
                    disabled={state.busyId === server.id}
                    onClick={() => void runAction(server.id, "auth/remove")}
                  >
                    Remove auth
                  </Button>
                </div>
              </div>
            )}
          </For>
        </Show>
      </WaffleSettingsSection>

      <WaffleSettingsSection title="Server editor" description="Edit the full MCP server array as JSON.">
        <WaffleCard>
          <WaffleTextArea
            rows={22}
            value={state.text}
            onInput={(event) => setState("text", event.currentTarget.value)}
            spellcheck={false}
          />
        </WaffleCard>
      </WaffleSettingsSection>
    </WaffleSettingsPage>
  )
}
