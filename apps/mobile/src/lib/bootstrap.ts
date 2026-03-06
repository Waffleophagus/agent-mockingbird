import * as SecureStore from "expo-secure-store";
import { onSnapshot, types } from "mobx-state-tree";
import { useEffect, useState } from "react";

const BACKEND_URL_STORAGE_KEY = "agent-mockingbird.backend-url";
const DEFAULT_API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
const HEALTH_PATH = "/api/health";
const REQUEST_TIMEOUT_MS = 4000;

function normalizeApiBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

const BootstrapStore = types
  .model("BootstrapStore", {
    apiBaseUrl: types.string,
    notificationsEnabled: types.boolean,
    hydrated: types.boolean,
    hydrating: types.boolean,
    saving: types.boolean,
    saveError: types.maybeNull(types.string),
    connectionStatus: types.enumeration("ConnectionStatus", ["idle", "checking", "online", "offline"]),
    connectionMessage: types.maybeNull(types.string),
  })
  .actions(self => ({
    setApiBaseUrl(value: string) {
      self.apiBaseUrl = value;
    },
    setNotificationsEnabled(value: boolean) {
      self.notificationsEnabled = value;
    },
    setHydrating(value: boolean) {
      self.hydrating = value;
    },
    setHydrated(value: boolean) {
      self.hydrated = value;
    },
    setSaving(value: boolean) {
      self.saving = value;
    },
    setSaveError(value: string | null) {
      self.saveError = value;
    },
    setConnectionStatus(value: "idle" | "checking" | "online" | "offline") {
      self.connectionStatus = value;
    },
    setConnectionMessage(value: string | null) {
      self.connectionMessage = value;
    },
  }));

const bootstrapStore = BootstrapStore.create({
  apiBaseUrl: normalizeApiBaseUrl(DEFAULT_API_BASE_URL),
  notificationsEnabled: true,
  hydrated: false,
  hydrating: false,
  saving: false,
  saveError: null,
  connectionStatus: "idle",
  connectionMessage: null,
});

let hydratePromise: Promise<void> | null = null;
let healthCheckPromise: Promise<void> | null = null;

export function useBootstrapStore() {
  const [, setVersion] = useState(0);

  useEffect(() => {
    const dispose = onSnapshot(bootstrapStore, () => {
      setVersion(version => version + 1);
    });
    return () => dispose();
  }, []);

  return bootstrapStore;
}

export async function hydrateBootstrapStore() {
  if (hydratePromise) {
    return hydratePromise;
  }

  hydratePromise = (async () => {
    bootstrapStore.setHydrating(true);
    bootstrapStore.setSaveError(null);

    try {
      const storedValue = await SecureStore.getItemAsync(BACKEND_URL_STORAGE_KEY);
      const nextUrl = normalizeApiBaseUrl(storedValue ?? DEFAULT_API_BASE_URL);

      bootstrapStore.setApiBaseUrl(nextUrl);
      bootstrapStore.setHydrated(true);
    } catch (error) {
      bootstrapStore.setSaveError(error instanceof Error ? error.message : "Failed to read backend URL.");
      bootstrapStore.setApiBaseUrl(normalizeApiBaseUrl(DEFAULT_API_BASE_URL));
      bootstrapStore.setHydrated(true);
    } finally {
      bootstrapStore.setHydrating(false);
      await refreshServerHealth();
      hydratePromise = null;
    }
  })();

  return hydratePromise;
}

export async function saveBootstrapApiBaseUrl(value: string) {
  const normalizedValue = normalizeApiBaseUrl(value);

  bootstrapStore.setSaving(true);
  bootstrapStore.setSaveError(null);

  try {
    if (!normalizedValue) {
      throw new Error("Enter a backend URL before saving.");
    }

    const parsedUrl = new URL(normalizedValue);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error("Backend URL must start with http:// or https://");
    }

    await SecureStore.setItemAsync(BACKEND_URL_STORAGE_KEY, normalizedValue);
    bootstrapStore.setApiBaseUrl(normalizedValue);
    bootstrapStore.setHydrated(true);
  } catch (error) {
    bootstrapStore.setSaveError(error instanceof Error ? error.message : "Failed to save backend URL.");
    throw error;
  } finally {
    bootstrapStore.setSaving(false);
    await refreshServerHealth();
  }
}

export async function clearBootstrapApiBaseUrl() {
  bootstrapStore.setSaving(true);
  bootstrapStore.setSaveError(null);

  try {
    await SecureStore.deleteItemAsync(BACKEND_URL_STORAGE_KEY);
    bootstrapStore.setApiBaseUrl("");
    bootstrapStore.setConnectionStatus("idle");
    bootstrapStore.setConnectionMessage("Save a backend URL to connect this device.");
  } catch (error) {
    bootstrapStore.setSaveError(error instanceof Error ? error.message : "Failed to clear backend URL.");
    throw error;
  } finally {
    bootstrapStore.setSaving(false);
  }
}

export async function refreshServerHealth() {
  if (healthCheckPromise) {
    return healthCheckPromise;
  }

  healthCheckPromise = (async () => {
    const apiBaseUrl = normalizeApiBaseUrl(bootstrapStore.apiBaseUrl);

    if (!apiBaseUrl) {
      bootstrapStore.setConnectionStatus("idle");
      bootstrapStore.setConnectionMessage("Save a backend URL in onboarding or settings to connect this shell to a real server.");
      healthCheckPromise = null;
      return;
    }

    bootstrapStore.setConnectionStatus("checking");
    bootstrapStore.setConnectionMessage(`Checking ${apiBaseUrl}${HEALTH_PATH}`);

    try {
      const response = await fetchWithTimeout(`${apiBaseUrl}${HEALTH_PATH}`, { method: "GET" });
      if (!response.ok) {
        throw new Error(`Health check failed with status ${response.status}.`);
      }

      bootstrapStore.setConnectionStatus("online");
      bootstrapStore.setConnectionMessage(`Connected to ${apiBaseUrl}`);
    } catch (error) {
      bootstrapStore.setConnectionStatus("offline");
      bootstrapStore.setConnectionMessage(error instanceof Error ? error.message : "Unable to reach backend.");
    } finally {
      healthCheckPromise = null;
    }
  })();

  return healthCheckPromise;
}

export function useBootstrapScaffold() {
  const store = useBootstrapStore();

  useEffect(() => {
    void hydrateBootstrapStore();
  }, []);

  useEffect(() => {
    if (!store.hydrated || store.hydrating) {
      return;
    }

    void refreshServerHealth();
  }, [store.apiBaseUrl, store.hydrated, store.hydrating]);
}
