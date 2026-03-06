import type { RuntimeSkill, RuntimeSkillIssue } from "@agent-mockingbird/contracts/dashboard";
import { AlertTriangle, Plus, Trash2, Wrench } from "lucide-react";


interface SkillsPageProps {
  skillInput: string;
  setSkillInput: (value: string) => void;
  addSkill: () => void;
  loadingSkillCatalog: boolean;
  availableSkills: RuntimeSkill[];
  configuredSkillSet: Set<string>;
  disabledSkills: string[];
  invalidSkills: RuntimeSkillIssue[];
  skillsManagedPath: string;
  skillsDisabledPath: string;
  toggleSkillEnabled: (skillId: string) => void;
  configuredUnavailableSkills: string[];
  requestRemoveSkill: (skillId: string) => void;
  refreshSkillCatalog: () => Promise<void>;
  saveSkillsConfig: () => Promise<void>;
  isSavingSkills: boolean;
  skillCatalogError: string;
  skillsError: string;
  importSkillId: string;
  setImportSkillId: (value: string) => void;
  importSkillContent: string;
  setImportSkillContent: (value: string) => void;
  importSkill: () => Promise<void>;
  isImportingSkill: boolean;
  skillsDraft: string;
  setSkillsDraft: (value: string) => void;
  configuredSkills: string[];
}

