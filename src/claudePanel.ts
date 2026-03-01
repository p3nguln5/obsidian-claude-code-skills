import {
  ItemView,
  MarkdownRenderer,
  Notice,
  WorkspaceLeaf,
  normalizePath,
} from "obsidian";
import type ClaudeCodeSkillsPlugin from "./main";
import type { Skill } from "./types";
import { runWithSkillStreaming } from "./executor";

export const CLAUDE_PANEL_VIEW_TYPE = "claude-skills-chat";

export class ClaudePanel extends ItemView {
  plugin: ClaudeCodeSkillsPlugin;

  private sessionId: string | null = null;
  private cancelFn: (() => void) | null = null;
  private isStreaming = false;
  private lastResponseText = "";
  private conversationLog: string[] = []; // full transcript for Create Note
  private activeSkillName: string | null = null;
  private hasFirstChunk = false;

  // DOM refs
  private messagesEl!: HTMLElement;
  private skillLabelEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private loadingEl: HTMLElement | null = null;
  private currentStreamPre: HTMLPreElement | null = null;
  private currentStreamContainer: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: ClaudeCodeSkillsPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return CLAUDE_PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Claude";
  }

  getIcon(): string {
    return "bot";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("claude-panel-root");

    // ── Session bar ──────────────────────────────────────────────────────────
    const sessionBar = contentEl.createDiv({ cls: "claude-panel-session-bar" });
    this.skillLabelEl = sessionBar.createDiv({ cls: "claude-panel-skill-label" });
    this.skillLabelEl.setText("No active session");

    // ── Messages area ────────────────────────────────────────────────────────
    this.messagesEl = contentEl.createDiv({ cls: "claude-panel-messages" });

    // ── Footer ───────────────────────────────────────────────────────────────
    const footer = contentEl.createDiv({ cls: "claude-panel-footer" });

    // Input row
    const inputRow = footer.createDiv({ cls: "claude-panel-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "claude-panel-input",
      attr: { placeholder: "Ask a follow-up... (Enter to send, Shift+Enter for newline)" },
    });

    this.sendBtn = inputRow.createEl("button", {
      cls: "claude-panel-send-btn",
      text: "→",
    });

    this.sendBtn.addEventListener("click", () => this.handleSend());
    this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // Action row
    const actionRow = footer.createDiv({ cls: "claude-panel-action-row" });

    const copyBtn = actionRow.createEl("button", { text: "Copy last" });
    copyBtn.addEventListener("click", () => {
      if (this.lastResponseText) {
        navigator.clipboard.writeText(this.lastResponseText)
          .then(() => new Notice("Copied to clipboard"))
          .catch(() => new Notice("Copy failed — check clipboard permissions"));
      }
    });

    const createNoteBtn = actionRow.createEl("button", { text: "Create note" });
    createNoteBtn.addEventListener("click", () => void this.createNote());

    const closeBtn = actionRow.createEl("button", {
      cls: "claude-close-session-btn",
      text: "Close session",
    });
    closeBtn.addEventListener("click", () => this.closeSession());

    this.updateInputState();
  }

  onClose(): void {
    this.cancelFn?.();
    this.cancelFn = null;
  }

  // ── Public entry points ────────────────────────────────────────────────────

  /**
   * Called from context menu: starts a new conversation with the given skill
   * and selected text. Adds a visual separator if a previous session exists.
   */
  startConversation(skill: Skill, selectedText: string): void {
    if (!this.messagesEl) return; // onOpen not yet called

    this.cancelFn?.(); // kill any in-progress stream
    this.isStreaming = false;

    // If there were prior messages, add a separator
    const hasHistory = this.messagesEl.childElementCount > 0;
    if (hasHistory) {
      this.messagesEl.createEl("hr", { cls: "claude-panel-separator" });
    }

    this.sessionId = null; // start a fresh session
    this.conversationLog = []; // new conversation = fresh transcript
    this.activeSkillName = skill.name;
    this.skillLabelEl.setText(`Skill: ${skill.name}`);

    // Show a truncated preview of the selected text as the "user" bubble
    const preview = selectedText.length > 300
      ? selectedText.slice(0, 300) + "…"
      : selectedText;
    this.addUserBubble(preview);

    this.send(skill.id, selectedText);
  }

  /**
   * Called from ribbon/command palette: opens the panel in freeform chat mode.
   * The user types a message in the input box.
   */
  startFreeform(): void {
    if (!this.messagesEl) return;
    this.skillLabelEl.setText(this.sessionId ? "Chat (session active)" : "Chat");
    this.inputEl?.focus();
  }

  // ── Internal send / stream ─────────────────────────────────────────────────

  private handleSend(): void {
    const text = this.inputEl.value.trim();
    if (!text || this.isStreaming) return;
    this.inputEl.value = "";
    this.addUserBubble(text);
    this.send(null, text); // null skillId = follow-up / freeform
  }

  private send(skillId: string | null, text: string): void {
    this.isStreaming = true;
    this.hasFirstChunk = false;
    this.updateInputState();

    // Update session bar to show connecting state
    const skillContext = this.activeSkillName ?? "Chat";
    this.skillLabelEl.setText(`${skillContext} · connecting…`);
    this.skillLabelEl.addClass("is-streaming");

    // Create the assistant message container
    const assistantDiv = this.messagesEl.createDiv({ cls: "claude-msg-assistant" });
    assistantDiv.createDiv({ cls: "claude-msg-label" }).setText("Claude");
    this.currentStreamContainer = assistantDiv.createDiv({ cls: "claude-msg-content" });

    // Loading dots — visible until first text chunk arrives
    this.loadingEl = this.currentStreamContainer.createDiv({ cls: "claude-loading-dots" });
    this.loadingEl.createEl("span");
    this.loadingEl.createEl("span");
    this.loadingEl.createEl("span");

    // currentStreamPre is created lazily on the first chunk (see appendChunk)
    this.currentStreamPre = null;

    this.scrollToBottom();

    const cancel = runWithSkillStreaming(
      skillId,
      text,
      this.plugin.settings,
      this.sessionId,
      (chunk) => this.appendChunk(chunk),
      (fullText, sid) => void this.finalize(fullText, sid),
      (err) => {
        this.isStreaming = false;
        this.cancelFn = null;
        this.loadingEl?.remove();
        this.loadingEl = null;
        this.skillLabelEl.removeClass("is-streaming");
        this.skillLabelEl.setText(`${skillContext} · error`);
        this.updateInputState();
        new Notice(`Claude error: ${err.message}`);
        if (this.currentStreamContainer) {
          this.currentStreamContainer.empty();
          this.currentStreamContainer.createEl("span", {
            cls: "claude-error",
            text: `Error: ${err.message}`,
          });
        }
        this.currentStreamPre = null;
        this.currentStreamContainer = null;
      }
    );

    this.cancelFn = cancel;
  }

  private appendChunk(text: string): void {
    // On the very first chunk: swap loading dots for the streaming <pre>
    if (!this.hasFirstChunk) {
      this.hasFirstChunk = true;
      this.loadingEl?.remove();
      this.loadingEl = null;
      if (this.currentStreamContainer) {
        this.currentStreamPre = this.currentStreamContainer.createEl("pre", {
          cls: "claude-streaming",
        });
      }
      this.skillLabelEl.setText(`${this.activeSkillName ?? "Chat"} · streaming…`);
    }

    if (this.currentStreamPre) {
      this.currentStreamPre.textContent = (this.currentStreamPre.textContent ?? "") + text;
      this.scrollToBottom();
    }
  }

  private async finalize(fullText: string, sessionId: string | null): Promise<void> {
    this.isStreaming = false;
    this.cancelFn = null;

    // Clean up any leftover loading dots (empty response edge case)
    this.loadingEl?.remove();
    this.loadingEl = null;
    this.skillLabelEl.removeClass("is-streaming");

    if (sessionId) this.sessionId = sessionId;

    const textToRender = fullText || (this.currentStreamPre?.textContent ?? "");
    if (textToRender) {
      this.lastResponseText = textToRender;
      this.conversationLog.push(`**Claude:**\n\n${textToRender}`);
    }
    const container = this.currentStreamContainer;
    this.currentStreamPre = null;
    this.currentStreamContainer = null;

    // Replace <pre> stream with rendered Markdown
    if (container) {
      container.empty();
      const renderedEl = container.createDiv({ cls: "claude-result-rendered" });
      const sourcePath = this.app.workspace.getActiveFile()?.path ?? "";

      await MarkdownRenderer.render(
        this.app,
        textToRender,
        renderedEl,
        sourcePath,
        this
      ).catch(() => {
        renderedEl.empty();
        renderedEl.createEl("pre").setText(textToRender);
      });
    }

    this.skillLabelEl.setText(
      this.sessionId
        ? `${this.activeSkillName ?? "Chat"} · session active`
        : (this.activeSkillName ?? "Chat")
    );

    this.updateInputState();
    this.scrollToBottom();
    this.inputEl?.focus();
  }

  // ── Close session ──────────────────────────────────────────────────────────

  closeSession(): void {
    this.cancelFn?.();
    this.cancelFn = null;
    this.sessionId = null;
    this.isStreaming = false;
    this.lastResponseText = "";
    this.conversationLog = [];
    this.activeSkillName = null;
    // Close the leaf — removes the panel from the sidebar
    this.leaf.detach();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private addUserBubble(text: string): void {
    const div = this.messagesEl.createDiv({ cls: "claude-msg-user" });
    div.createDiv({ cls: "claude-msg-label" }).setText("You");
    div.createDiv({ cls: "claude-msg-content" }).setText(text);
    this.conversationLog.push(`**You:** ${text}`);
    this.scrollToBottom();
  }

  private scrollToBottom(): void {
    if (this.messagesEl) {
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  private updateInputState(): void {
    if (!this.inputEl || !this.sendBtn) return;
    this.inputEl.disabled = this.isStreaming;
    this.sendBtn.disabled = this.isStreaming;
    this.sendBtn.textContent = this.isStreaming ? "…" : "→";
  }

  private async createNote(): Promise<void> {
    if (this.conversationLog.length === 0) return;

    // Build the full conversation transcript
    const noteContent = this.conversationLog.join("\n\n---\n\n");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const skillPart = (this.activeSkillName ?? "Chat").replace(/[/\\:*?"<>|]/g, "-");
    const fileName = `Claude - ${skillPart} - ${timestamp}.md`;

    // Strip any accidental leading/trailing slashes the user may have typed
    const folder = this.plugin.settings.outputFolder.trim().replace(/^\/+|\/+$/g, "");
    const filePath = normalizePath(folder ? `${folder}/${fileName}` : fileName);

    // Ensure the output folder exists. We catch "already exists" errors gracefully
    // because getAbstractFileByPath can miss newly-created folders under some conditions.
    if (folder) {
      const folderPath = normalizePath(folder);
      if (!this.app.vault.getAbstractFileByPath(folderPath)) {
        try {
          await this.app.vault.createFolder(folderPath);
        } catch (err) {
          const msg = (err as Error).message ?? "";
          // "Folder already exists" is not a real error — skip it
          if (!msg.toLowerCase().includes("already exist")) {
            new Notice(`Could not create folder "${folderPath}": ${msg}`);
            return;
          }
        }
      }
    }

    try {
      const file = await this.app.vault.create(filePath, noteContent);
      await this.app.workspace.openLinkText(file.path, "", true);
      new Notice(`Created: ${file.path}`);
    } catch (err) {
      new Notice(`Failed to create note: ${(err as Error).message}`);
    }
  }
}
