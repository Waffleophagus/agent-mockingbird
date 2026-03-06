import { onSnapshot, types } from "mobx-state-tree";
import { useEffect, useState } from "react";

const BootstrapStore = types
  .model("BootstrapStore", {
    apiBaseUrl: types.string,
    notificationsEnabled: types.boolean,
  })
  .actions(self => ({
    setApiBaseUrl(value: string) {
      self.apiBaseUrl = value;
    },
    setNotificationsEnabled(value: boolean) {
      self.notificationsEnabled = value;
    },
  }));

const bootstrapStore = BootstrapStore.create({
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  notificationsEnabled: true,
});

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

export function useBootstrapScaffold() {
  const { apiBaseUrl, notificationsEnabled } = useBootstrapStore();

  useEffect(() => {
    // Placeholder for shared app-core bootstrap:
    // - hydrate settings from async storage
    // - create tRPC client with apiBaseUrl
    // - register Expo notification handlers and device token
    // - attach typed websocket transport
    void apiBaseUrl;
    void notificationsEnabled;
  }, [apiBaseUrl, notificationsEnabled]);
}
