import { ChevronsUpDown, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, RefObject, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/frontend/app/dashboardUtils";
import type { AgentTypeDefinition, ModelOption } from "@/types/dashboard";

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
    <section className="min-h-0 flex-1 overflow-hidden">
      <Card className="panel-noise flex h-full min-h-0 flex-col overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4" />
                Agent Type Management
              </CardTitle>
              <CardDescription>
                Edit OpenCode agent definitions directly. Changes are applied to OpenCode config immediately on save.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refreshAgentCatalog()}
                disabled={loadingAgentCatalog}
              >
                {loadingAgentCatalog ? "Refreshing..." : "Refresh"}
              </Button>
              <Button type="button" onClick={() => void saveAgentTypesConfig()} disabled={isSavingAgents}>
                {isSavingAgents ? "Saving..." : "Save agent types"}
              </Button>
            </div>
          </div>
          {agentsError && <p className="text-xs text-destructive">{agentsError}</p>}
          {agentCatalogError && <p className="text-xs text-destructive">{agentCatalogError}</p>}
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">OpenCode Agents</p>
              <p className="text-xs text-muted-foreground">Add, edit, or remove agent definitions managed in OpenCode.</p>
              {(opencodeConfigFilePath || opencodeDirectory) && (
                <div className="space-y-0.5 pt-1 text-xs text-muted-foreground">
                  {opencodeConfigFilePath && (
                    <p>
                      Saving to: <code>{opencodeConfigFilePath}</code>
                    </p>
                  )}
                  {opencodeDirectory && (
                    <p>
                      Bound directory: <code>{opencodeDirectory}</code>
                    </p>
                  )}
                  {opencodePersistenceMode && (
                    <p>
                      Mode: <code>{opencodePersistenceMode}</code>
                    </p>
                  )}
                </div>
              )}
            </div>
            <Button type="button" variant="outline" onClick={addAgentType}>
              <Plus className="size-4" />
              Create custom type
            </Button>
          </div>

          {agentTypes.length === 0 && (
            <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
              No OpenCode agent definitions found. Create one to get started.
            </p>
          )}
          {agentTypes.map(agentType => (
            <div key={agentType.id} className="space-y-3 rounded-lg border border-border bg-muted/60 p-3">
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate font-display text-sm">{agentType.name || agentType.id}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={() => requestRemoveAgent(agentType.id)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">ID</p>
                  <Input
                    id={`agent-type-${agentType.id}-id`}
                    value={agentType.id}
                    onChange={event => updateAgentTypeField(agentType.id, "id", event.target.value)}
                    placeholder="agent-id"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Name</p>
                  <Input
                    id={`agent-type-${agentType.id}-name`}
                    value={agentType.name ?? ""}
                    onChange={event => updateAgentTypeField(agentType.id, "name", event.target.value)}
                    placeholder="Agent name"
                  />
                </div>
              </div>

              <div className="grid gap-2 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <Input
                    id={`agent-type-${agentType.id}-description`}
                    value={agentType.description ?? ""}
                    onChange={event => updateAgentTypeField(agentType.id, "description", event.target.value)}
                    placeholder="When this agent should be used"
                  />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Model</p>
                  <div
                    className="relative"
                    ref={openAgentModelPickerId === agentType.id ? agentModelPickerRef : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setAgentModelQuery("");
                        setOpenAgentModelPickerId(current => (current === agentType.id ? null : agentType.id));
                      }}
                      className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-2 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring/70"
                      aria-expanded={openAgentModelPickerId === agentType.id}
                      aria-haspopup="listbox"
                    >
                      <span className="truncate">
                        {agentType.model
                          ? availableModels.find(model => model.id === agentType.model)?.label ?? agentType.model
                          : "Default runtime model"}
                      </span>
                      <ChevronsUpDown className="size-4 text-muted-foreground" />
                    </button>
                    {openAgentModelPickerId === agentType.id && (
                      <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card p-2 shadow-lg">
                        <Input
                          ref={agentModelSearchInputRef}
                          value={agentModelQuery}
                          onChange={event => setAgentModelQuery(event.target.value)}
                          onKeyDown={event => handleAgentModelSearchKeyDown(event, agentType.id)}
                          placeholder="Search model..."
                          className="h-8"
                        />
                        <div className="mt-2 max-h-64 overflow-y-auto" role="listbox">
                          <button
                            type="button"
                            onClick={() => selectAgentModelFromPicker(agentType.id, "")}
                            className={cn(
                              "w-full rounded-md px-2 py-1.5 text-left text-sm transition",
                              !agentType.model && agentFocusedModelIndex === 0 ? "bg-primary/10" : "hover:bg-muted",
                            )}
                          >
                            <p className="truncate">Default runtime model</p>
                          </button>
                          {filteredAgentModelOptions().length === 0 ? (
                            <p className="px-2 py-2 text-xs text-muted-foreground">No models match your search.</p>
                          ) : (
                            filteredAgentModelOptions().map((option, index) => (
                              <button
                                key={option.id}
                                type="button"
                                onClick={() => selectAgentModelFromPicker(agentType.id, option.id)}
                                className={cn(
                                  "w-full rounded-md px-2 py-1.5 text-left text-sm transition",
                                  index + 1 === agentFocusedModelIndex ? "bg-primary/10" : "hover:bg-muted",
                                )}
                                data-active={agentType.model === option.id}
                              >
                                <p className="truncate">{option.label}</p>
                                <p className="truncate text-xs text-muted-foreground">{option.id}</p>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Prompt</p>
                <Textarea
                  id={`agent-type-${agentType.id}-prompt`}
                  value={agentType.prompt ?? ""}
                  onChange={event => updateAgentTypeField(agentType.id, "prompt", event.target.value)}
                  placeholder="Instructions for this agent"
                  className="min-h-20 resize-y"
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="space-y-1">
                  <label htmlFor={`agent-type-${agentType.id}-mode`} className="text-xs text-muted-foreground">
                    Mode
                  </label>
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-muted-foreground" />
                    <select
                      id={`agent-type-${agentType.id}-mode`}
                      className="h-9 rounded-md border border-border bg-background px-2 text-sm"
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
                <div className="space-y-1">
                  <label htmlFor={`agent-type-${agentType.id}-enabled`} className="text-xs text-muted-foreground">
                    Enabled
                  </label>
                  <label
                    htmlFor={`agent-type-${agentType.id}-enabled`}
                    className="flex h-9 items-center gap-2 text-xs text-muted-foreground"
                  >
                    <input
                      id={`agent-type-${agentType.id}-enabled`}
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
          <div className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
            {agentTypes.length} OpenCode agent definition{agentTypes.length === 1 ? "" : "s"}.
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
