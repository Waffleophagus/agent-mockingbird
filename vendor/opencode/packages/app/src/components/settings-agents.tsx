import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { onMount, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { prettyJson, waffleJson } from "@/utils/waffle"
import { WaffleCard, WaffleMetaRow, WaffleNotice, WaffleSettingsPage, WaffleSettingsSection, WaffleTextArea, WaffleToolbar } from "./settings-waffle-shared"

type AgentType = {
  id: string
  name?: string
  description?: string
  prompt?: string
  model?: string
  variant?: string
  mode?: string
  hidden?: boolean
  disable?: boolean
  temperature?: number
  topP?: number
  steps?: number
  permission?: Record<string, unknown>
  options?: Record<string, unknown>
}

type AgentsPayload = {
  agentTypes: AgentType[]
  hash: string
  storage?: {
    directory: string
    configFilePath: string
    persistenceMode: string
  }
}

export const SettingsAgents: Component = () => {
  const [state, setState] = createStore({
    loading: true,
    saving: false,
    error: "",
    payload: null as AgentsPayload | null,
    text: "[]",
  })

  async function load() {
    setState("loading", true)
    setState("error", "")
    try {
      const payload = await waffleJson<AgentsPayload>("/api/waffle/agents")
      setState("payload", payload)
      setState("text", prettyJson(payload.agentTypes))
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to load agent definitions")
    } finally {
      setState("loading", false)
    }
  }

  async function save() {
    let parsed: AgentType[]
    try {
      parsed = JSON.parse(state.text) as AgentType[]
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Invalid agent JSON")
      return
    }

    if (!Array.isArray(parsed)) {
      setState("error", "Agent payload must be a JSON array.")
      return
    }

    const previous = state.payload?.agentTypes ?? []
    const previousIDs = new Set(previous.map((item) => item.id))
    const nextIDs = new Set(parsed.map((item) => item.id))
    const deletes = [...previousIDs].filter((id) => !nextIDs.has(id))

    setState("saving", true)
    setState("error", "")
    try {
      const payload = await waffleJson<AgentsPayload>("/api/waffle/agents", {
        method: "PATCH",
        body: JSON.stringify({
          upserts: parsed,
          deletes,
          expectedHash: state.payload?.hash,
        }),
      })
      setState("payload", payload)
      setState("text", prettyJson(payload.agentTypes))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Agent definitions saved",
      })
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to save agent definitions")
    } finally {
      setState("saving", false)
    }
  }

  onMount(() => {
    void load()
  })

  return (
    <WaffleSettingsPage
      title="Agents"
      description="Manage OpenCode agent definitions stored in the pinned workspace's .opencode/opencode.jsonc."
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

      <Show when={state.payload?.storage}>
        {(storage) => (
          <WaffleSettingsSection title="Storage">
            <WaffleMetaRow label="Workspace directory" value={storage().directory} />
            <WaffleMetaRow label="Config file" value={storage().configFilePath} />
            <WaffleMetaRow label="Persistence mode" value={storage().persistenceMode} />
          </WaffleSettingsSection>
        )}
      </Show>

      <WaffleSettingsSection title="Agent editor" description="Edit the current agent type array as JSON.">
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
