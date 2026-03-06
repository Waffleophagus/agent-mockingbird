import type {
  AgentTypeDefinition,
  ConfiguredMcpServer,
  ModelOption,
  RuntimeMcp,
  RuntimeSkill,
  RuntimeSkillIssue,
} from "@agent-mockingbird/contracts/dashboard";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ConfirmDialog } from "@/components/ui/dialog";
import { normalizeListInput } from "@/frontend/app/chatHelpers";
import {
  fetchAgentCatalog,
  fetchMcpCatalog,
  fetchOtherConfig,
  fetchSkillCatalog,
  importManagedSkill,
  saveAgentTypeChanges,
  saveMcps,
  saveOtherConfig as saveOtherConfigPatch,
  saveSkills,
  validateAgentTypeChanges,
} from "@/frontend/app/configApi";
import { deleteCronJob } from "@/frontend/app/cronApi";
import { type ConfirmAction, getConfirmDialogProps } from "@/frontend/app/dashboardTypes";
import { normalizeAgentTypeDraft } from "@/frontend/app/dashboardUtils";
import { AgentsPage } from "@/frontend/app/pages/AgentsPage";
import { CronPage } from "@/frontend/app/pages/CronPage";
import { McpPage } from "@/frontend/app/pages/McpPage";
import { OtherConfigPage } from "@/frontend/app/pages/OtherConfigPage";
import { SkillsPage } from "@/frontend/app/pages/SkillsPage";
import type { SessionScreenMode } from "@/frontend/opencode-react/types";

interface ManagementWorkspaceProps {
  activeScreen: SessionScreenMode;
  availableModels: ModelOption[];
  activeSessionModel: string;
}

type LoadedScreenState = Record<Exclude<SessionScreenMode, "chat">, boolean>;

