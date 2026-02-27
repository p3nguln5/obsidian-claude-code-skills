import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { PluginSettings } from "./types";

// ── Path validation ────────────────────────────────────────────────────────────

const VALID_BINARY_NAMES = ["claude", "claude-code", "claude.cmd"];

function validatePaths(settings: PluginSettings): void {
  const name = path.basename(settings.claudeBinPath);
  if (!VALID_BINARY_NAMES.includes(name)) {
    throw new Error(
      `Unexpected binary name "${name}". Expected one of: ${VALID_BINARY_NAMES.join(", ")}`
    );
  }

  try {
    fs.accessSync(settings.claudeBinPath, fs.constants.X_OK);
  } catch {
    throw new Error(`Binary not found or not executable: ${settings.claudeBinPath}`);
  }

  if (settings.workingDirectory.trim()) {
    try {
      const stat = fs.statSync(settings.workingDirectory);
      if (!stat.isDirectory()) {
        throw new Error(`Working directory is not a directory: ${settings.workingDirectory}`);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(`Working directory does not exist: ${settings.workingDirectory}`);
      }
      throw err;
    }
  }
}

// ── Spawn options ──────────────────────────────────────────────────────────────

interface SpawnTarget {
  command: string;
  args: string[];
  shell: boolean;
}

/**
 * On Windows, .cmd files cannot be spawned directly by Node — they require
 * shell: true. On all other platforms shell is not needed.
 */
function buildSpawnTarget(claudeBin: string, claudeArgs: string[]): SpawnTarget {
  const shell = process.platform === "win32";
  return { command: claudeBin, args: claudeArgs, shell };
}

// ── Main export ────────────────────────────────────────────────────────────────

/**
 * Spawns the claude CLI and streams its response.
 *
 * @param skillId   Skill to invoke (e.g. "yara-and-sigma"). Null for follow-up
 *                  messages in an ongoing session (no skill prefix prepended).
 * @param text      The user message / selected text to send.
 * @param settings  Plugin settings (binary path, cwd, timeout, budget).
 * @param sessionId Previously captured session_id for multi-turn continuation
 *                  via --resume. Null to start a fresh session.
 * @param onChunk   Called with each streamed text delta as it arrives.
 * @param onDone    Called when the stream completes with (fullText, sessionId).
 *                  sessionId may be null if the CLI did not emit one.
 * @param onError   Called on fatal errors (spawn failure, timeout, non-zero exit).
 * @returns A cancel function that kills the subprocess if still running.
 */
export function runWithSkillStreaming(
  skillId: string | null,
  text: string,
  settings: PluginSettings,
  sessionId: string | null,
  onChunk: (text: string) => void,
  onDone: (fullText: string, sessionId: string | null) => void,
  onError: (err: Error) => void
): () => void {
  try {
    validatePaths(settings);
  } catch (err) {
    onError(err as Error);
    return () => {};
  }

  // Build the message: skill invocations include the /{skillId} prefix;
  // follow-up messages in a resumed session are sent as-is.
  const message = skillId ? `/${skillId}\n\n${text}` : text;

  const claudeArgs = [
    "--print",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
  ];

  if (settings.maxBudgetUsd > 0) {
    claudeArgs.push("--max-budget-usd", String(settings.maxBudgetUsd));
  }

  // Resume an existing session for multi-turn conversation
  if (sessionId) {
    claudeArgs.push("--resume", sessionId);
  }

  const { command, args, shell } = buildSpawnTarget(settings.claudeBinPath, claudeArgs);

  // Fall back to home directory if working directory is not configured
  const cwd = settings.workingDirectory.trim() || os.homedir();

  const proc = spawn(command, args, {
    cwd,
    shell,
    env: { ...process.env, HOME: os.homedir(), CLAUDE_OBSIDIAN_PLUGIN: "1" },
  });

  proc.stdin.write(message);
  proc.stdin.end();

  let buffer = "";
  let finalResult = "";
  let capturedSessionId: string | null = null;
  let killed = false;

  const timeoutId = setTimeout(() => {
    if (!killed) {
      killed = true;
      proc.kill();
      onError(new Error(`Claude timed out after ${settings.timeout / 1000}s`));
    }
  }, settings.timeout);

  proc.stdout.on("data", (rawChunk: Buffer) => {
    buffer += rawChunk.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      // Streamed text deltas
      if (
        event.type === "stream_event" &&
        event.event &&
        typeof event.event === "object"
      ) {
        const inner = event.event as Record<string, unknown>;
        if (
          inner.type === "content_block_delta" &&
          inner.delta &&
          typeof inner.delta === "object"
        ) {
          const delta = inner.delta as { type?: string; text?: string };
          if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text) {
            onChunk(delta.text);
          }
        }
      }

      // Final result — captures full text and session_id for --resume
      if (event.type === "result") {
        if (typeof event.result === "string") {
          finalResult = event.result;
        }
        if (typeof event.session_id === "string") {
          capturedSessionId = event.session_id;
        }
      }
    }
  });

  proc.on("close", () => {
    clearTimeout(timeoutId);
    if (!killed) {
      onDone(finalResult, capturedSessionId);
    }
  });

  proc.on("error", (err: Error) => {
    clearTimeout(timeoutId);
    if (!killed) {
      killed = true;
      onError(err);
    }
  });

  return () => {
    if (!killed) {
      killed = true;
      clearTimeout(timeoutId);
      proc.kill();
    }
  };
}
