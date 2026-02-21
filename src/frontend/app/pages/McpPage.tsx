import { Cpu, Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
    <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="panel-noise flex min-h-0 flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Cpu className="size-4" />
            MCP Management
          </CardTitle>
          <CardDescription>Manage MCP allow-list and verify runtime status from OpenCode.</CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 space-y-3 overflow-y-auto">
          <div className="flex gap-2">
            <Input
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
            <Button type="button" onClick={addMcp} disabled={!mcpInput.trim()}>
              <Plus className="size-4" />
              Add
            </Button>
          </div>

          <div className="space-y-2">
            {configuredMcps.length === 0 && (
              <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                No MCP servers configured yet.
              </p>
            )}
            {configuredMcps.map(mcp => (
              <div
                key={mcp}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/70 px-3 py-2"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm">{mcp}</p>
                  <div className="flex items-center gap-2">
                    <Badge variant={mcpStatusVariant(runtimeMcpById.get(mcp)?.status ?? "unknown")}>
                      {mcpStatusLabel(runtimeMcpById.get(mcp)?.status ?? "unknown")}
                    </Badge>
                    {runtimeMcpById.get(mcp)?.error && (
                      <p className="truncate text-xs text-muted-foreground">{runtimeMcpById.get(mcp)?.error}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void runMcpRuntimeAction(mcp, "connect")}
                    disabled={mcpActionBusyId.length > 0}
                  >
                    Connect
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => requestDisconnectMcp(mcp)}
                    disabled={mcpActionBusyId.length > 0}
                  >
                    Disconnect
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void runMcpRuntimeAction(mcp, "authStart")}
                    disabled={mcpActionBusyId.length > 0}
                  >
                    Auth
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void runMcpRuntimeAction(mcp, "authRemove")}
                    disabled={mcpActionBusyId.length > 0}
                  >
                    Reset Auth
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => requestRemoveMcp(mcp)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {discoverableMcps.length > 0 && (
            <div className="space-y-2 rounded-md border border-border bg-muted/60 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Detected in runtime</p>
              <div className="space-y-2">
                {discoverableMcps.map(mcp => (
                  <div key={mcp.id} className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{mcp.id}</p>
                      <Badge variant={mcpStatusVariant(mcp.status)}>{mcpStatusLabel(mcp.status)}</Badge>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
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
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => void refreshMcpCatalog()} disabled={loadingMcpCatalog}>
              {loadingMcpCatalog ? "Refreshing..." : "Refresh"}
            </Button>
            <Button type="button" onClick={() => void saveMcpsConfig()} disabled={isSavingMcps}>
              {isSavingMcps ? "Saving..." : "Save MCPs"}
            </Button>
          </div>
          {mcpCatalogError && <p className="text-xs text-destructive">{mcpCatalogError}</p>}
          {mcpsError && <p className="text-xs text-destructive">{mcpsError}</p>}
          {mcpActionError && <p className="text-xs text-destructive">{mcpActionError}</p>}
        </CardContent>
      </Card>

      <Card className="panel-noise flex min-h-0 flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" />
            Server Definitions
          </CardTitle>
          <CardDescription>Configure remote/local MCP server details used by OpenCode.</CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 space-y-3 overflow-y-auto">
          {normalizedMcpServers.length === 0 && (
            <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
              No MCP server definitions yet. Add one from the panel on the left.
            </p>
          )}
          {normalizedMcpServers.map(server => (
            <div key={server.id} className="space-y-2 rounded-md border border-border bg-muted/60 p-3">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_120px_96px]">
                <Input value={server.id} onChange={event => renameMcpServer(server.id, event.target.value)} placeholder="mcp id" />
                <select
                  value={server.type}
                  onChange={event => setMcpServerType(server.id, event.target.value === "local" ? "local" : "remote")}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="remote">remote</option>
                  <option value="local">local</option>
                </select>
                <label className="flex items-center gap-2 rounded-md border border-input px-3 text-sm">
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
              {server.type === "remote" ? (
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px_140px]">
                  <Input
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
                    className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="auto">oauth auto</option>
                    <option value="off">oauth off</option>
                  </select>
                  <Input
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
                <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px]">
                  <Input
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
                  <Input
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
          <div className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
            {configuredMcps.length} enabled MCP server{configuredMcps.length === 1 ? "" : "s"} across {normalizedMcpServers.length} definition
            {normalizedMcpServers.length === 1 ? "" : "s"}.
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
