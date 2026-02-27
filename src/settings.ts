import { App, PluginSettingTab, Setting } from "obsidian";
import type ClaudeCodeSkillsPlugin from "./main";

export class ClaudeSkillsSettingTab extends PluginSettingTab {
  plugin: ClaudeCodeSkillsPlugin;

  constructor(app: App, plugin: ClaudeCodeSkillsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Claude Code Skills" });

    new Setting(containerEl)
      .setName("Claude binary path")
      .setDesc(
        "Full path to the claude CLI binary. Run 'which claude' in a terminal to find it. " +
        "Auto-detected on first load if left empty."
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g. /usr/local/bin/claude")
          .setValue(this.plugin.settings.claudeBinPath)
          .onChange(async (value) => {
            this.plugin.settings.claudeBinPath = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Working directory")
      .setDesc(
        "Directory passed as cwd to the claude subprocess. Must contain a CLAUDE.md file " +
        "for project context to load. Skills use this path to resolve !`cmd` expansions."
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g. /home/user/Documents/ClaudeCode")
          .setValue(this.plugin.settings.workingDirectory)
          .onChange(async (value) => {
            this.plugin.settings.workingDirectory = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Timeout (ms)")
      .setDesc(
        "Maximum milliseconds to wait for a response before killing the subprocess."
      )
      .addText((text) =>
        text
          .setPlaceholder("120000")
          .setValue(String(this.plugin.settings.timeout))
          .onChange(async (value) => {
            const n = parseInt(value.trim(), 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.timeout = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Max budget per query (USD)")
      .setDesc(
        "Hard API spend cap per skill invocation. The subprocess is killed if this is exceeded. Set to 0 to disable."
      )
      .addText((text) =>
        text
          .setPlaceholder("0.25")
          .setValue(String(this.plugin.settings.maxBudgetUsd))
          .onChange(async (value) => {
            const n = parseFloat(value.trim());
            if (!isNaN(n) && n >= 0) {
              this.plugin.settings.maxBudgetUsd = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc(
        "Folder name inside your vault where 'Create Note' saves results. " +
        "Just enter the folder name — e.g. Claude Outputs. " +
        "The folder is created automatically if it does not exist. " +
        "Leave empty to save to the vault root."
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g. Claude Outputs")
          .setValue(this.plugin.settings.outputFolder)
          .onChange(async (value) => {
            this.plugin.settings.outputFolder = value.trim();
            await this.plugin.saveSettings();
          })
      );
  }
}
