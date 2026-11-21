export type MigrationContext = {
  /** ISO timestamp for backups / stamps when a migration needs one. */
  now?: string;
};

export type Migration = {
  id: string;
  from: string;
  to: string;
  description: string;
  apply: (repoRoot: string, ctx: MigrationContext) => void;
};

export type MigrationResult = {
  applied: string[];
  fromVersion: string;
  toVersion: string;
  /** Effective template version after running the chain (may equal from if none applied). */
  currentVersion: string;
};
