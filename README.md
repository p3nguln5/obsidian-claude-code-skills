# Claude Code Skills for Obsidian

An Obsidian plugin that connects your notes to the [Claude Code](https://claude.ai/code) CLI. Highlight any text in a note, right-click to select a skill, and get a streaming AI response in a persistent side panel — without leaving Obsidian.

## Features

- **Right-click selected text** → pick a Claude Code skill → response streams into the sidebar
- **Persistent side panel** — stays open while you read and edit your notes
- **Multi-turn conversation** — follow-up questions in the same session (full context preserved via `--resume`)
- **Freeform chat** — open the panel without selecting text via the ribbon icon or command palette
- **Loading animation** — three-dot bounce while Claude is connecting and thinking
- **Full conversation export** — save the entire transcript (user messages + all responses) as a vault note
- **Linux process isolation** — subprocess wrapped in `systemd-run --scope` with `IPAddressDeny=any` where available

## Requirements

- [Claude Code](https://claude.ai/code) CLI installed and authenticated (`claude` binary on your PATH)
- Obsidian desktop app (plugin is desktop-only — uses Node.js `child_process`)

> **Network usage:** This plugin spawns the `claude` CLI as a subprocess. The CLI communicates with the Anthropic API over the internet. No data is sent by this plugin directly — all network activity goes through the Claude Code CLI.

## Installation

### From Community Plugins (once approved)

1. Settings → Community plugins → Browse
2. Search for **Claude Code Skills**
3. Install and enable

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest)
2. Copy them to `<your-vault>/.obsidian/plugins/claude-code-skills/`
3. Settings → Community plugins → enable **Claude Code Skills**

## Configuration

Settings → Claude Code Skills:

| Setting | Description | Default |
|---------|-------------|---------|
| **Claude binary path** | Full path to the `claude` executable | Auto-detected on first load |
| **Working directory** | Directory `claude` runs from. Put your `CLAUDE.md` here for project context. | Home directory |
| **Timeout (ms)** | Max time to wait before killing the subprocess | 120000 (2 min) |
| **Max budget per query (USD)** | Hard API spend cap per invocation. Set to 0 to disable | 0.25 |
| **Output folder** | Vault folder where "Create Note" saves transcripts. Leave empty for vault root | (vault root) |

The claude binary is auto-detected from common install locations on first load. Run `which claude` in a terminal if auto-detection fails.

## Usage

### Skill dispatch (primary workflow)

1. Highlight any text in a note (e.g., a YARA rule, a log snippet, a code block)
2. Right-click → select **Claude: [skill name]** from the context menu
3. The side panel opens — your selected text appears as a user bubble and Claude's response streams in
4. Type follow-up questions in the input box at the bottom (Enter to send, Shift+Enter for newline)
5. Optionally: **Create Note** to save the full conversation transcript, or **Copy last** for just the last response
6. **Close Session** when done — kills the subprocess and closes the panel

### Freeform chat (no selection required)

- Click the **bot icon** in the left ribbon, or
- `Ctrl+P` → **Open Claude Code Skills panel**

The panel opens empty and you can type anything. Claude runs with the context of your configured working directory.

## Skills

This plugin reads skills from `~/.claude/skills/`. Each skill is a directory with a `SKILL.md` file containing YAML frontmatter:

```
~/.claude/skills/
  my-skill/
    SKILL.md    ← frontmatter: name, description
```

`SKILL.md` frontmatter example:
```yaml
---
name: My Skill
description: What this skill does
---
```

If no skills are found, the right-click menu will be empty but the freeform panel still works.

## How it works

The plugin spawns `claude --print --output-format stream-json --include-partial-messages` as a subprocess:

- Initial skill invocation sends `/{skillId}\n\n{selected text}` on stdin
- Follow-up messages use `--resume <sessionId>` for multi-turn continuation
- Streamed JSON events are parsed as they arrive — text appears chunk by chunk
- On Linux, the subprocess is wrapped in `systemd-run --scope --user -p IPAddressDeny=any` for process isolation
- The subprocess is killed if the panel is closed or **Close Session** is clicked

## Building from source

```bash
git clone https://github.com/p3nguln5/obsidian-claude-code-skills.git
cd obsidian-claude-code-skills
npm install       # one-time: installs build tools
npm run build     # compiles src/*.ts → main.js
```

Then copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/claude-code-skills/` directory.

For development with auto-rebuild on save: `npm run dev`

## License

MIT — see [LICENSE](LICENSE)
