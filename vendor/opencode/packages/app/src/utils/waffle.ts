import { base64Encode } from "@opencode-ai/util/encode"

export class WaffleApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "WaffleApiError"
    this.status = status
  }
}

async function parseJson<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    throw new WaffleApiError(`Expected JSON response from ${response.url}`, response.status)
  }

  return (await response.json()) as T
}

export async function waffleJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`.trim()
    try {
      const payload = await parseJson<{ error?: string }>(response)
      if (payload.error?.trim()) message = payload.error.trim()
    } catch {
      // Preserve the default HTTP status message when the error body is not JSON.
    }
    throw new WaffleApiError(message, response.status)
  }

  return parseJson<T>(response)
}

export function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

export function workspaceHref(directory: string, sessionID?: string) {
  const slug = base64Encode(directory)
  return sessionID ? `/${slug}/session/${sessionID}` : `/${slug}/session`
}

export interface PinnedWorkspacePayload {
  directory: string
  hash: string
}

export function readPinnedWorkspace() {
  return waffleJson<PinnedWorkspacePayload>("/api/waffle/runtime/pinned-workspace")
}
