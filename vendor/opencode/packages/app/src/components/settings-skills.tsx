import { Button } from "@opencode-ai/ui/button"
import { Switch } from "@opencode-ai/ui/switch"
import { showToast } from "@opencode-ai/ui/toast"
import { createSignal, For, onMount, Show, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { WaffleCard, WaffleInput, WaffleMetaRow, WaffleNotice, WaffleSettingsPage, WaffleSettingsSection, WaffleTextArea, WaffleToolbar } from "./settings-waffle-shared"
import { waffleJson } from "@/utils/waffle"

type SkillEntry = {
  id: string
  name: string
  description: string
  location: string
  enabled: boolean
  managed: boolean
}

type SkillsPayload = {
  skills: SkillEntry[]
  enabled: string[]
  disabled: string[]
  invalid: Array<{
    id?: string
    location: string
    reason: string
  }>
  hash: string
  revision: string
  managedPath: string
  disabledPath: string
}

export const SettingsSkills: Component = () => {
  const [state, setState] = createStore({
    loading: true,
    busyId: "",
    error: "",
    catalog: null as SkillsPayload | null,
    importId: "",
    importEnabled: true,
    importContent:
      "---\nname: example-skill\ndescription: Example managed skill\n---\n\nAdd instructions here.\n",
  })
  const [refreshTick, setRefreshTick] = createSignal(0)

  async function load() {
    refreshTick()
    setState("loading", true)
    setState("error", "")
    try {
      const catalog = await waffleJson<SkillsPayload>("/api/waffle/skills")
      setState("catalog", catalog)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load skills"
      setState("error", message)
    } finally {
      setState("loading", false)
    }
  }

  async function refresh() {
    setRefreshTick((value) => value + 1)
    await load()
  }

  async function toggleSkill(id: string, enabled: boolean) {
    setState("busyId", id)
    try {
      const next = await waffleJson<SkillsPayload>(`/api/waffle/skills/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      })
      setState("catalog", next)
    } catch (error) {
      showToast({
        title: "Failed to update skill",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setState("busyId", "")
    }
  }

  async function removeSkill(id: string) {
    setState("busyId", id)
    try {
      const next = await waffleJson<SkillsPayload>(`/api/waffle/skills/${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
      setState("catalog", next)
    } catch (error) {
      showToast({
        title: "Failed to remove skill",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setState("busyId", "")
    }
  }

  async function importSkill() {
    if (!state.importId.trim() || !state.importContent.trim()) {
      setState("error", "Skill id and SKILL.md content are required.")
      return
    }

    setState("error", "")
    setState("busyId", "import")
    try {
      await waffleJson("/api/waffle/skills/import", {
        method: "POST",
        body: JSON.stringify({
          id: state.importId,
          content: state.importContent,
          enable: state.importEnabled,
          expectedHash: state.catalog?.hash,
        }),
      })
      showToast({
        variant: "success",
        icon: "circle-check",
        title: "Skill imported",
      })
      setState("importId", "")
      await refresh()
    } catch (error) {
      setState("error", error instanceof Error ? error.message : "Failed to import skill")
    } finally {
      setState("busyId", "")
    }
  }

  onMount(() => {
    void load()
  })

  return (
    <WaffleSettingsPage
      title="Skills"
      description="Manage the workspace skill catalog and import managed skills for the pinned workspace."
      actions={
        <WaffleToolbar>
          <Button variant="ghost" size="large" onClick={() => void refresh()} disabled={state.loading}>
            Refresh
          </Button>
        </WaffleToolbar>
      }
    >
      <Show when={state.error}>
        <WaffleNotice tone="error">{state.error}</WaffleNotice>
      </Show>

      <Show when={state.catalog}>
        {(catalog) => (
          <>
            <WaffleSettingsSection title="Catalog paths">
              <WaffleMetaRow label="Managed skills path" value={catalog().managedPath} />
              <WaffleMetaRow label="Disabled skills path" value={catalog().disabledPath} />
            </WaffleSettingsSection>

            <WaffleSettingsSection title="Installed skills" description="Enable, disable, or remove managed skills.">
              <Show
                when={catalog().skills.length > 0}
                fallback={<div class="px-4 py-4 text-14-regular text-text-weak">No managed skills found.</div>}
              >
                <For each={catalog().skills}>
                  {(skill) => (
                    <div class="flex flex-wrap items-center justify-between gap-4 px-4 py-3 border-b border-border-weak-base last:border-none">
                      <div class="min-w-0 flex flex-col gap-1">
                        <div class="text-14-medium text-text-strong">{skill.name}</div>
                        <div class="text-12-regular text-text-weak">{skill.description}</div>
                        <div class="text-11-regular text-text-weak break-all">{skill.location}</div>
                      </div>
                      <div class="flex items-center gap-2">
                        <Switch
                          checked={skill.enabled}
                          disabled={state.busyId === skill.id}
                          onChange={(enabled) => void toggleSkill(skill.id, enabled)}
                          hideLabel
                        >
                          {skill.name}
                        </Switch>
                        <Button
                          variant="ghost"
                          size="large"
                          disabled={state.busyId === skill.id}
                          onClick={() => void removeSkill(skill.id)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </WaffleSettingsSection>

            <Show when={catalog().invalid.length > 0}>
              <WaffleSettingsSection title="Invalid skills">
                <For each={catalog().invalid}>
                  {(issue) => (
                    <div class="px-4 py-3 border-b border-border-weak-base last:border-none">
                      <div class="text-13-medium text-text-strong">{issue.id ?? "unknown-skill"}</div>
                      <div class="text-12-regular text-text-weak">{issue.reason}</div>
                      <div class="text-11-regular text-text-weak break-all">{issue.location}</div>
                    </div>
                  )}
                </For>
              </WaffleSettingsSection>
            </Show>
          </>
        )}
      </Show>

      <WaffleSettingsSection
        title="Import skill"
        description="Paste a managed SKILL.md and import it into the pinned workspace."
      >
        <WaffleCard
          footer={
            <div class="flex flex-wrap items-center justify-between gap-3">
              <label class="flex items-center gap-2 text-13-regular text-text-strong">
                <input
                  type="checkbox"
                  checked={state.importEnabled}
                  onChange={(event) => setState("importEnabled", event.currentTarget.checked)}
                />
                Enable after import
              </label>
              <Button size="large" onClick={() => void importSkill()} disabled={state.busyId === "import"}>
                Import skill
              </Button>
            </div>
          }
        >
          <div class="flex flex-col gap-2">
            <span class="text-12-medium text-text-weak">Skill id</span>
            <WaffleInput
              value={state.importId}
              placeholder="example-skill"
              onInput={(event) => setState("importId", event.currentTarget.value)}
            />
          </div>
          <div class="flex flex-col gap-2">
            <span class="text-12-medium text-text-weak">SKILL.md content</span>
            <WaffleTextArea
              rows={14}
              value={state.importContent}
              onInput={(event) => setState("importContent", event.currentTarget.value)}
            />
          </div>
        </WaffleCard>
      </WaffleSettingsSection>
    </WaffleSettingsPage>
  )
}
