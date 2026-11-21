import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { templatesRoot } from "../paths.js";
import type { PlannedFile } from "../schemas/plan.js";

type Workflow = {
  id: string;
  name: string;
  title: string;
  status?: string;
  description: string;
  steps?: string[];
};

type Catalog = {
  defaultInstall: string[];
  workflows: Workflow[];
};

export function planSharedSkills(): PlannedFile[] {
  const raw = readFileSync(join(templatesRoot(), "workflows/catalog.yaml"), "utf8");
  const catalog = YAML.parse(raw) as Catalog;
  const byId = new Map(catalog.workflows.map((w) => [w.id, w]));
  const files: PlannedFile[] = [];

  for (const id of catalog.defaultInstall) {
    const wf = byId.get(id);
    if (!wf || wf.status === "stub") continue;
    const steps = (wf.steps ?? []).map((s) => `- ${s}`).join("\n");
    const body = `---
name: ${wf.name}
description: ${wf.description}
---

# ${wf.title}

${wf.description}

## Steps

${steps || "- Follow the workflow description."}
`;
    files.push({
      path: `.agents/skills/${wf.name}/SKILL.md`,
      content: body.endsWith("\n") ? body : `${body}\n`,
      kind: "create",
      managed: true,
      templateId: `workflow/${wf.id}`,
    });
  }

  return files;
}
