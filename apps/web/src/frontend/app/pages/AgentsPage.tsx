import { ChevronsUpDown, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, RefObject, SetStateAction } from "react";

import type { AgentTypeDefinition, ModelOption } from "@wafflebot/contracts/dashboard";

interface AgentsPageProps {
  refreshAgentCatalog: () => Promise<void>;
  loadingAgentCatalog: boolean;
  saveAgentTypesConfig: () => Promise<void>;
  isSavingAgents: boolean;
  agentsError: string;
  agentCatalogError: string;
  opencodeConfigFilePath: string;
  opencodeDirectory: string;
  opencodePersistenceMode: string;
  addAgentType: () => void;
  agentTypes: AgentTypeDefinition[];
  requestRemoveAgent: (agentId: string) => void;
  updateAgentTypeField: <K extends keyof AgentTypeDefinition>(
    agentTypeId: string,
    field: K,
    value: AgentTypeDefinition[K],
  ) => void;
  openAgentModelPickerId: string | null;
  setOpenAgentModelPickerId: Dispatch<SetStateAction<string | null>>;
  setAgentModelQuery: (value: string) => void;
  agentModelPickerRef: RefObject<HTMLDivElement | null>;
  availableModels: ModelOption[];
  agentModelSearchInputRef: RefObject<HTMLInputElement | null>;
  agentModelQuery: string;
  handleAgentModelSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>, agentId: string) => void;
  selectAgentModelFromPicker: (agentId: string, model: string) => void;
  filteredAgentModelOptions: () => ModelOption[];
  agentFocusedModelIndex: number;
}

