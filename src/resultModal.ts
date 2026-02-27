import { App, Modal, MarkdownRenderer, Notice, normalizePath } from "obsidian";
import type ClaudeCodeSkillsPlugin from "./main";

export class ResultModal extends Modal {
  private plugin: ClaudeCodeSkillsPlugin;
  private skillName: string;
  private startStreaming: (modal: ResultModal) => void;
  private cancelFn: (() => void) | null = null;
  private streamingContainer!: HTMLElement;
  private preEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private buttonRow!: HTMLElement;
  private fullText = "";
  private isDone = false;

  constructor(
    app: App,
    plugin: ClaudeCodeSkillsPlugin,
    skillName: string,
    startStreaming: (modal: ResultModal) => void
  ) {
    super(app);
    this.plugin = plugin;
    this.skillName = skillName;
    this.startStreaming = startStreaming;
    this.modalEl.addClass("claude-skills-modal");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    // Header
    const header = contentEl.createEl("div", { cls: "claude-skill-header" });
    header.setText(`Claude: ${this.skillName}`);

    // Status line
    this.statusEl = contentEl.createEl("div", { cls: "claude-status" });
    this.statusEl.setText("Connecting...");

    // Streaming container
    this.streamingContainer = contentEl.createEl("div", {
      cls: "claude-streaming-container",
    });
    this.preEl = this.streamingContainer.createEl("pre", {
      cls: "claude-streaming",
    });
    this.preEl.setText("");

    // Button row (hidden until done)
    this.buttonRow = contentEl.createEl("div", { cls: "claude-button-row" });
    this.buttonRow.style.display = "none";

    // Start streaming
    this.startStreaming(this);
  }

  setCancelFn(fn: () => void): void {
    this.cancelFn = fn;
    this.statusEl.setText("Streaming...");
  }

  appendChunk(text: string): void {
    this.fullText += text;
    this.preEl.textContent = this.fullText;
    // Auto-scroll to bottom
    this.streamingContainer.scrollTop = this.streamingContainer.scrollHeight;
  }

  // Called by main.ts with the authoritative final text from the CLI result event.
  // If streaming produced partial text, this overwrites it with the complete output.
  finalizeWithText(text: string): void {
    if (text) {
      this.fullText = text;
      // Keep the pre in sync so it shows the full text if finalize uses it
      if (this.preEl) {
        this.preEl.textContent = this.fullText;
      }
    }
    this.finalize();
  }

  finalize(): void {
    if (this.isDone) return;
    this.isDone = true;
    this.cancelFn = null;

    this.statusEl.setText("Done");

    // Replace pre with rendered Markdown
    this.streamingContainer.empty();
    const renderedEl = this.streamingContainer.createEl("div", {
      cls: "claude-result-rendered",
    });

    const activeFile = this.app.workspace.getActiveFile();
    const sourcePath = activeFile?.path ?? "";

    MarkdownRenderer.render(
      this.app,
      this.fullText,
      renderedEl,
      sourcePath,
      this.plugin
    ).catch(() => {
      // Fallback: plain text
      renderedEl.createEl("pre").setText(this.fullText);
    });

    // Show buttons
    this.buttonRow.style.display = "flex";

    const copyBtn = this.buttonRow.createEl("button", { text: "Copy" });
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(this.fullText).then(() => {
        new Notice("Copied to clipboard");
      });
    });

    const createNoteBtn = this.buttonRow.createEl("button", {
      text: "Create Note",
    });
    createNoteBtn.addEventListener("click", () => {
      this.createNote();
    });

    const closeBtn = this.buttonRow.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }

  private async createNote(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `Claude - ${this.skillName} - ${timestamp}.md`;
    const folder = this.plugin.settings.outputFolder.trim();
    const filePath = normalizePath(folder ? `${folder}/${fileName}` : fileName);

    // Create the output folder if it doesn't exist yet
    if (folder) {
      const folderPath = normalizePath(folder);
      if (!this.app.vault.getAbstractFileByPath(folderPath)) {
        await this.app.vault.createFolder(folderPath);
      }
    }

    try {
      const file = await this.app.vault.create(filePath, this.fullText);
      this.app.workspace.openLinkText(file.path, "", true);
      new Notice(`Created: ${filePath}`);
      this.close();
    } catch (err) {
      new Notice(`Failed to create note: ${(err as Error).message}`);
    }
  }

  onClose(): void {
    this.cancelFn?.();
    this.cancelFn = null;
    this.contentEl.empty();
  }
}
