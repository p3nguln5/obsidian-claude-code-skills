import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type PluginSettings, type Skill } from "./types";
import { discoverSkills } from "./skillDiscovery";
import { registerContextMenu } from "./contextMenu";
import { ClaudePanel, CLAUDE_PANEL_VIEW_TYPE } from "./claudePanel";
import { ClaudeSkillsSettingTab } from "./settings";

// ── Binary auto-detection ──────────────────────────────────────────────────────

/**
 * Checks a list of common install locations for the claude binary.
 * Returns the first path found that is executable, or empty string if none found.
 * Used only on first load when claudeBinPath has not been configured.
 */
function detectClaudeBinary(): string {
  const home = os.homedir();

  const candidates =
    process.platform === "win32"
      ? [
          path.join(home, "AppData", "Roaming", "npm", "claude.cmd"),
          path.join(home, "AppData", "Roaming", "npm", "claude"),
        ]
      : [
          path.join(home, ".local", "bin", "claude"),   // npm --prefix ~/.local (Linux)
          "/usr/local/bin/claude",                       // npm global standard
          "/usr/bin/claude",                             // system package
          path.join(home, ".npm-global", "bin", "claude"),
          "/opt/homebrew/bin/claude",                    // macOS Homebrew
          path.join(home, ".nvm", "current", "bin", "claude"), // nvm
        ];

  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      continue;
    }
  }
  return "";
}

// ── Plugin ─────────────────────────────────────────────────────────────────────

export default class ClaudeCodeSkillsPlugin extends Plugin {
  settings!: PluginSettings;
  skills: Skill[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();

    // Auto-detect the claude binary on first install
    if (!this.settings.claudeBinPath) {
      const detected = detectClaudeBinary();
      if (detected) {
        this.settings.claudeBinPath = detected;
        await this.saveSettings();
        new Notice(`Claude binary auto-detected at ${detected}`);
      } else {
        new Notice(
          "Claude binary not found. Set the path in plugin settings."
        );
      }
    }

    this.skills = discoverSkills();

    if (this.skills.length === 0) {
      new Notice("No skills found in ~/.claude/skills/");
    }

    // Register the side panel view
    this.registerView(
      CLAUDE_PANEL_VIEW_TYPE,
      (leaf) => new ClaudePanel(leaf, this)
    );

    // Context menu: right-click selected text → skill → open side panel
    // If enabledSkills is empty all skills are shown; otherwise filter to the enabled set.
    registerContextMenu(this, this.getEnabledSkills(), (skill, selectedText) => {
      void this.openPanel().then((panel) => panel.startConversation(skill, selectedText));
    });

    // Ribbon icon: opens the panel in freeform chat mode
    this.addRibbonIcon("bot", "Open skills panel", () => {
      void this.openPanel().then((panel) => panel.startFreeform());
    });

    // Command palette entry
    this.addCommand({
      id: "open-claude-panel",
      name: "Open panel",
      callback: () => {
        void this.openPanel().then((panel) => panel.startFreeform());
      },
    });

    this.addSettingTab(new ClaudeSkillsSettingTab(this.app, this));
  }

  onunload(): void {
    // Obsidian detaches all leaves registered via registerView automatically
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Returns the subset of discovered skills that are enabled in settings.
   * An empty enabledSkills list means all skills are enabled.
   */
  getEnabledSkills(): Skill[] {
    if (this.settings.enabledSkills.length === 0) return this.skills;
    return this.skills.filter((s) => this.settings.enabledSkills.includes(s.id));
  }

  /**
   * Opens the Claude side panel in the right sidebar.
   * Reuses the existing leaf if the panel is already open.
   */
  async openPanel(): Promise<ClaudePanel> {
    const { workspace } = this.app;

    // Reuse if already open
    const existing = workspace.getLeavesOfType(CLAUDE_PANEL_VIEW_TYPE);
    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      return existing[0].view as ClaudePanel;
    }

    // Open in right sidebar
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) {
      throw new Error("Claude Code Skills: could not open a sidebar panel");
    }
    await leaf.setViewState({ type: CLAUDE_PANEL_VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
    return leaf.view as ClaudePanel;
  }
}