export function AgentsPage(props: AgentsPageProps) {
  const {
    refreshAgentCatalog,
    loadingAgentCatalog,
    saveAgentTypesConfig,
    isSavingAgents,
    agentsError,
    agentCatalogError,
    opencodeConfigFilePath,
    opencodeDirectory,
    opencodePersistenceMode,
    addAgentType,
    agentTypes,
    requestRemoveAgent,
    updateAgentTypeField,
    openAgentModelPickerId,
    setOpenAgentModelPickerId,
    setAgentModelQuery,
    agentModelPickerRef,
    availableModels,
    agentModelSearchInputRef,
    agentModelQuery,
    handleAgentModelSearchKeyDown,
    selectAgentModelFromPicker,
    filteredAgentModelOptions,
    agentFocusedModelIndex,
  } = props;

  return (
    <section className="mgmt-page">
      <div className="mgmt-page-header">
        <p className="mgmt-page-eyebrow">Configuration</p>
        <h2 className="mgmt-page-title">Agent Types</h2>
        <p className="mgmt-page-subtitle">Edit OpenCode agent definitions. Changes are applied immediately on save.</p>
      </div>

      <div className="mgmt-panel" style={{ flex: 1 }}>
        <div className="mgmt-panel-header">
          <div className="mgmt-panel-header-row">
            <h3 className="mgmt-panel-title">
              <Users size={14} />
              Definitions
            </h3>
            <div className="mgmt-actions">
              <button type="button" className="mgmt-pill-btn" onClick={() => void refreshAgentCatalog()} disabled={loadingAgentCatalog}>
                {loadingAgentCatalog ? "Refreshing..." : "Refresh"}
              </button>
              <button type="button" className="mgmt-pill-btn mgmt-pill-btn-primary" onClick={() => void saveAgentTypesConfig()} disabled={isSavingAgents}>
                {isSavingAgents ? "Saving..." : "Save agent types"}
              </button>
            </div>
          </div>
          {agentsError && <div className="mgmt-error" style={{ marginTop: 8 }}>{agentsError}</div>}
          {agentCatalogError && <div className="mgmt-error" style={{ marginTop: 8 }}>{agentCatalogError}</div>}
        </div>
        <div className="mgmt-panel-body">
          {/* Info bar */}
          <div className="mgmt-section">
            <div className="mgmt-card-header">
              <div>
                <h4 className="mgmt-section-title">OpenCode Agents</h4>
                <p className="mgmt-section-desc">Add, edit, or remove agent definitions managed in OpenCode.</p>
                {(opencodeConfigFilePath || opencodeDirectory) && (
                  <div style={{ paddingTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                    {opencodeConfigFilePath && (
                      <p style={{ margin: 0, fontSize: 11, color: "var(--text-weaker)", fontFamily: "'Geist Mono', monospace" }}>
                        Saving to: {opencodeConfigFilePath}
                      </p>
                    )}
                    {opencodeDirectory && (
                      <p style={{ margin: 0, fontSize: 11, color: "var(--text-weaker)", fontFamily: "'Geist Mono', monospace" }}>
                        Bound directory: {opencodeDirectory}
                      </p>
                    )}
                    {opencodePersistenceMode && (
                      <p style={{ margin: 0, fontSize: 11, color: "var(--text-weaker)", fontFamily: "'Geist Mono', monospace" }}>
                        Mode: {opencodePersistenceMode}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <button type="button" className="mgmt-pill-btn" onClick={addAgentType}>
                <Plus size={13} />
                Create custom type
              </button>
            </div>
          </div>

          {/* Agent list */}
          {agentTypes.length === 0 && (
            <div className="mgmt-empty">No OpenCode agent definitions found. Create one to get started.</div>
          )}

          {agentTypes.map(agentType => (
            <div key={agentType.id} className="mgmt-section">
              {/* Agent header */}
              <div className="mgmt-card-header">
                <div className="mgmt-card-title">
                  <span className={`mgmt-dot ${agentType.disable ? "mgmt-dot-off" : "mgmt-dot-on"}`} />
                  <span>{agentType.name || agentType.id}</span>
                </div>
                <button
                  type="button"
                  className="mgmt-pill-btn mgmt-pill-btn-danger mgmt-pill-btn-ghost"
                  onClick={() => requestRemoveAgent(agentType.id)}
                  style={{ height: 26, padding: "0 8px" }}
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* ID + Name */}
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label className="mgmt-form-label" htmlFor={`agent-id-${agentType.id}`}>ID</label>
                  <input
                    id={`agent-id-${agentType.id}`}
                    type="text"
                    className="mgmt-input"
                    value={agentType.id}
                    onChange={event => updateAgentTypeField(agentType.id, "id", event.target.value)}
                    placeholder="agent-id"
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label className="mgmt-form-label" htmlFor={`agent-name-${agentType.id}`}>Name</label>
                  <input
                    id={`agent-name-${agentType.id}`}
                    type="text"
                    className="mgmt-input"
                    value={agentType.name ?? ""}
                    onChange={event => updateAgentTypeField(agentType.id, "name", event.target.value)}
                    placeholder="Agent name"
                  />
                </div>
              </div>

              {/* Description + Model */}
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label className="mgmt-form-label" htmlFor={`agent-description-${agentType.id}`}>Description</label>
                  <input
                    id={`agent-description-${agentType.id}`}
                    type="text"
                    className="mgmt-input"
                    value={agentType.description ?? ""}
                    onChange={event => updateAgentTypeField(agentType.id, "description", event.target.value)}
                    placeholder="When this agent should be used"
                  />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="mgmt-form-label">Model</span>
                  <div
                    className="relative"
                    style={{ position: "relative" }}
                    ref={openAgentModelPickerId === agentType.id ? agentModelPickerRef : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setAgentModelQuery("");
                        setOpenAgentModelPickerId(current => (current === agentType.id ? null : agentType.id));
                      }}
                      className="mgmt-model-trigger"
                      aria-expanded={openAgentModelPickerId === agentType.id}
                      aria-haspopup="listbox"
                    >
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {agentType.model
                          ? availableModels.find(model => model.id === agentType.model)?.label ?? agentType.model
                          : "Default runtime model"}
                      </span>
                      <ChevronsUpDown size={14} style={{ color: "var(--text-weaker)", flexShrink: 0 }} />
                    </button>
                    {openAgentModelPickerId === agentType.id && (
                      <div className="mgmt-model-picker-dropdown">
                        <input
                          ref={agentModelSearchInputRef}
                          type="text"
                          className="mgmt-input"
                          value={agentModelQuery}
                          onChange={event => setAgentModelQuery(event.target.value)}
                          onKeyDown={event => handleAgentModelSearchKeyDown(event, agentType.id)}
                          placeholder="Search model..."
                          style={{ height: 32, fontSize: 12 }}
                        />
                        <div style={{ marginTop: 6, maxHeight: 240, overflowY: "auto" }} role="listbox">
                          <button
                            type="button"
                            onClick={() => selectAgentModelFromPicker(agentType.id, "")}
                            className="mgmt-model-option"
                            data-focused={!agentType.model && agentFocusedModelIndex === 0}
                          >
                            <p className="mgmt-model-option-label">Default runtime model</p>
                          </button>
                          {filteredAgentModelOptions().length === 0 ? (
                            <p style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-weaker)" }}>No models match your search.</p>
                          ) : (
                            filteredAgentModelOptions().map((option, index) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => selectAgentModelFromPicker(agentType.id, option.id)}
                                className="mgmt-model-option"
                                data-focused={index + 1 === agentFocusedModelIndex}
                                data-active={agentType.model === option.id}
                              >
                                <p className="mgmt-model-option-label">{option.label}</p>
                                <p className="mgmt-model-option-id">{option.id}</p>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Prompt */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label className="mgmt-form-label" htmlFor={`agent-prompt-${agentType.id}`}>Prompt</label>
                <textarea
                  id={`agent-prompt-${agentType.id}`}
                  className="mgmt-textarea"
                  value={agentType.prompt ?? ""}
                  onChange={event => updateAgentTypeField(agentType.id, "prompt", event.target.value)}
                  placeholder="Instructions for this agent"
                  style={{ minHeight: 80 }}
                />
              </div>

              {/* Mode + Enabled */}
              <div className="mgmt-actions">
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label className="mgmt-form-label" htmlFor={`agent-mode-${agentType.id}`}>Mode</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <ShieldCheck size={14} style={{ color: "var(--text-weaker)" }} />
                    <select
                      id={`agent-mode-${agentType.id}`}
                      className="mgmt-select"
                      style={{ height: 32, fontSize: 12 }}
                      value={agentType.mode}
                      onChange={event =>
                        updateAgentTypeField(agentType.id, "mode", event.target.value as AgentTypeDefinition["mode"])
                      }
                    >
                      <option value="subagent">subagent</option>
                      <option value="primary">primary</option>
                      <option value="all">all</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="mgmt-form-label">Status</span>
                  <label className="mgmt-checkbox-row" style={{ height: 32 }}>
                    <input
                      type="checkbox"
                      checked={!agentType.disable}
                      onChange={event => updateAgentTypeField(agentType.id, "disable", !event.target.checked)}
                    />
                    Active
                  </label>
                </div>
              </div>
            </div>
          ))}

          <p className="mgmt-count-note">
            {agentTypes.length} OpenCode agent definition{agentTypes.length === 1 ? "" : "s"}.
          </p>
        </div>
      </div>
    </section>
  );
}
