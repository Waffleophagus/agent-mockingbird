import { type JSX, type ParentProps, Show } from "solid-js"

export function WaffleSettingsPage(
  props: ParentProps<{
    title: string
    description?: string
    actions?: JSX.Element
  }>,
) {
  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-wrap items-start justify-between gap-4 pt-6 pb-6 max-w-[760px]">
          <div class="flex flex-col gap-1 min-w-0">
            <h2 class="text-16-medium text-text-strong">{props.title}</h2>
            <Show when={props.description}>
              <p class="text-14-regular text-text-weak max-w-[640px]">{props.description}</p>
            </Show>
          </div>
          <Show when={props.actions}>
            <div class="flex items-center gap-2">{props.actions}</div>
          </Show>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[760px]">{props.children}</div>
    </div>
  )
}

export function WaffleSettingsSection(
  props: ParentProps<{
    title: string
    description?: string
    actions?: JSX.Element
  }>,
) {
  return (
    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="flex flex-col gap-1">
          <h3 class="text-14-medium text-text-strong">{props.title}</h3>
          <Show when={props.description}>
            <p class="text-12-regular text-text-weak">{props.description}</p>
          </Show>
        </div>
        <Show when={props.actions}>
          <div class="flex items-center gap-2">{props.actions}</div>
        </Show>
      </div>
      <div class="bg-surface-raised-base rounded-lg border border-border-weak-base">{props.children}</div>
    </section>
  )
}

export function WaffleMetaRow(props: { label: string; value: string | JSX.Element }) {
  return (
    <div class="flex flex-col gap-1 px-4 py-3 border-b border-border-weak-base last:border-none">
      <span class="text-12-medium text-text-weak">{props.label}</span>
      <div class="text-13-regular text-text-strong break-all">{props.value}</div>
    </div>
  )
}

export function WaffleToolbar(props: ParentProps) {
  return <div class="flex flex-wrap items-center gap-2">{props.children}</div>
}

export function WaffleNotice(props: { tone?: "error" | "success" | "info"; children: JSX.Element }) {
  const tone = () => props.tone ?? "info"
  return (
    <div
      classList={{
        "rounded-lg px-3 py-2 text-13-regular border": true,
        "bg-surface-base text-text-base border-border-weak-base": tone() === "info",
        "bg-background-base text-text-strong border-border-strong-base": tone() === "success",
        "bg-icon-critical-base/8 text-text-strong border-icon-critical-base/20": tone() === "error",
      }}
    >
      {props.children}
    </div>
  )
}

export function WaffleInput(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      class={`w-full rounded-lg border border-border-weak-base bg-surface-base px-3 py-2 text-13-regular text-text-strong outline-none placeholder:text-text-weak focus:border-border-strong-base ${
        props.class ?? ""
      }`}
    />
  )
}

export function WaffleTextArea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      class={`w-full rounded-lg border border-border-weak-base bg-surface-base px-3 py-2 text-12-mono text-text-strong outline-none placeholder:text-text-weak focus:border-border-strong-base ${
        props.class ?? ""
      }`}
    />
  )
}

export function WaffleCard(props: ParentProps<{ footer?: JSX.Element }>) {
  return (
    <div class="rounded-lg border border-border-weak-base bg-background-base overflow-hidden">
      <div class="p-4 flex flex-col gap-4">{props.children}</div>
      <Show when={props.footer}>
        <div class="px-4 py-3 border-t border-border-weak-base bg-surface-base">{props.footer}</div>
      </Show>
    </div>
  )
}
