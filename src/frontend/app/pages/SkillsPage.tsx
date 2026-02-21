import { Plus, SlidersHorizontal, Trash2, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RuntimeSkill } from "@/types/dashboard";

interface SkillsPageProps {
  skillInput: string;
  setSkillInput: (value: string) => void;
  addSkill: () => void;
  loadingSkillCatalog: boolean;
  availableSkills: RuntimeSkill[];
  configuredSkillSet: Set<string>;
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
    <section className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
      <Card className="panel-noise flex min-h-0 flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="size-4" />
            Skill Exposure
          </CardTitle>
          <CardDescription>Toggle which OpenCode skills are exposed to runtime sessions.</CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <div className="flex gap-2">
            <Input
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
            <Button type="button" onClick={addSkill} disabled={!skillInput.trim()}>
              <Plus className="size-4" />
              Add
            </Button>
          </div>

          {loadingSkillCatalog && (
            <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
              Loading runtime skills...
            </p>
          )}

          <div className="space-y-2">
            {!loadingSkillCatalog && availableSkills.length === 0 && (
              <p className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
                No runtime skills discovered yet.
              </p>
            )}
            {availableSkills.map(skill => {
              const enabled = configuredSkillSet.has(skill.id);
              return (
                <div key={skill.id} className="space-y-1 rounded-md border border-border bg-muted/70 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{skill.name}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant={enabled ? "default" : "outline"}
                      onClick={() => toggleSkillEnabled(skill.id)}
                    >
                      {enabled ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{skill.description || "No description provided."}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{skill.location}</p>
                </div>
              );
            })}
          </div>

          {configuredUnavailableSkills.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Configured but unavailable</p>
              {configuredUnavailableSkills.map(skill => (
                <div
                  key={skill}
                  className="flex items-center justify-between rounded-md border border-border bg-muted/70 px-3 py-2"
                >
                  <span className="text-sm">{skill}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => requestRemoveSkill(skill)}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => void refreshSkillCatalog()} disabled={loadingSkillCatalog}>
              {loadingSkillCatalog ? "Refreshing..." : "Refresh"}
            </Button>
            <Button type="button" onClick={() => void saveSkillsConfig()} disabled={isSavingSkills}>
              {isSavingSkills ? "Saving..." : "Save skills"}
            </Button>
          </div>
          {skillCatalogError && <p className="text-xs text-destructive">{skillCatalogError}</p>}
          {skillsError && <p className="text-xs text-destructive">{skillsError}</p>}
        </CardContent>
      </Card>

      <Card className="panel-noise flex min-h-0 flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-4" />
            Import + Bulk Editor
          </CardTitle>
          <CardDescription>Import managed skills and keep a bulk editable allow-list.</CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 space-y-3 overflow-y-auto">
          <div className="space-y-2 rounded-md border border-border bg-muted/70 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Import managed skill</p>
            <Input
              value={importSkillId}
              onChange={event => setImportSkillId(event.target.value)}
              placeholder="new skill id (e.g. my-skill)"
            />
            <Textarea
              value={importSkillContent}
              onChange={event => setImportSkillContent(event.target.value)}
              className="min-h-28 resize-y"
              placeholder="Paste SKILL.md content"
            />
            <div className="flex items-center justify-end">
              <Button
                type="button"
                onClick={() => void importSkill()}
                disabled={isImportingSkill || !importSkillId.trim() || !importSkillContent.trim()}
              >
                {isImportingSkill ? "Importing..." : "Import skill"}
              </Button>
            </div>
          </div>

          <Textarea
            value={skillsDraft}
            onChange={event => setSkillsDraft(event.target.value)}
            className="min-h-64 resize-y"
            placeholder="One skill per line"
          />
          <div className="rounded-md border border-border bg-muted/70 p-3 text-xs text-muted-foreground">
            {configuredSkills.length} configured skill{configuredSkills.length === 1 ? "" : "s"}.
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