function normalizeMcpServersDraft(servers: ConfiguredMcpServer[]): ConfiguredMcpServer[] {
  const deduped = new Map<string, ConfiguredMcpServer>();
  for (const server of servers) {
    const id = server.id.trim();
    if (!id) continue;
    deduped.set(id, { ...server, id });
  }
  return [...deduped.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function ManagementWorkspace(props: ManagementWorkspaceProps) {
  const { activeScreen, availableModels, activeSessionModel } = props;

  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [cronRefreshKey, setCronRefreshKey] = useState(0);
  const [loadedByScreen, setLoadedByScreen] = useState<LoadedScreenState>({
    skills: false,
    mcp: false,
    agents: false,
    other: false,
    cron: false,
  });

  const [configHash, setConfigHash] = useState("");
  const [agentConfigHash, setAgentConfigHash] = useState("");
  const [skillsCatalogHash, setSkillsCatalogHash] = useState("");
  const [opencodeDirectory, setOpencodeDirectory] = useState("");
  const [opencodeConfigFilePath, setOpencodeConfigFilePath] = useState("");
  const [opencodePersistenceMode, setOpencodePersistenceMode] = useState("");

  const [skillInput, setSkillInput] = useState("");
  const [skillsDraft, setSkillsDraft] = useState("");
  const [availableSkills, setAvailableSkills] = useState<RuntimeSkill[]>([]);
  const [disabledSkills, setDisabledSkills] = useState<string[]>([]);
  const [invalidSkills, setInvalidSkills] = useState<RuntimeSkillIssue[]>([]);
  const [skillsManagedPath, setSkillsManagedPath] = useState("");
  const [skillsDisabledPath, setSkillsDisabledPath] = useState("");
  const [importSkillId, setImportSkillId] = useState("");
  const [importSkillContent, setImportSkillContent] = useState("");
  const [loadingSkillCatalog, setLoadingSkillCatalog] = useState(false);
  const [isSavingSkills, setIsSavingSkills] = useState(false);
  const [isImportingSkill, setIsImportingSkill] = useState(false);
  const [skillCatalogError, setSkillCatalogError] = useState("");
  const [skillsError, setSkillsError] = useState("");

  const [mcpInput, setMcpInput] = useState("");
  const [availableMcps, setAvailableMcps] = useState<RuntimeMcp[]>([]);
  const [mcpServers, setMcpServers] = useState<ConfiguredMcpServer[]>([]);
  const [mcpsDraft, setMcpsDraft] = useState("");
  const [loadingMcpCatalog, setLoadingMcpCatalog] = useState(false);
  const [isSavingMcps, setIsSavingMcps] = useState(false);
  const [mcpCatalogError, setMcpCatalogError] = useState("");
  const [mcpsError, setMcpsError] = useState("");
  const [mcpActionError, setMcpActionError] = useState("");
  const [mcpActionBusyId, setMcpActionBusyId] = useState("");

  const [agentTypes, setAgentTypes] = useState<AgentTypeDefinition[]>([]);
  const [agentTypesBaseline, setAgentTypesBaseline] = useState<AgentTypeDefinition[]>([]);
  const [loadingAgentCatalog, setLoadingAgentCatalog] = useState(false);
  const [isSavingAgents, setIsSavingAgents] = useState(false);
  const [agentsError, setAgentsError] = useState("");
  const [agentCatalogError, setAgentCatalogError] = useState("");
  const [openAgentModelPickerId, setOpenAgentModelPickerId] = useState<string | null>(null);
  const [agentModelQuery, setAgentModelQuery] = useState("");
  const [agentFocusedModelIndex, setAgentFocusedModelIndex] = useState(0);
  const agentModelPickerRef = useRef<HTMLDivElement>(null);
  const agentModelSearchInputRef = useRef<HTMLInputElement>(null);

  const [runtimeFallbackModels, setRuntimeFallbackModels] = useState<string[]>([]);
  const [runtimeImageModel, setRuntimeImageModel] = useState("");
  const [loadingOtherConfig, setLoadingOtherConfig] = useState(false);
  const [isSavingOtherConfig, setIsSavingOtherConfig] = useState(false);
  const [otherConfigError, setOtherConfigError] = useState("");
  const [openFallbackModelPickerIndex, setOpenFallbackModelPickerIndex] = useState<number | null>(null);
  const [fallbackModelQuery, setFallbackModelQuery] = useState("");
  const [fallbackFocusedModelIndex, setFallbackFocusedModelIndex] = useState(0);
  const fallbackModelPickerRef = useRef<HTMLDivElement>(null);
  const fallbackModelSearchInputRef = useRef<HTMLInputElement>(null);

  const configuredSkills = useMemo(() => normalizeListInput(skillsDraft), [skillsDraft]);
  const configuredSkillSet = useMemo(() => new Set(configuredSkills), [configuredSkills]);
  const configuredUnavailableSkills = useMemo(() => {
    const knownIds = new Set([...availableSkills.map(skill => skill.id), ...disabledSkills]);
    return configuredSkills.filter(id => !knownIds.has(id));
  }, [availableSkills, configuredSkills, disabledSkills]);

  const configuredMcps = useMemo(() => normalizeListInput(mcpsDraft), [mcpsDraft]);
  const configuredMcpSet = useMemo(() => new Set(configuredMcps), [configuredMcps]);
  const normalizedMcpServers = useMemo(() => normalizeMcpServersDraft(mcpServers), [mcpServers]);
  const mcpServerIdSet = useMemo(() => new Set(normalizedMcpServers.map(server => server.id)), [normalizedMcpServers]);
  const runtimeMcpById = useMemo(() => new Map(availableMcps.map(mcp => [mcp.id, mcp])), [availableMcps]);
  const discoverableMcps = useMemo(
    () => availableMcps.filter(mcp => !configuredMcpSet.has(mcp.id)),
    [availableMcps, configuredMcpSet],
  );

  const availableFallbackModels = useMemo(() => availableModels, [availableModels]);

  useEffect(() => {
    if (activeScreen === "chat") return;
    if (loadedByScreen[activeScreen]) return;

    setLoadedByScreen(current => ({ ...current, [activeScreen]: true }));
    if (activeScreen === "skills") {
      void refreshSkillCatalog();
      return;
    }
    if (activeScreen === "mcp") {
      void refreshMcpCatalog();
      return;
    }
    if (activeScreen === "agents") {
      void refreshAgentCatalog();
      return;
    }
    if (activeScreen === "other") {
      void refreshOtherConfig();
      return;
    }
  }, [activeScreen, loadedByScreen]);

  useEffect(() => {
    if (!openAgentModelPickerId) return;
    agentModelSearchInputRef.current?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (!agentModelPickerRef.current?.contains(event.target as Node)) {
        setOpenAgentModelPickerId(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenAgentModelPickerId(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openAgentModelPickerId]);

  useEffect(() => {
    if (openAgentModelPickerId) {
      setAgentFocusedModelIndex(0);
    }
  }, [agentModelQuery, openAgentModelPickerId]);

  useEffect(() => {
    if (openFallbackModelPickerIndex === null) return;
    fallbackModelSearchInputRef.current?.focus();

    const handlePointerDown = (event: MouseEvent) => {
      if (!fallbackModelPickerRef.current?.contains(event.target as Node)) {
        setOpenFallbackModelPickerIndex(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenFallbackModelPickerIndex(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [openFallbackModelPickerIndex]);

  useEffect(() => {
    setFallbackFocusedModelIndex(0);
  }, [fallbackModelQuery, openFallbackModelPickerIndex]);

  async function refreshSkillCatalog() {
    setLoadingSkillCatalog(true);
    setSkillCatalogError("");
    setSkillsError("");
    try {
      const payload = await fetchSkillCatalog();
      setAvailableSkills(payload.skills);
      setSkillsDraft(payload.enabled.join("\n"));
      setDisabledSkills(payload.disabled);
      setInvalidSkills(payload.invalid);
      setSkillsCatalogHash(payload.hash || payload.revision);
      setSkillsManagedPath(payload.managedPath);
      setSkillsDisabledPath(payload.disabledPath);
    } catch (error) {
      setSkillCatalogError(error instanceof Error ? error.message : "Failed to load runtime skills");
    } finally {
      setLoadingSkillCatalog(false);
    }
  }

  async function refreshMcpCatalog() {
    setLoadingMcpCatalog(true);
    setMcpCatalogError("");
    setMcpsError("");
    setMcpActionError("");
    try {
      const payload = await fetchMcpCatalog();
      setAvailableMcps(payload.mcps);
      setMcpServers(payload.servers);
      setMcpsDraft(payload.enabled.join("\n"));
      if (payload.hash) setConfigHash(payload.hash);
    } catch (error) {
      setMcpCatalogError(error instanceof Error ? error.message : "Failed to load runtime MCP servers");
    } finally {
      setLoadingMcpCatalog(false);
    }
  }

  async function refreshAgentCatalog() {
    setLoadingAgentCatalog(true);
    setAgentCatalogError("");
    try {
      const payload = await fetchAgentCatalog();
      setAgentTypes(payload.agentTypes);
      setAgentTypesBaseline(payload.agentTypes);
      if (payload.hash) setAgentConfigHash(payload.hash);
      setOpencodeDirectory(typeof payload.storage.directory === "string" ? payload.storage.directory : "");
      setOpencodeConfigFilePath(typeof payload.storage.configFilePath === "string" ? payload.storage.configFilePath : "");
      setOpencodePersistenceMode(typeof payload.storage.persistenceMode === "string" ? payload.storage.persistenceMode : "");
    } catch (error) {
      setAgentCatalogError(error instanceof Error ? error.message : "Failed to load OpenCode agent definitions");
    } finally {
      setLoadingAgentCatalog(false);
    }
  }

  async function refreshOtherConfig() {
    setLoadingOtherConfig(true);
    setOtherConfigError("");
    try {
      const payload = await fetchOtherConfig();
      setRuntimeFallbackModels([...new Set(payload.fallbackModels.map(model => model.trim()).filter(Boolean))]);
      setRuntimeImageModel(payload.imageModel.trim());
      if (payload.hash) setConfigHash(payload.hash);
    } catch (error) {
      setOtherConfigError(error instanceof Error ? error.message : "Failed to load runtime config");
    } finally {
      setLoadingOtherConfig(false);
    }
  }

  function toggleSkillEnabled(skillId: string) {
    if (configuredSkillSet.has(skillId)) {
      setSkillsDraft(configuredSkills.filter(value => value !== skillId).join("\n"));
      return;
    }
    setSkillsDraft([...configuredSkills, skillId].join("\n"));
  }

  function addSkill() {
    const next = skillInput.trim();
    if (!next) return;
    setSkillsDraft(normalizeListInput([...configuredSkills, next].join("\n")).join("\n"));
    setSkillInput("");
  }

  function removeSkill(skillId: string) {
    setSkillsDraft(configuredSkills.filter(value => value !== skillId).join("\n"));
  }

  async function saveSkillsConfig() {
    setIsSavingSkills(true);
    setSkillsError("");
    try {
      const payload = await saveSkills({
        skills: configuredSkills,
        expectedHash: skillsCatalogHash || undefined,
      });
      setSkillsDraft(payload.skills.join("\n"));
      setSkillsCatalogHash(payload.hash || skillsCatalogHash);
      await refreshSkillCatalog();
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : "Failed to save skills");
    } finally {
      setIsSavingSkills(false);
    }
  }

  async function importSkill() {
    const id = importSkillId.trim();
    const content = importSkillContent.trim();
    if (!id || !content) return;

    setIsImportingSkill(true);
    setSkillsError("");
    try {
      const payload = await importManagedSkill({
        id,
        content,
        expectedHash: skillsCatalogHash || undefined,
        enable: true,
      });
      setImportSkillId("");
      setImportSkillContent("");
      setSkillsDraft(payload.skills.join("\n"));
      if (payload.hash) setSkillsCatalogHash(payload.hash);
      await refreshSkillCatalog();
    } catch (error) {
      setSkillsError(error instanceof Error ? error.message : "Failed to import skill");
    } finally {
      setIsImportingSkill(false);
    }
  }

  function updateMcpServer(id: string, updater: (server: ConfiguredMcpServer) => ConfiguredMcpServer) {
    setMcpServers(current => current.map(server => (server.id === id ? updater(server) : server)));
  }

  function renameMcpServer(id: string, nextId: string) {
    const trimmed = nextId.trim();
    if (!trimmed) return;
    setMcpServers(current => {
      if (current.some(server => server.id !== id && server.id === trimmed)) return current;
      return current.map(server => (server.id === id ? { ...server, id: trimmed } : server));
    });
    setMcpsDraft(configuredMcps.map(value => (value === id ? trimmed : value)).join("\n"));
  }

  function setMcpServerType(id: string, type: "remote" | "local") {
    updateMcpServer(id, server => {
      if (server.type === type) return server;
      if (type === "remote") {
        return {
          id: server.id,
          type: "remote",
          enabled: server.enabled,
          url: "http://127.0.0.1:8000/mcp",
          headers: {},
          oauth: "auto",
        };
      }
      return {
        id: server.id,
        type: "local",
        enabled: server.enabled,
        command: ["bun", "run", "mcp-server.ts"],
        environment: {},
      };
    });
  }

  function addMcp() {
    const next = mcpInput.trim();
    if (!next) return;
    setMcpsDraft(normalizeListInput([...configuredMcps, next].join("\n")).join("\n"));
    if (!mcpServerIdSet.has(next)) {
      setMcpServers(current => [
        ...current,
        {
          id: next,
          type: "remote",
          enabled: true,
          url: "http://127.0.0.1:8000/mcp",
          headers: {},
          oauth: "auto",
        },
      ]);
    }
    setMcpInput("");
  }

  function removeMcp(mcpId: string) {
    setMcpsDraft(configuredMcps.filter(value => value !== mcpId).join("\n"));
    setMcpServers(current => current.filter(server => server.id !== mcpId));
  }

  function mcpStatusVariant(status: RuntimeMcp["status"]) {
    if (status === "connected") return "success" as const;
    if (status === "failed" || status === "needs_client_registration" || status === "needs_auth") {
      return "warning" as const;
    }
    return "outline" as const;
  }

  function mcpStatusLabel(status: RuntimeMcp["status"]) {
    if (status === "needs_auth") return "Needs Auth";
    if (status === "needs_client_registration") return "Needs Registration";
    return status.replaceAll("_", " ");
  }

  async function runMcpRuntimeAction(id: string, action: "connect" | "disconnect" | "authStart" | "authRemove") {
    setMcpActionBusyId(`${action}:${id}`);
    setMcpActionError("");
    try {
      const path =
        action === "connect"
          ? `/api/config/mcps/${encodeURIComponent(id)}/connect`
          : action === "disconnect"
            ? `/api/config/mcps/${encodeURIComponent(id)}/disconnect`
            : action === "authStart"
              ? `/api/config/mcps/${encodeURIComponent(id)}/auth/start`
              : `/api/config/mcps/${encodeURIComponent(id)}/auth/remove`;
      const response = await fetch(path, { method: "POST" });
      const payload = (await response.json()) as {
        error?: string;
        mcps?: RuntimeMcp[];
        authorizationUrl?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to ${action} MCP server`);
      }
      if (Array.isArray(payload.mcps)) {
        setAvailableMcps(payload.mcps);
      }
      if (action === "authStart" && typeof payload.authorizationUrl === "string" && payload.authorizationUrl.trim()) {
        window.open(payload.authorizationUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setMcpActionError(error instanceof Error ? error.message : `Failed to ${action} MCP server`);
    } finally {
      setMcpActionBusyId("");
    }
  }

  async function saveMcpsConfig() {
    setIsSavingMcps(true);
    setMcpsError("");
    try {
      const enabledSet = new Set(configuredMcps);
      const serversForSave = normalizedMcpServers.map(server => ({
        ...server,
        enabled: enabledSet.has(server.id),
      }));
      const undefinedEnabledIds = configuredMcps.filter(
        id => serversForSave.length > 0 && !serversForSave.some(server => server.id === id),
      );
      if (undefinedEnabledIds.length > 0) {
        throw new Error(`Missing MCP definition for enabled server(s): ${undefinedEnabledIds.join(", ")}`);
      }
      const payload = await saveMcps({
        ...(serversForSave.length > 0 ? { servers: serversForSave } : { mcps: configuredMcps }),
        expectedHash: configHash || undefined,
      });
      setMcpsDraft(payload.mcps.join("\n"));
      setMcpServers(payload.servers);
      setConfigHash(payload.hash || configHash);
      await refreshMcpCatalog();
    } catch (error) {
      setMcpsError(error instanceof Error ? error.message : "Failed to save MCP servers");
    } finally {
      setIsSavingMcps(false);
    }
  }

  function addAgentType() {
    const next: AgentTypeDefinition = {
      id: `agent-${crypto.randomUUID().slice(0, 8)}`,
      name: "New Agent Type",
      description: "Describe when to use this agent type.",
      prompt: "Describe how this agent type should behave.",
      model: activeSessionModel || availableModels[0]?.id || "opencode/big-pickle",
      mode: "subagent",
      hidden: false,
      disable: false,
      options: {},
    };
    setAgentTypes(current => [...current, next]);
  }

  function removeAgentType(agentTypeId: string) {
    setAgentTypes(current => current.filter(agentType => agentType.id !== agentTypeId));
  }

  function updateAgentTypeField<K extends keyof AgentTypeDefinition>(
    agentTypeId: string,
    field: K,
    value: AgentTypeDefinition[K],
  ) {
    setAgentTypes(current =>
      current.map(agentType => {
        if (agentType.id !== agentTypeId) return agentType;
        return {
          ...agentType,
          [field]: value,
        };
      }),
    );
  }

  function filteredAgentModelOptions() {
    const query = agentModelQuery.trim().toLowerCase();
    if (!query) return availableModels;
    return availableModels.filter(option => {
      const haystack = `${option.label} ${option.id} ${option.providerId} ${option.modelId}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  function selectAgentModelFromPicker(agentId: string, model: string) {
    updateAgentTypeField(agentId, "model", model.trim() || undefined);
    setAgentModelQuery("");
    setOpenAgentModelPickerId(null);
  }

  function handleAgentModelSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, agentId: string) {
    const options = filteredAgentModelOptions();
    const maxIndex = options.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAgentFocusedModelIndex(current => Math.min(current + 1, maxIndex));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setAgentFocusedModelIndex(current => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (agentFocusedModelIndex === 0) {
        selectAgentModelFromPicker(agentId, "");
        return;
      }
      const focused = options[agentFocusedModelIndex - 1];
      if (focused?.id) {
        selectAgentModelFromPicker(agentId, focused.id);
      }
    }
  }

  async function saveAgentTypesConfig() {
    setIsSavingAgents(true);
    setAgentsError("");
    try {
      const normalizedCurrent = agentTypes.map(normalizeAgentTypeDraft);
      const normalizedBaseline = agentTypesBaseline.map(normalizeAgentTypeDraft);
      const baselineById = new Map(normalizedBaseline.map(agentType => [agentType.id, agentType]));
      const currentById = new Map(normalizedCurrent.map(agentType => [agentType.id, agentType]));

      const upserts = normalizedCurrent.filter(agentType => {
        const previous = baselineById.get(agentType.id);
        if (!previous) return true;
        return JSON.stringify(previous) !== JSON.stringify(agentType);
      });
      const deletes = normalizedBaseline.map(agentType => agentType.id).filter(id => !currentById.has(id));
      if (upserts.length === 0 && deletes.length === 0) {
        setIsSavingAgents(false);
        return;
      }

      const validationPayload = await validateAgentTypeChanges({ upserts, deletes });
      if (validationPayload.ok !== true) {
        const firstIssue = validationPayload.issues?.[0];
        throw new Error(firstIssue?.message || "Agent validation failed");
      }
      if (!agentConfigHash.trim()) {
        throw new Error("Agent config hash missing. Refresh agents and try again.");
      }

      const payload = await saveAgentTypeChanges({
        upserts,
        deletes,
        expectedHash: agentConfigHash,
      });

      setAgentTypes(payload.agentTypes);
      setAgentTypesBaseline(payload.agentTypes);
      setAgentConfigHash(payload.hash || agentConfigHash);
      setOpencodeDirectory(typeof payload.storage.directory === "string" ? payload.storage.directory : opencodeDirectory);
      setOpencodeConfigFilePath(
        typeof payload.storage.configFilePath === "string" ? payload.storage.configFilePath : opencodeConfigFilePath,
      );
      setOpencodePersistenceMode(
        typeof payload.storage.persistenceMode === "string" ? payload.storage.persistenceMode : opencodePersistenceMode,
      );
    } catch (error) {
      setAgentsError(error instanceof Error ? error.message : "Failed to save agent types");
    } finally {
      setIsSavingAgents(false);
    }
  }

  function addFallbackModel() {
    const firstModelId = availableFallbackModels[0]?.id;
    if (!firstModelId) {
      setOtherConfigError("No available models to add as fallback.");
      return;
    }
    setOtherConfigError("");
    setRuntimeFallbackModels(current => [...current, firstModelId]);
  }

  function removeFallbackModel(index: number) {
    setRuntimeFallbackModels(current => current.filter((_, currentIndex) => currentIndex !== index));
    setOpenFallbackModelPickerIndex(current => {
      if (current === null) return current;
      if (current === index) return null;
      if (current > index) return current - 1;
      return current;
    });
  }

  function filteredFallbackModelOptions() {
    const query = fallbackModelQuery.trim().toLowerCase();
    if (!query) return availableFallbackModels;
    return availableFallbackModels.filter(option => {
      const haystack = `${option.label} ${option.id} ${option.providerId} ${option.modelId}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  function selectFallbackModelFromPicker(index: number, model: string) {
    setRuntimeFallbackModels(current =>
      current.map((currentModel, currentIndex) => (currentIndex === index ? model.trim() : currentModel)),
    );
    setFallbackModelQuery("");
    setOpenFallbackModelPickerIndex(null);
  }

  function handleFallbackModelSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, index: number) {
    const options = filteredFallbackModelOptions();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFallbackFocusedModelIndex(current => Math.min(current + 1, options.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFallbackFocusedModelIndex(current => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const focusedModel = options[fallbackFocusedModelIndex];
      if (focusedModel?.id) {
        selectFallbackModelFromPicker(index, focusedModel.id);
      }
    }
  }

  async function saveOtherConfig() {
    setIsSavingOtherConfig(true);
    setOtherConfigError("");
    try {
      const normalizedFallbackModels = [...new Set(runtimeFallbackModels.map(model => model.trim()).filter(Boolean))];
      const payload = await saveOtherConfigPatch({
        fallbackModels: normalizedFallbackModels,
        imageModel: runtimeImageModel,
        expectedHash: configHash || undefined,
      });
      setRuntimeFallbackModels(payload.fallbackModels);
      setRuntimeImageModel(payload.imageModel.trim());
      setConfigHash(payload.hash || configHash);
      setOpenFallbackModelPickerIndex(null);
      setFallbackModelQuery("");
    } catch (error) {
      setOtherConfigError(error instanceof Error ? error.message : "Failed to save runtime config");
    } finally {
      setIsSavingOtherConfig(false);
    }
  }

  function requestRemoveSkill(skillId: string) {
    setConfirmAction({ type: "remove-skill", skillId });
  }

  function requestRemoveMcp(mcpId: string) {
    setConfirmAction({ type: "remove-mcp", mcpId });
  }

  function requestDisconnectMcp(mcpId: string) {
    setConfirmAction({ type: "disconnect-mcp", mcpId });
  }

  function requestRemoveAgent(agentId: string) {
    setConfirmAction({ type: "remove-agent", agentId });
  }

  function requestRemoveCronJob(jobId: string) {
    setConfirmAction({ type: "remove-cron", jobId });
  }

  async function removeCronJobById(jobId: string) {
    try {
      await deleteCronJob(jobId);
      setCronRefreshKey(current => current + 1);
    } catch (error) {
      console.error("Failed to delete cron job:", error);
    }
  }

  function handleConfirmAction() {
    const action = confirmAction;
    setConfirmAction(null);
    if (!action) return;

    switch (action.type) {
      case "remove-skill":
        removeSkill(action.skillId);
        return;
      case "remove-mcp":
        removeMcp(action.mcpId);
        return;
      case "disconnect-mcp":
        void runMcpRuntimeAction(action.mcpId, "disconnect");
        return;
      case "remove-agent":
        removeAgentType(action.agentId);
        return;
      case "remove-cron":
        void removeCronJobById(action.jobId);
        return;
      default:
        return;
    }
  }

  function renderScreen() {
    switch (activeScreen) {
      case "skills":
        return (
          <SkillsPage
            skillInput={skillInput}
            setSkillInput={setSkillInput}
            addSkill={addSkill}
            loadingSkillCatalog={loadingSkillCatalog}
            availableSkills={availableSkills}
            configuredSkillSet={configuredSkillSet}
            disabledSkills={disabledSkills}
            invalidSkills={invalidSkills}
            skillsManagedPath={skillsManagedPath}
            skillsDisabledPath={skillsDisabledPath}
            toggleSkillEnabled={toggleSkillEnabled}
            configuredUnavailableSkills={configuredUnavailableSkills}
            requestRemoveSkill={requestRemoveSkill}
            refreshSkillCatalog={refreshSkillCatalog}
            saveSkillsConfig={saveSkillsConfig}
            isSavingSkills={isSavingSkills}
            skillCatalogError={skillCatalogError}
            skillsError={skillsError}
            importSkillId={importSkillId}
            setImportSkillId={setImportSkillId}
            importSkillContent={importSkillContent}
            setImportSkillContent={setImportSkillContent}
            importSkill={importSkill}
            isImportingSkill={isImportingSkill}
            skillsDraft={skillsDraft}
            setSkillsDraft={setSkillsDraft}
            configuredSkills={configuredSkills}
          />
        );
      case "mcp":
        return (
          <McpPage
            mcpInput={mcpInput}
            setMcpInput={setMcpInput}
            addMcp={addMcp}
            configuredMcps={configuredMcps}
            runtimeMcpById={runtimeMcpById}
            mcpStatusVariant={mcpStatusVariant}
            mcpStatusLabel={mcpStatusLabel}
            runMcpRuntimeAction={runMcpRuntimeAction}
            mcpActionBusyId={mcpActionBusyId}
            requestDisconnectMcp={requestDisconnectMcp}
            requestRemoveMcp={requestRemoveMcp}
            discoverableMcps={discoverableMcps}
            setMcpsDraft={setMcpsDraft}
            mcpServerIdSet={mcpServerIdSet}
            setMcpServers={setMcpServers}
            refreshMcpCatalog={refreshMcpCatalog}
            loadingMcpCatalog={loadingMcpCatalog}
            saveMcpsConfig={saveMcpsConfig}
            isSavingMcps={isSavingMcps}
            mcpCatalogError={mcpCatalogError}
            mcpsError={mcpsError}
            mcpActionError={mcpActionError}
            normalizedMcpServers={normalizedMcpServers}
            renameMcpServer={renameMcpServer}
            setMcpServerType={setMcpServerType}
            configuredMcpSet={configuredMcpSet}
            updateMcpServer={updateMcpServer}
          />
        );
      case "agents":
        return (
          <AgentsPage
            refreshAgentCatalog={refreshAgentCatalog}
            loadingAgentCatalog={loadingAgentCatalog}
            saveAgentTypesConfig={saveAgentTypesConfig}
            isSavingAgents={isSavingAgents}
            agentsError={agentsError}
            agentCatalogError={agentCatalogError}
            opencodeConfigFilePath={opencodeConfigFilePath}
            opencodeDirectory={opencodeDirectory}
            opencodePersistenceMode={opencodePersistenceMode}
            addAgentType={addAgentType}
            agentTypes={agentTypes}
            requestRemoveAgent={requestRemoveAgent}
            updateAgentTypeField={updateAgentTypeField}
            openAgentModelPickerId={openAgentModelPickerId}
            setOpenAgentModelPickerId={setOpenAgentModelPickerId}
            setAgentModelQuery={setAgentModelQuery}
            agentModelPickerRef={agentModelPickerRef}
            availableModels={availableModels}
            agentModelSearchInputRef={agentModelSearchInputRef}
            agentModelQuery={agentModelQuery}
            handleAgentModelSearchKeyDown={handleAgentModelSearchKeyDown}
            selectAgentModelFromPicker={selectAgentModelFromPicker}
            filteredAgentModelOptions={filteredAgentModelOptions}
            agentFocusedModelIndex={agentFocusedModelIndex}
          />
        );
      case "other":
        return (
          <OtherConfigPage
            refreshOtherConfig={refreshOtherConfig}
            loadingOtherConfig={loadingOtherConfig}
            saveOtherConfig={saveOtherConfig}
            isSavingOtherConfig={isSavingOtherConfig}
            otherConfigError={otherConfigError}
            runtimeFallbackModels={runtimeFallbackModels}
            availableFallbackModels={availableFallbackModels}
            addFallbackModel={addFallbackModel}
            removeFallbackModel={removeFallbackModel}
            openFallbackModelPickerIndex={openFallbackModelPickerIndex}
            setOpenFallbackModelPickerIndex={setOpenFallbackModelPickerIndex}
            setFallbackModelQuery={setFallbackModelQuery}
            fallbackModelPickerRef={fallbackModelPickerRef}
            fallbackModelSearchInputRef={fallbackModelSearchInputRef}
            fallbackModelQuery={fallbackModelQuery}
            handleFallbackModelSearchKeyDown={handleFallbackModelSearchKeyDown}
            selectFallbackModelFromPicker={selectFallbackModelFromPicker}
            filteredFallbackModelOptions={filteredFallbackModelOptions}
            fallbackFocusedModelIndex={fallbackFocusedModelIndex}
            runtimeImageModel={runtimeImageModel}
            setRuntimeImageModel={setRuntimeImageModel}
          />
        );
      case "cron":
        return <CronPage requestRemoveCronJob={requestRemoveCronJob} refreshKey={cronRefreshKey} />;
      default:
        return null;
    }
  }

  const confirmDialog = getConfirmDialogProps(confirmAction);

  return (
    <main
      className="text-foreground"
      style={{
        minHeight: "calc(100vh - 4rem)",
        background: "linear-gradient(180deg, color-mix(in srgb, var(--background-base) 92%, var(--surface-raised-base) 8%), var(--background-base))",
        padding: "20px 16px",
      }}
    >
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmLabel={confirmDialog.confirmLabel}
        variant={confirmDialog.variant}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>
        {renderScreen()}
      </div>
    </main>
  );
}
