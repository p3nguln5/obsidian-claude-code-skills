export interface Skill {
  id: string;          // directory name: "yara-and-sigma"
  name: string;        // YAML frontmatter: name field
  description: string; // YAML frontmatter: description field
}

export interface PluginSettings {
  claudeBinPath: string;    // path to claude CLI binary
  workingDirectory: string; // cwd for subprocess (must contain CLAUDE.md)
  timeout: number;          // ms before killing subprocess
  maxBudgetUsd: number;     // per-query API spend cap in USD (0 = no cap)
  outputFolder: string;     // vault-relative folder for created notes (empty = vault root)
  enabledSkills: string[];  // skill IDs that appear in the context menu (empty = all enabled)
}

export const DEFAULT_SETTINGS: PluginSettings = {
  claudeBinPath: "",        // auto-detected on first load; enter manually if needed
  workingDirectory: "",     // must be configured — directory containing CLAUDE.md
  timeout: 120000,
  maxBudgetUsd: 0.25,
  outputFolder: "",         // empty = vault root
  enabledSkills: [],        // empty = all skills enabled
};
