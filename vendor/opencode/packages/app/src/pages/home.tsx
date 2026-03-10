import { useNavigate } from "@solidjs/router"
import { createSignal, onMount, Show } from "solid-js"
import { readPinnedWorkspace, workspaceHref } from "@/utils/waffle"

export default function Home() {
  const navigate = useNavigate()
  const [error, setError] = createSignal("")

  onMount(() => {
    void (async () => {
      try {
        const workspace = await readPinnedWorkspace()
        navigate(workspaceHref(workspace.directory), { replace: true })
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to resolve pinned workspace")
      }
    })()
  })

  return (
    <div class="mx-auto mt-55 w-full max-w-xl px-4">
      <div class="rounded-xl border border-border-weak-base bg-surface-raised-base px-5 py-5">
        <div class="text-16-medium text-text-strong">Agent Mockingbird</div>
        <div class="mt-2 text-14-regular text-text-weak">Opening the pinned workspace…</div>
        <Show when={error()}>
          <div class="mt-4 rounded-lg border border-icon-critical-base/20 bg-icon-critical-base/8 px-3 py-2 text-13-regular text-text-strong">
            {error()}
          </div>
        </Show>
      </div>
    </div>
  )
}
