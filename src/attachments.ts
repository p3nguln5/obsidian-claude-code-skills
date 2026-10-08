import type { App } from "obsidian";

/**
 * Something the user dragged into the panel: a passage selected in a note, or
 * an image or file. Attachments are kept apart from the message the user types
 * - they are shown as cards, both while composing and in the sent message.
 */
export type Attachment =
  | { kind: "text"; label: string; text: string; source: string }
  | { kind: "image" | "file"; label: string; path: string };

export function kindOf(p: string): "image" | "file" {
  return /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(p) ? "image" : "file";
}

function vaultBase(app: App): string {
  const adapter = app.vault.adapter as unknown as { basePath?: string };
  return adapter.basePath ?? "";
}

/**
 * Turns whatever a drop handed us - an app://local URL, a file:// URL, a
 * wikilink target, a bare vault path - into an absolute path on disk.
 */
export function resolveVaultPath(app: App, src: string): string | null {
  try {
    let s = decodeURIComponent(String(src).split("?")[0]).trim();
    if (s.startsWith("app://local")) s = s.slice("app://local".length);
    else if (s.startsWith("file://")) s = s.slice("file://".length);
    if (s.startsWith("/")) return s;

    const base = vaultBase(app);
    const active = app.workspace.getActiveFile();
    const dest = app.metadataCache.getFirstLinkpathDest(s, active ? active.path : "");
    if (dest) return base + "/" + dest.path;
    return base ? base + "/" + s : null;
  } catch {
    return null;
  }
}

/** A URL the panel can actually render an <img> from. */
export function resourceUrl(app: App, p: string): string {
  try {
    const base = vaultBase(app);
    if (base && p.startsWith(base + "/")) {
      return app.vault.adapter.getResourcePath(p.slice(base.length + 1));
    }
    return "app://local" + p.split("/").map(encodeURIComponent).join("/");
  } catch {
    return "";
  }
}

export function labelFor(att: Attachment): string {
  return att.kind === "text" ? "selection · " + att.source : att.kind;
}

/**
 * One attachment card. Used both in the composer tray (with a remove button)
 * and inside a sent message (without one).
 */
export function buildCard(
  host: HTMLElement,
  att: Attachment,
  app: App,
  onRemove: (() => void) | null
): HTMLElement {
  const card = host.createDiv({ cls: "claude-card claude-card-" + att.kind });

  if (att.kind === "image") {
    card.createEl("img", {
      cls: "claude-card-thumb",
      attr: { src: resourceUrl(app, att.path) },
    });
  } else {
    card
      .createDiv({ cls: "claude-card-icon" })
      .setText(att.kind === "text" ? "¶" : "▣");
  }

  const body = card.createDiv({ cls: "claude-card-body" });
  body.createDiv({ cls: "claude-card-title" }).setText(att.label);
  body.createDiv({ cls: "claude-card-sub" }).setText(labelFor(att));
  card.setAttr("aria-label", att.kind === "text" ? att.text.slice(0, 400) : att.path);

  if (onRemove) {
    const rm = card.createEl("button", { cls: "claude-card-x", text: "×" });
    rm.addEventListener("click", onRemove);
  }
  return card;
}

/** The attachments, rendered for the CLI: each one labelled, then a divider. */
export function attachmentsPreamble(list: Attachment[]): string {
  if (!list.length) return "";
  let out = "I dragged this into the panel:\n\n";
  list.forEach((att, i) => {
    if (att.kind === "text") {
      out += `[${i + 1}] selected in "${att.source}":\n\n${att.text}\n\n`;
    } else {
      out += `[${i + 1}] ${att.kind} at ${att.path} - read it from disk\n\n`;
    }
  });
  return out + "---\n\n";
}
