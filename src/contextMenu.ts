import type { Plugin } from "obsidian";
import type { Skill } from "./types";

export function registerContextMenu(
  plugin: Plugin,
  skills: Skill[],
  onSkillSelect: (skill: Skill, selectedText: string) => void
): void {
  plugin.registerEvent(
    plugin.app.workspace.on("editor-menu", (menu, editor) => {
      const selected = editor.getSelection();
      if (!selected || selected.trim().length === 0) return;
      if (skills.length === 0) return;

      menu.addSeparator();

      for (const skill of skills) {
        menu.addItem((item) =>
          item
            .setTitle(`Claude: ${skill.name}`)
            .setSection("claude")
            .onClick(() => onSkillSelect(skill, selected))
        );
      }
    })
  );
}