export function SkillsPage(props: SkillsPageProps) {
  const {
    skillInput,
    setSkillInput,
    addSkill,
    loadingSkillCatalog,
    availableSkills,
    configuredSkillSet,
    disabledSkills,
    invalidSkills,
    skillsManagedPath,
    skillsDisabledPath,
    toggleSkillEnabled,
    configuredUnavailableSkills,
    requestRemoveSkill,
    refreshSkillCatalog,
    saveSkillsConfig,
    isSavingSkills,
    skillCatalogError,
    skillsError,
    importSkillId,
    setImportSkillId,
    importSkillContent,
    setImportSkillContent,
    importSkill,
    isImportingSkill,
    skillsDraft,
    setSkillsDraft,
    configuredSkills,
  } = props;

  return (
    <section className="mgmt-page">
      <div className="mgmt-page-header">
        <p className="mgmt-page-eyebrow">Configuration</p>
        <h2 className="mgmt-page-title">Skills</h2>
        <p className="mgmt-page-subtitle">Toggle which OpenCode skills are exposed to runtime sessions.</p>
      </div>

      <div className="mgmt-grid mgmt-grid-sidebar">
        {/* Left panel: skill list */}
        <div className="mgmt-panel">
          <div className="mgmt-panel-header">
            <div className="mgmt-panel-header-row">
              <h3 className="mgmt-panel-title">
                <Wrench size={14} />
                Skill Exposure
              </h3>
              <span className="mgmt-badge">{availableSkills.length} available</span>
            </div>
          </div>
          <div className="mgmt-panel-body">
            {/* Path info */}
            {(skillsManagedPath || skillsDisabledPath) && (
              <div className="mgmt-notice" style={{ fontSize: 11, fontFamily: "'Geist Mono', monospace" }}>
                {skillsManagedPath && <p style={{ margin: 0 }}>Enabled root: {skillsManagedPath}</p>}
                {skillsDisabledPath && <p style={{ margin: "2px 0 0" }}>Disabled root: {skillsDisabledPath}</p>}
              </div>
            )}

            {/* Add skill input */}
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                className="mgmt-input"
                style={{ flex: 1 }}
                value={skillInput}
                onChange={event => setSkillInput(event.target.value)}
                placeholder="skill id (e.g. btca-cli)"
                onKeyDown={event => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addSkill();
                  }
                }}
              />
              <button
                type="button"
                className="mgmt-pill-btn mgmt-pill-btn-primary"
                onClick={addSkill}
                disabled={!skillInput.trim()}
              >
                <Plus size={13} />
                Add
              </button>
            </div>

            {loadingSkillCatalog && <div className="mgmt-loading">Loading runtime skills...</div>}

            {/* Skill list */}
            {!loadingSkillCatalog && availableSkills.length === 0 && (
              <div className="mgmt-empty">No runtime skills discovered yet.</div>
            )}
            {availableSkills.map(skill => {
              const enabled = configuredSkillSet.has(skill.id);
              return (
                <div key={skill.id} className="mgmt-card" data-active={enabled}>
                  <div className="mgmt-card-header">
                    <div className="mgmt-card-title">
                      <span className={`mgmt-dot ${enabled ? "mgmt-dot-on" : "mgmt-dot-off"}`} />
                      <span>{skill.name}</span>
                    </div>
                    <button
                      type="button"
                      className={`mgmt-pill-btn ${enabled ? "mgmt-pill-btn-primary" : ""}`}
                      onClick={() => toggleSkillEnabled(skill.id)}
                      style={{ fontSize: 11, height: 26, padding: "0 10px" }}
                    >
                      {enabled ? "Enabled" : "Disabled"}
                    </button>
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-weak)", lineHeight: 1.4 }}>
                    {skill.description || "No description provided."}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--text-weaker)", fontFamily: "'Geist Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {skill.location}
                  </p>
                </div>
              );
            })}

            {/* Disabled skills */}
            {disabledSkills.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="mgmt-form-label">Disabled on disk</span>
                <div className="mgmt-notice" style={{ fontFamily: "'Geist Mono', monospace", fontSize: 11 }}>
                  {disabledSkills.join(", ")}
                </div>
              </div>
            )}

            {/* Invalid skills */}
            {invalidSkills.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="mgmt-form-label" style={{ color: "var(--surface-warning-strong)", display: "flex", alignItems: "center", gap: 6 }}>
                  <AlertTriangle size={12} />
                  Invalid Skills
                </span>
                {invalidSkills.map(issue => (
                  <div key={`${issue.id ?? "unknown"}:${issue.location}`} className="mgmt-warn-card">
                    <p className="mgmt-warn-card-title">{issue.id || "Unknown skill"}</p>
                    <p className="mgmt-warn-card-text">{issue.reason}</p>
                    <p className="mgmt-warn-card-text" style={{ fontFamily: "'Geist Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{issue.location}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Configured but unavailable */}
            {configuredUnavailableSkills.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="mgmt-form-label">Configured but unavailable</span>
                {configuredUnavailableSkills.map(skill => (
                  <div key={skill} className="mgmt-card">
                    <div className="mgmt-card-header">
                      <span style={{ fontSize: 13, color: "var(--text-base)" }}>{skill}</span>
                      <button
                        type="button"
                        className="mgmt-pill-btn mgmt-pill-btn-danger mgmt-pill-btn-ghost"
                        onClick={() => requestRemoveSkill(skill)}
                        style={{ height: 26, padding: "0 8px" }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="mgmt-actions mgmt-actions-end" style={{ paddingTop: 4 }}>
              <button type="button" className="mgmt-pill-btn" onClick={() => void refreshSkillCatalog()} disabled={loadingSkillCatalog}>
                {loadingSkillCatalog ? "Refreshing..." : "Refresh"}
              </button>
              <button type="button" className="mgmt-pill-btn mgmt-pill-btn-primary" onClick={() => void saveSkillsConfig()} disabled={isSavingSkills}>
                {isSavingSkills ? "Saving..." : "Save skills"}
              </button>
            </div>
            {skillCatalogError && <div className="mgmt-error">{skillCatalogError}</div>}
            {skillsError && <div className="mgmt-error">{skillsError}</div>}
          </div>
        </div>

        {/* Right panel: import + bulk editor */}
        <div className="mgmt-panel">
          <div className="mgmt-panel-header">
            <h3 className="mgmt-panel-title">Import + Bulk Editor</h3>
            <p className="mgmt-panel-desc">Import managed skills and keep a bulk editable allow-list.</p>
          </div>
          <div className="mgmt-panel-body">
            {/* Import section */}
            <div className="mgmt-section">
              <span className="mgmt-form-label">Import managed skill</span>
              <input
                type="text"
                className="mgmt-input"
                value={importSkillId}
                onChange={event => setImportSkillId(event.target.value)}
                placeholder="new skill id (e.g. my-skill)"
              />
              <textarea
                className="mgmt-textarea"
                value={importSkillContent}
                onChange={event => setImportSkillContent(event.target.value)}
                style={{ minHeight: 120 }}
                placeholder="Paste SKILL.md content"
              />
              <div className="mgmt-actions mgmt-actions-end">
                <button
                  type="button"
                  className="mgmt-pill-btn mgmt-pill-btn-primary"
                  onClick={() => void importSkill()}
                  disabled={isImportingSkill || !importSkillId.trim() || !importSkillContent.trim()}
                >
                  {isImportingSkill ? "Importing..." : "Import skill"}
                </button>
              </div>
            </div>

            {/* Bulk editor */}
            <textarea
              className="mgmt-textarea"
              value={skillsDraft}
              onChange={event => setSkillsDraft(event.target.value)}
              style={{ minHeight: 240 }}
              placeholder="One skill per line"
            />
            <p className="mgmt-count-note">
              {configuredSkills.length} configured skill{configuredSkills.length === 1 ? "" : "s"}.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
