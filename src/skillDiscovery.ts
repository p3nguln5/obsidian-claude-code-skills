import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { Skill } from "./types";

function parseFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return result;

  for (const line of match[1].split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key && value) result[key] = value;
  }
  return result;
}

export function discoverSkills(): Skill[] {
  const skillsDir = path.join(os.homedir(), ".claude", "skills");

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
    let content: string;
    try {
      content = fs.readFileSync(skillMdPath, "utf8");
    } catch {
      continue;
    }

    const fm = parseFrontmatter(content);
    if (!fm.name) continue;

    skills.push({
      id: entry.name,
      name: fm.name,
      description: fm.description ?? "",
    });
  }

  return skills;
}
