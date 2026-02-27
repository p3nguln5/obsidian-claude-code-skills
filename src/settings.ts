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
          .onChange((value) => {
            this.plugin.settings.claudeBinPath = value.trim();
            void this.plugin.saveSettings();
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
          .onChange((value) => {
            this.plugin.settings.workingDirectory = value.trim();
            void this.plugin.saveSettings();
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
          .onChange((value) => {
            const n = parseInt(value.trim(), 10);
            if (!isNaN(n) && n > 0) {
              this.plugin.settings.timeout = n;
              void this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Max budget per query")
      .setDesc(
        "Hard API spend cap per skill invocation. The subprocess is killed if this is exceeded. Set to 0 to disable."
      )
      .addText((text) =>
        text
          .setPlaceholder("0.25")
          .setValue(String(this.plugin.settings.maxBudgetUsd))
          .onChange((value) => {
            const n = parseFloat(value.trim());
            if (!isNaN(n) && n >= 0) {
              this.plugin.settings.maxBudgetUsd = n;
              void this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Output folder")
      .setDesc(
        "Folder inside your vault where 'Create note' saves results. " +
        "Created automatically if it does not exist. " +
        "Leave empty to save to the vault root."
      )
      .addText((text) =>
        text
          .setPlaceholder("Outputs")
          .setValue(this.plugin.settings.outputFolder)
          .onChange((value) => {
            this.plugin.settings.outputFolder = value.trim();
            void this.plugin.saveSettings();
          })
      );

    // ── Skills ──────────────────────────────────────────────────────────────
    new Setting(containerEl).setName("Skills").setHeading();

    const skills = this.plugin.skills;

    if (skills.length === 0) {
      containerEl.createEl("p", {
        text: "No skills found in ~/.claude/skills/. Add skill folders there and reload the plugin.",
        cls: "setting-item-description",
      });
    } else {
      containerEl.createEl("p", {
        text: "Toggle which skills appear in the editor context menu. All skills are enabled by default.",
        cls: "setting-item-description",
      });

      for (const skill of skills) {
        const isEnabled =
          this.plugin.settings.enabledSkills.length === 0 ||
          this.plugin.settings.enabledSkills.includes(skill.id);

        new Setting(containerEl)
          .setName(skill.name)
          .setDesc(skill.description || skill.id)
          .addToggle((toggle) =>
            toggle.setValue(isEnabled).onChange((value) => {
              const current = this.plugin.settings.enabledSkills;

              if (value) {
                // Enabling: if list is now all skills, clear it (means "all enabled")
                const next = current.filter((id) => id !== skill.id).concat(skill.id);
                this.plugin.settings.enabledSkills =
                  next.length === skills.length ? [] : next;
              } else {
                // Disabling: if list was empty (all enabled), seed it with everything except this one
                const base = current.length === 0
                  ? skills.map((s) => s.id)
                  : current;
                this.plugin.settings.enabledSkills = base.filter((id) => id !== skill.id);
              }

              void this.plugin.saveSettings();
            })
          );
      }
    }
  }
}
