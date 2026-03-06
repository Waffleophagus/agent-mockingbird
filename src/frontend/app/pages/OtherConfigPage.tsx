import { ChevronsUpDown, RefreshCcw, Save, Settings2, Trash2 } from "lucide-react";
import type { Dispatch, KeyboardEvent as ReactKeyboardEvent, RefObject, SetStateAction } from "react";

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
    <section className="mgmt-page">
      <div className="mgmt-page-header">
        <p className="mgmt-page-eyebrow">Configuration</p>
        <h2 className="mgmt-page-title">Other Config</h2>
        <p className="mgmt-page-subtitle">Runtime fallback order for OpenCode model selection.</p>
      </div>

      <div className="mgmt-panel" style={{ flex: 1 }}>
        <div className="mgmt-panel-header">
          <div className="mgmt-panel-header-row">
            <h3 className="mgmt-panel-title">
              <Settings2 size={14} />
              Runtime Config
            </h3>
            <div className="mgmt-actions">
              <button type="button" className="mgmt-pill-btn" onClick={() => void refreshOtherConfig()} disabled={loadingOtherConfig}>
                <RefreshCcw size={12} />
                {loadingOtherConfig ? "Refreshing..." : "Refresh"}
              </button>
              <button type="button" className="mgmt-pill-btn mgmt-pill-btn-primary" onClick={() => void saveOtherConfig()} disabled={isSavingOtherConfig}>
                <Save size={12} />
                {isSavingOtherConfig ? "Saving..." : "Save config"}
              </button>
            </div>
          </div>
          {otherConfigError && <div className="mgmt-error" style={{ marginTop: 8 }}>{otherConfigError}</div>}
        </div>
        <div className="mgmt-panel-body">
          {/* Fallback models info */}
          <div className="mgmt-section">
            <div className="mgmt-card-header">
              <div>
                <h4 className="mgmt-section-title">Fallback Models</h4>
                <p className="mgmt-section-desc">Tried in order after the selected model fails. No heuristic substitution is used.</p>
              </div>
              <button type="button" className="mgmt-pill-btn" onClick={addFallbackModel}>
                Add fallback
              </button>
            </div>
          </div>

          {/* Image model */}
          <div className="mgmt-section">
            <div>
              <h4 className="mgmt-section-title">Image Model</h4>
              <p className="mgmt-section-desc">Used when an incoming request has images and the active session model does not support image input.</p>
            </div>
            <select
              value={runtimeImageModel}
              onChange={event => setRuntimeImageModel(event.target.value)}
              className="mgmt-select"
              style={{ width: "100%" }}
            >
              <option value="">(Auto) first fallback or small model</option>
              {availableFallbackModels.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Fallback model list */}
          {runtimeFallbackModels.length === 0 && (
            <div className="mgmt-empty">No configured fallback models.</div>
          )}

          {runtimeFallbackModels.map((fallbackModel, index) => (
            <div key={`${fallbackModel}-${index}`} className="mgmt-section">
              <div className="mgmt-card-header">
                <span className="mgmt-form-label">Fallback #{index + 1}</span>
                <button
                  type="button"
                  className="mgmt-pill-btn mgmt-pill-btn-danger mgmt-pill-btn-ghost"
                  onClick={() => removeFallbackModel(index)}
                  style={{ height: 26, padding: "0 8px" }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <div style={{ position: "relative" }} ref={openFallbackModelPickerIndex === index ? fallbackModelPickerRef : undefined}>
                <button
                  type="button"
                  onClick={() => {
                    setFallbackModelQuery("");
                    setOpenFallbackModelPickerIndex(current => (current === index ? null : index));
                  }}
                  className="mgmt-model-trigger"
                  aria-expanded={openFallbackModelPickerIndex === index}
                  aria-haspopup="listbox"
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {availableFallbackModels.find(model => model.id === fallbackModel)?.label ?? fallbackModel}
                  </span>
                  <ChevronsUpDown size={14} style={{ color: "var(--text-weaker)", flexShrink: 0 }} />
                </button>
                {openFallbackModelPickerIndex === index && (
                  <div className="mgmt-model-picker-dropdown">
                    <input
                      ref={fallbackModelSearchInputRef}
                      type="text"
                      className="mgmt-input"
                      value={fallbackModelQuery}
                      onChange={event => setFallbackModelQuery(event.target.value)}
                      onKeyDown={event => handleFallbackModelSearchKeyDown(event, index)}
                      placeholder="Search model..."
                      style={{ height: 32, fontSize: 12 }}
                    />
                    <div style={{ marginTop: 6, maxHeight: 240, overflowY: "auto" }} role="listbox">
                      {filteredFallbackModelOptions().length === 0 ? (
                        <p style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-weaker)" }}>No models match your search.</p>
                      ) : (
                        filteredFallbackModelOptions().map((option, optionIndex) => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => selectFallbackModelFromPicker(index, option.id)}
                            className="mgmt-model-option"
                            data-focused={optionIndex === fallbackFocusedModelIndex}
                            data-active={fallbackModel === option.id}
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
          ))}
        </div>
      </div>
    </section>
  );
}
