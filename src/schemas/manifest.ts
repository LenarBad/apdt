import { z } from "zod";

export const ManifestEntrySchema = z.object({
  path: z.string(),
  hash: z.string(),
  templateId: z.string(),
  templateVersion: z.string(),
  managed: z.literal(true),
  lastAppliedApdtVersion: z.string(),
  /**
   * When true, keep on-disk bytes across init/update unless `--force`.
   * Set for brownfield files adopted into the inventory.
   */
  pinContent: z.boolean().optional(),
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const ManifestSchema = z.object({
  version: z.literal(1),
  apdtVersion: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /**
   * Installed template generation. Optional for older manifests; resolve via
   * max file templateVersion / default `0.2.0` when absent.
   */
  templateVersion: z.string().optional(),
  files: z.array(ManifestEntrySchema),
});
export type Manifest = z.infer<typeof ManifestSchema>;
