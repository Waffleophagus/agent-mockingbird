import { Cpu, Plus, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import type { ConfiguredMcpServer, RuntimeMcp } from "@/types/dashboard";

interface McpPageProps {
  mcpInput: string;
  setMcpInput: (value: string) => void;
  addMcp: () => void;
  configuredMcps: string[];
  runtimeMcpById: Map<string, RuntimeMcp>;
  mcpStatusVariant: (status: RuntimeMcp["status"]) => "success" | "warning" | "outline";
  mcpStatusLabel: (status: RuntimeMcp["status"]) => string;
  runMcpRuntimeAction: (id: string, action: "connect" | "disconnect" | "authStart" | "authRemove") => Promise<void>;
  mcpActionBusyId: string;
  requestDisconnectMcp: (mcpId: string) => void;
  requestRemoveMcp: (mcpId: string) => void;
  discoverableMcps: RuntimeMcp[];
  setMcpsDraft: (value: string) => void;
  mcpServerIdSet: Set<string>;
  setMcpServers: Dispatch<SetStateAction<ConfiguredMcpServer[]>>;
  refreshMcpCatalog: () => Promise<void>;
  loadingMcpCatalog: boolean;
  saveMcpsConfig: () => Promise<void>;
  isSavingMcps: boolean;
  mcpCatalogError: string;
  mcpsError: string;
  mcpActionError: string;
  normalizedMcpServers: ConfiguredMcpServer[];
  renameMcpServer: (id: string, nextId: string) => void;
  setMcpServerType: (id: string, type: "remote" | "local") => void;
  configuredMcpSet: Set<string>;
  updateMcpServer: (id: string, updater: (server: ConfiguredMcpServer) => ConfiguredMcpServer) => void;
}

function mgmtBadgeClass(variant: "success" | "warning" | "outline"): string {
  if (variant === "success") return "mgmt-badge-success";
  if (variant === "warning") return "mgmt-badge-warning";
  return "";
}

export function McpPage(props: McpPageProps) {
  const {
    mcpInput,
    setMcpInput,
    addMcp,
    configuredMcps,
    runtimeMcpById,
    mcpStatusVariant,
    mcpStatusLabel,
    runMcpRuntimeAction,
    mcpActionBusyId,
    requestDisconnectMcp,
    requestRemoveMcp,
    discoverableMcps,
    setMcpsDraft,
    mcpServerIdSet,
    setMcpServers,
    refreshMcpCatalog,
    loadingMcpCatalog,
    saveMcpsConfig,
    isSavingMcps,
    mcpCatalogError,
    mcpsError,
    mcpActionError,
    normalizedMcpServers,
    renameMcpServer,
    setMcpServerType,
    configuredMcpSet,
    updateMcpServer,
  } = props;

  return (
    <section className="mgmt-page">
      <div className="mgmt-page-header">
        <p className="mgmt-page-eyebrow">Configuration</p>
        <h2 className="mgmt-page-title">MCP Servers</h2>
        <p className="mgmt-page-subtitle">Manage MCP allow-list and verify runtime status from OpenCode.</p>
      </div>

      <div className="mgmt-grid mgmt-grid-sidebar">
        {/* Left panel: MCP management */}
        <div className="mgmt-panel">
          <div className="mgmt-panel-header">
            <div className="mgmt-panel-header-row">
              <h3 className="mgmt-panel-title">
                <Cpu size={14} />
                Active Servers
              </h3>
              <span className="mgmt-badge">{configuredMcps.length} enabled</span>
            </div>
          </div>
          <div className="mgmt-panel-body">
            {/* Add MCP input */}
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                className="mgmt-input"
                style={{ flex: 1 }}
                value={mcpInput}
                onChange={event => setMcpInput(event.target.value)}
                placeholder="mcp id (e.g. github)"
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addMcp();
                  }
                }}
              />
              <button
                type="button"
                className="mgmt-pill-btn mgmt-pill-btn-primary"
                onClick={addMcp}
                disabled={!mcpInput.trim()}
              >
                <Plus size={13} />
                Add
              </button>
            </div>

            {/* Configured MCP list */}
            {configuredMcps.length === 0 && <div className="mgmt-empty">No MCP servers configured yet.</div>}
            {configuredMcps.map(mcp => {
              const runtime = runtimeMcpById.get(mcp);
              const status = runtime?.status ?? "unknown";
              return (
                <div key={mcp} className="mgmt-card">
                  <div className="mgmt-card-header">
                    <div className="mgmt-card-title">
                      <span className={`mgmt-dot ${status === "connected" ? "mgmt-dot-on" : "mgmt-dot-off"}`} />
                      <span>{mcp}</span>
                    </div>
                    <span className={`mgmt-badge ${mgmtBadgeClass(mcpStatusVariant(status))}`}>
                      {mcpStatusLabel(status)}
                    </span>
                  </div>
                  {runtime?.error && (
                    <p style={{ margin: "4px 0 0", fontSize: 11, color: "var(--text-weaker)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {runtime.error}
                    </p>
                  )}
                  <div className="mgmt-actions" style={{ marginTop: 6 }}>
                    <button
                      type="button"
                      className="mgmt-pill-btn"
                      onClick={() => void runMcpRuntimeAction(mcp, "connect")}
                      disabled={mcpActionBusyId.length > 0}
                      style={{ fontSize: 11, height: 26, padding: "0 10px" }}
                    >
                      Connect
                    </button>
                    <button
                      type="button"
                      className="mgmt-pill-btn"
                      onClick={() => requestDisconnectMcp(mcp)}
                      disabled={mcpActionBusyId.length > 0}
                      style={{ fontSize: 11, height: 26, padding: "0 10px" }}
                    >
                      Disconnect
                    </button>
                    <button
                      type="button"
                      className="mgmt-pill-btn"
                      onClick={() => void runMcpRuntimeAction(mcp, "authStart")}
                      disabled={mcpActionBusyId.length > 0}
                      style={{ fontSize: 11, height: 26, padding: "0 10px" }}
                    >
                      Auth
                    </button>
                    <button
                      type="button"
                      className="mgmt-pill-btn"
                      onClick={() => void runMcpRuntimeAction(mcp, "authRemove")}
                      disabled={mcpActionBusyId.length > 0}
                      style={{ fontSize: 11, height: 26, padding: "0 10px" }}
                    >
                      Reset Auth
                    </button>
                    <button
                      type="button"
                      className="mgmt-pill-btn mgmt-pill-btn-danger mgmt-pill-btn-ghost"
                      onClick={() => requestRemoveMcp(mcp)}
                      style={{ height: 26, padding: "0 8px" }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Discoverable MCPs */}
            {discoverableMcps.length > 0 && (
              <div className="mgmt-section">
                <span className="mgmt-form-label">Detected in runtime</span>
                {discoverableMcps.map(mcp => (
                  <div key={mcp.id} className="mgmt-card">
                    <div className="mgmt-card-header">
                      <div className="mgmt-card-title">
                        <span>{mcp.id}</span>
                        <span className={`mgmt-badge ${mgmtBadgeClass(mcpStatusVariant(mcp.status))}`}>
                          {mcpStatusLabel(mcp.status)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="mgmt-pill-btn"
                        style={{ fontSize: 11, height: 26, padding: "0 10px" }}
                        onClick={() => {
                          setMcpsDraft([...configuredMcps, mcp.id].join("\n"));
                          if (!mcpServerIdSet.has(mcp.id)) {
                            setMcpServers(current => [
                              ...current,
                              {
                                id: mcp.id,
                                type: "remote",
                                enabled: true,
                                url: "http://127.0.0.1:8000/mcp",
                                headers: {},
                                oauth: "auto",
                              },
                            ]);
                          }
                        }}
                      >
                        Enable
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="mgmt-actions mgmt-actions-end" style={{ paddingTop: 4 }}>
              <button type="button" className="mgmt-pill-btn" onClick={() => void refreshMcpCatalog()} disabled={loadingMcpCatalog}>
                {loadingMcpCatalog ? "Refreshing..." : "Refresh"}
              </button>
              <button type="button" className="mgmt-pill-btn mgmt-pill-btn-primary" onClick={() => void saveMcpsConfig()} disabled={isSavingMcps}>
                {isSavingMcps ? "Saving..." : "Save MCPs"}
              </button>
            </div>
            {mcpCatalogError && <div className="mgmt-error">{mcpCatalogError}</div>}
            {mcpsError && <div className="mgmt-error">{mcpsError}</div>}
            {mcpActionError && <div className="mgmt-error">{mcpActionError}</div>}
          </div>
        </div>

        {/* Right panel: server definitions */}
        <div className="mgmt-panel">
          <div className="mgmt-panel-header">
            <h3 className="mgmt-panel-title">Server Definitions</h3>
            <p className="mgmt-panel-desc">Configure remote/local MCP server details used by OpenCode.</p>
          </div>
          <div className="mgmt-panel-body">
            {normalizedMcpServers.length === 0 && (
              <div className="mgmt-empty">No MCP server definitions yet. Add one from the panel on the left.</div>
            )}
            {normalizedMcpServers.map(server => (
              <div key={server.id} className="mgmt-section">
                {/* Server header */}
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0,1fr) 110px auto" }}>
                  <input
                    type="text"
                    className="mgmt-input"
                    value={server.id}
                    onChange={event => renameMcpServer(server.id, event.target.value)}
                    placeholder="mcp id"
                  />
                  <select
                    value={server.type}
                    onChange={event => setMcpServerType(server.id, event.target.value === "local" ? "local" : "remote")}
                    className="mgmt-select"
                  >
                    <option value="remote">remote</option>
                    <option value="local">local</option>
                  </select>
                  <label className="mgmt-checkbox-row" style={{ height: 36, paddingRight: 4 }}>
                    <input
                      type="checkbox"
                      checked={configuredMcpSet.has(server.id)}
                      onChange={event => {
                        if (event.target.checked) {
                          setMcpsDraft([...configuredMcps, server.id].join("\n"));
                        } else {
                          setMcpsDraft(configuredMcps.filter(value => value !== server.id).join("\n"));
                        }
                      }}
                    />
                    enabled
                  </label>
                </div>

                {/* Server config fields */}
                {server.type === "remote" ? (
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0,1fr) 130px 130px" }}>
                    <input
                      type="text"
                      className="mgmt-input"
                      value={server.url}
                      onChange={event =>
                        updateMcpServer(server.id, current =>
                          current.type === "remote" ? { ...current, url: event.target.value } : current,
                        )
                      }
                      placeholder="https://example.com/mcp"
                    />
                    <select
                      value={server.oauth}
                      onChange={event =>
                        updateMcpServer(server.id, current =>
                          current.type === "remote"
                            ? { ...current, oauth: event.target.value === "off" ? "off" : "auto" }
                            : current,
                        )
                      }
                      className="mgmt-select"
                    >
                      <option value="auto">oauth auto</option>
                      <option value="off">oauth off</option>
                    </select>
                    <input
                      type="text"
                      className="mgmt-input"
                      value={typeof server.timeoutMs === "number" ? String(server.timeoutMs) : ""}
                      onChange={event =>
                        updateMcpServer(server.id, current =>
                          current.type === "remote"
                            ? {
                                ...current,
                                timeoutMs: event.target.value.trim()
                                  ? Number.isFinite(Number(event.target.value))
                                    ? Number(event.target.value)
                                    : undefined
                                  : undefined,
                              }
                            : current,
                        )
                      }
                      placeholder="timeout ms"
                    />
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0,1fr) 130px" }}>
                    <input
                      type="text"
                      className="mgmt-input"
                      value={server.command.join(" ")}
                      onChange={event =>
                        updateMcpServer(server.id, current =>
                          current.type === "local"
                            ? {
                                ...current,
                                command: event.target.value
                                  .split(" ")
                                  .map(value => value.trim())
                                  .filter(Boolean),
                              }
                            : current,
                        )
                      }
                      placeholder="bun run mcp-server.ts"
                    />
                    <input
                      type="text"
                      className="mgmt-input"
                      value={typeof server.timeoutMs === "number" ? String(server.timeoutMs) : ""}
                      onChange={event =>
                        updateMcpServer(server.id, current =>
                          current.type === "local"
                            ? {
                                ...current,
                                timeoutMs: event.target.value.trim()
                                  ? Number.isFinite(Number(event.target.value))
                                    ? Number(event.target.value)
                                    : undefined
                                  : undefined,
                              }
                            : current,
                        )
                      }
                      placeholder="timeout ms"
                    />
                  </div>
                )}
              </div>
            ))}
            <p className="mgmt-count-note">
              {configuredMcps.length} enabled MCP server{configuredMcps.length === 1 ? "" : "s"} across{" "}
              {normalizedMcpServers.length} definition{normalizedMcpServers.length === 1 ? "" : "s"}.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
