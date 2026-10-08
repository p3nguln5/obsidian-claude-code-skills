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

    // Attach the current selection without reaching for the mouse
    this.addCommand({
      id: "attach-selection-to-panel",
      name: "Attach selection to Claude panel",
      callback: () => void this.attachSelectionToPanel(),
    });

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!editor.getSelection().trim()) return;
        menu.addItem((item) =>
          item
            .setTitle("Attach selection to Claude panel")
            .setIcon("bot")
            .onClick(() => void this.attachSelectionToPanel())
        );
      })
    );

    this.enableSelectionDrag();
    this.addSettingTab(new ClaudeSkillsSettingTab(this.app, this));
  }

  private sourceName(): string {
    const f = this.app.workspace.getActiveFile();
    return f ? f.basename : "note";
  }

  async attachSelectionToPanel(): Promise<void> {
    const active = this.app.workspace.activeEditor;
    let sel = active?.editor ? active.editor.getSelection() : "";
    if (!sel.trim()) sel = activeWindow.getSelection()?.toString() ?? "";
    if (!sel.trim()) {
      new Notice("Select something first");
      return;
    }
    const panel = await this.openPanel();
    panel.attachText(sel.replace(/\s+$/, ""), this.sourceName());
  }

  /**
   * Lets a selection be dragged into the panel.
   *
   * Both the editor and the reading view answer a mousedown by starting a
   * fresh selection, so a selection could never be picked up: the press that
   * should begin a drag wipes it instead. Rather than fight them for the
   * browser's own drag, this holds the mousedown back when it lands inside an
   * existing selection and runs the drag itself - a small label follows the
   * cursor, and releasing over the panel attaches the text. A press that never
   * moves just places the caret, as it would have done.
   */
  private enableSelectionDrag(): void {
    const doc = activeDocument;
    let pending: { x: number; y: number; text: string; source: string } | null = null;
    let ghost: HTMLElement | null = null;
    let dragging = false;

    const panel = () => {
      const leaves = this.app.workspace.getLeavesOfType(CLAUDE_PANEL_VIEW_TYPE);
      return leaves.length ? (leaves[0].view as unknown as ClaudePanel) : null;
    };
    const overPanel = (x: number, y: number): boolean => {
      const view = panel();
      if (!view?.containerEl) return false;
      const r = view.containerEl.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    const paint = (on: boolean) => {
      const view = panel();
      if (!view?.contentEl) return;
      if (on) view.contentEl.addClass("claude-drop-active");
      else view.contentEl.removeClass("claude-drop-active");
    };
    const cleanup = () => {
      ghost?.remove();
      ghost = null;
      paint(false);
      pending = null;
      dragging = false;
    };

    this.registerDomEvent(doc, "mousedown", (e: MouseEvent) => {
      cleanup();
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      if (!(e.target instanceof Element)) return;
      // Answers in the panel are rendered markdown too, and they carry the same
      // class. Leave the panel alone: text in it must stay selectable so it can
      // be copied, and there is nowhere to drag it to anyway.
      if (e.target.closest(".claude-panel-root")) return;
      // Only the note itself: the editor, or the reading view. Not
      // .markdown-rendered, which every plugin that renders Markdown uses for
      // its own panels - HiNote's comments and highlights among them.
      const host = e.target.closest(".cm-content, .markdown-preview-view");
      if (!host) return;

      const sel = doc.defaultView?.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const text = sel.toString();
      if (!text.trim()) return;

      // Only when the press is actually on the selected text
      let hit = false;
      const rects = sel.getRangeAt(0).getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (
          e.clientX >= r.left - 2 && e.clientX <= r.right + 2 &&
          e.clientY >= r.top - 1 && e.clientY <= r.bottom + 1
        ) {
          hit = true;
          break;
        }
      }
      if (!hit) return;

      pending = { x: e.clientX, y: e.clientY, text, source: this.sourceName() };
      e.preventDefault();
      e.stopPropagation();
    }, true);

    this.registerDomEvent(doc, "mousemove", (e: MouseEvent) => {
      if (!pending) return;
      if (!dragging) {
        if (Math.abs(e.clientX - pending.x) + Math.abs(e.clientY - pending.y) < 5) return;
        dragging = true;
        ghost = doc.body.createDiv({ cls: "claude-drag-ghost" });
        const t = pending.text.trim();
        ghost.setText(t.slice(0, 50) + (t.length > 50 ? "…" : ""));
      }
      ghost!.style.left = e.clientX + 14 + "px";
      ghost!.style.top = e.clientY + 14 + "px";
      const on = overPanel(e.clientX, e.clientY);
      ghost!.toggleClass("is-over", on);
      paint(on);
      e.preventDefault();
    }, true);

    this.registerDomEvent(doc, "mouseup", (e: MouseEvent) => {
      if (!pending) return;
      const held = pending;
      const moved = dragging;
      const onPanel = overPanel(e.clientX, e.clientY);
      cleanup();

      if (moved && onPanel) {
        void this.openPanel().then((p) =>
          p.attachText(held.text.replace(/\s+$/, ""), held.source)
        );
        return;
      }
      if (!moved) {
        const range = doc.caretRangeFromPoint(e.clientX, e.clientY);
        const sel = doc.defaultView?.getSelection();
        if (range && sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }, true);
  }

  onunload(): void {
    // Obsidian detaches all leaves registered via registerView automatically
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    ) as PluginSettings;
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
      return existing[0].view as unknown as ClaudePanel;
    }

    // Open in right sidebar
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) {
      throw new Error("Claude Code Skills: could not open a sidebar panel");
    }
    await leaf.setViewState({ type: CLAUDE_PANEL_VIEW_TYPE, active: true });
    await workspace.revealLeaf(leaf);
    return leaf.view as unknown as ClaudePanel;
  }
}
