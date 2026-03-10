import { Button } from "@opencode-ai/ui/button"
import { showToast } from "@opencode-ai/ui/toast"
import { onMount, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { prettyJson, waffleJson } from "@/utils/waffle"
import { WaffleCard, WaffleMetaRow, WaffleNotice, WaffleSettingsPage, WaffleSettingsSection, WaffleTextArea, WaffleToolbar } from "./settings-waffle-shared"

type RuntimePayload = {
  hash: string
  path: string
  config: {
    workspace: {
      pinnedDirectory: string
    }
    runtime: Record<string, unknown>
  }
}

export const SettingsRuntime: Component = () => {
  const [state, setState] = createStore({
    loading: true,
    saving: false,
    error: "",
    payload: null as RuntimePayload | null,
    text: "{\n  \"workspace\": {\n    \"pinnedDirectory\": \"\"\n  },\n  \"runtime\": {}\n}",
  })

  async function load() {
    setState("loading", true)
    setState("error", "")
    try {
      const payload = await waffleJson<RuntimePayload>("/api/waffle/runtime/config")
      setState("payload", payload)
      setState("text", prettyJson(payload.config))
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to load runtime config")
    } finally {
      setState("loading", false)
    }
  }

  async function save() {
    let parsed: unknown
    try {
      parsed = JSON.parse(state.text)
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Invalid JSON")
      return
    }

    setState("saving", true)
    setState("error", "")
    try {
      const payload = await waffleJson<RuntimePayload>("/api/waffle/runtime/config/replace", {
        method: "POST",
        body: JSON.stringify({
          config: parsed,
          expectedHash: state.payload?.hash,
        }),
      })
      setState("payload", payload)
      setState("text", prettyJson(payload.config))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Runtime config saved",
      })
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to save runtime config")
    } finally {
      setState("saving", false)
    }
  }

  onMount(() => {
    void load()
  })

  return (
    <WaffleSettingsPage
      title="Runtime"
      description="Edit Agent Mockingbird runtime settings owned outside OpenCode's workspace config."
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

      <Show when={state.payload}>
        {(payload) => (
          <WaffleSettingsSection title="Config metadata">
            <WaffleMetaRow label="Config file" value={payload().path} />
            <WaffleMetaRow label="Pinned workspace" value={payload().config.workspace.pinnedDirectory} />
            <WaffleMetaRow label="Revision hash" value={payload().hash} />
          </WaffleSettingsSection>
        )}
      </Show>

      <WaffleSettingsSection title="Config editor" description="Replace the current Agent Mockingbird config payload with JSON.">
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
