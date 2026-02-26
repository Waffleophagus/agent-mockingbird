import { ChevronsUpDown, RefreshCcw, Save, Settings2, Trash2 } from "lucide-react";
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, RefObject, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/frontend/app/dashboardUtils";
import type { ModelOption } from "@/types/dashboard";

interface OtherConfigPageProps {
  refreshOtherConfig: () => Promise<void>;
  loadingOtherConfig: boolean;
  saveOtherConfig: () => Promise<void>;
  isSavingOtherConfig: boolean;
  otherConfigError: string;
  runtimeFallbackModels: string[];
  availableFallbackModels: ModelOption[];
  addFallbackModel: () => void;
  removeFallbackModel: (index: number) => void;
  openFallbackModelPickerIndex: number | null;
  setOpenFallbackModelPickerIndex: Dispatch<SetStateAction<number | null>>;
  setFallbackModelQuery: (value: string) => void;
  fallbackModelPickerRef: RefObject<HTMLDivElement | null>;
  fallbackModelSearchInputRef: RefObject<HTMLInputElement | null>;
  fallbackModelQuery: string;
  handleFallbackModelSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>, index: number) => void;
  selectFallbackModelFromPicker: (index: number, model: string) => void;
  filteredFallbackModelOptions: () => ModelOption[];
  fallbackFocusedModelIndex: number;
  runtimeImageModel: string;
  setRuntimeImageModel: (value: string) => void;
}

export function OtherConfigPage(props: OtherConfigPageProps) {
  const {
    refreshOtherConfig,
    loadingOtherConfig,
    saveOtherConfig,
    isSavingOtherConfig,
    otherConfigError,
    runtimeFallbackModels,
    availableFallbackModels,
    addFallbackModel,
    removeFallbackModel,
    openFallbackModelPickerIndex,
    setOpenFallbackModelPickerIndex,
    setFallbackModelQuery,
    fallbackModelPickerRef,
    fallbackModelSearchInputRef,
    fallbackModelQuery,
    handleFallbackModelSearchKeyDown,
    selectFallbackModelFromPicker,
    filteredFallbackModelOptions,
    fallbackFocusedModelIndex,
    runtimeImageModel,
    setRuntimeImageModel,
  } = props;

  return (
    <section className="min-h-0 flex-1 overflow-hidden">
      <Card className="panel-noise flex h-full min-h-0 flex-col overflow-hidden">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings2 className="size-4" />
                Other Config
              </CardTitle>
              <CardDescription>Runtime fallback order for OpenCode model selection.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refreshOtherConfig()}
                disabled={loadingOtherConfig}
              >
                <RefreshCcw className="size-4" />
                {loadingOtherConfig ? "Refreshing..." : "Refresh"}
              </Button>
              <Button type="button" size="sm" onClick={() => void saveOtherConfig()} disabled={isSavingOtherConfig}>
                <Save className="size-4" />
                {isSavingOtherConfig ? "Saving..." : "Save other config"}
              </Button>
            </div>
          </div>
          {otherConfigError && <p className="text-xs text-destructive">{otherConfigError}</p>}
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 p-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Fallback Models</p>
              <p className="text-xs text-muted-foreground">
                Tried in order after the selected model fails. No heuristic substitution is used.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addFallbackModel}>
              Add fallback
            </Button>
          </div>

          <div className="space-y-2 rounded-lg border border-border bg-muted/60 p-3">
            <p className="text-xs font-medium text-muted-foreground">Image Model</p>
            <p className="text-xs text-muted-foreground">
              Used when an incoming request has images and the active session model does not support image input.
            </p>
            <div className="relative">
              <select
                value={runtimeImageModel}
                onChange={event => setRuntimeImageModel(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring/70"
              >
                <option value="">(Auto) first fallback or small model</option>
                {availableFallbackModels.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {runtimeFallbackModels.length === 0 && (
            <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
              No configured fallback models.
            </p>
          )}

          {runtimeFallbackModels.map((fallbackModel, index) => (
            <div key={`${fallbackModel}-${index}`} className="space-y-2 rounded-lg border border-border bg-muted/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">Fallback #{index + 1}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 w-8 p-0"
                  onClick={() => removeFallbackModel(index)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
              <div className="relative" ref={openFallbackModelPickerIndex === index ? fallbackModelPickerRef : undefined}>
                <button
                  type="button"
                  onClick={() => {
                    setFallbackModelQuery("");
                    setOpenFallbackModelPickerIndex(current => (current === index ? null : index));
                  }}
                  className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-2 text-left text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-ring/70"
                  aria-expanded={openFallbackModelPickerIndex === index}
                  aria-haspopup="listbox"
                >
                  <span className="truncate">
                    {availableFallbackModels.find(model => model.id === fallbackModel)?.label ?? fallbackModel}
                  </span>
                  <ChevronsUpDown className="size-4 text-muted-foreground" />
                </button>
                {openFallbackModelPickerIndex === index && (
                  <div className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card p-2 shadow-lg">
                    <Input
                      ref={fallbackModelSearchInputRef}
                      value={fallbackModelQuery}
                      onChange={event => setFallbackModelQuery(event.target.value)}
                      onKeyDown={event => handleFallbackModelSearchKeyDown(event, index)}
                      placeholder="Search model..."
                      className="h-8"
                    />
                    <div className="mt-2 max-h-64 overflow-y-auto" role="listbox">
                      {filteredFallbackModelOptions().length === 0 ? (
                        <p className="px-2 py-2 text-xs text-muted-foreground">No models match your search.</p>
                      ) : (
                        filteredFallbackModelOptions().map((option, optionIndex) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => selectFallbackModelFromPicker(index, option.id)}
                            className={cn(
                              "w-full rounded-md px-2 py-1.5 text-left text-sm transition",
                              optionIndex === fallbackFocusedModelIndex ? "bg-primary/10" : "hover:bg-muted",
                            )}
                            data-active={fallbackModel === option.id}
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
          ))}
        </CardContent>
      </Card>
    </section>
  );
}
