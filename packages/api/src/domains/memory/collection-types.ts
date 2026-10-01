import { statSync } from 'node:fs';
import type { F163Authority } from './f163-types.js';
import { EVIDENCE_STATUSES, type EvidenceStatus } from './interfaces.js';

export const COLLECTION_KINDS = ['project', 'world', 'domain', 'research', 'global'] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

export type CollectionSensitivity = 'public' | 'internal' | 'private' | 'restricted';

export const COLLECTION_SENSITIVITY_ORDER: Record<CollectionSensitivity, number> = {
  restricted: 0,
  private: 1,
  internal: 2,
  public: 3,
};

export const COLLECTION_STATUSES = ['registered', 'indexing', 'active', 'stale', 'blocked', 'archived'] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const REVIEW_STATUSES = ['unreviewed', 'partial', 'reviewed', 'stale'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface CollectionFieldMapping {
  /** Existing top-level frontmatter scalar used as the indexed summary. */
  summary?: string;
  /** Existing scalar or string-list fields merged into indexed keywords. */
  keywords?: string[];
  /** Explicit source status translations. Unmapped values are excluded with a warning. */
  status?: Record<string, EvidenceStatus>;
}

export interface CollectionManifest {
  id: string;
  kind: CollectionKind;
  name: string;
  displayName: string;
  root: string;
  sensitivity: CollectionSensitivity;
  /** Server-owned identity binding for private/restricted recall authorization. */
  ownerUserId?: string;
  scannerLevel: 0 | 1 | 2 | 3 | 'auto';
  fieldMapping?: CollectionFieldMapping;
  indexPolicy: {
    autoRebuild: boolean;
    rebuildIntervalMs?: number;
  };
  reviewPolicy: {
    authorityCeiling: F163Authority;
    requireOwnerApproval: boolean;
  };
  status?: CollectionStatus;
  exclude?: string[];
  createdAt: string;
  updatedAt: string;
}

const COLLECTION_ID_RE = /^[a-z]+:[a-z][a-z0-9-]*$/;

export function validateCollectionId(id: string): void {
  if (!COLLECTION_ID_RE.test(id)) {
    throw new Error(`Invalid collection id format: "${id}" — must be <kind>:<lowercase-name>`);
  }
}

const VALID_KINDS = new Set<string>(COLLECTION_KINDS);
const VALID_SENSITIVITIES = new Set<string>(['public', 'internal', 'private', 'restricted']);
const VALID_SCANNER_LEVELS = new Set<number | string>([0, 1, 2, 3, 'auto']);

export function validateManifestInput(input: {
  id: string;
  kind: string;
  sensitivity?: string;
  scannerLevel?: number | string;
  fieldMapping?: unknown;
  root: string;
}): void {
  validateCollectionId(input.id);

  if (!VALID_KINDS.has(input.kind)) {
    throw new Error(`Invalid kind: "${input.kind}" — must be one of: ${COLLECTION_KINDS.join(', ')}`);
  }

  const idKind = input.id.split(':')[0];
  if (idKind !== input.kind) {
    throw new Error(`ID kind prefix "${idKind}" does not match kind "${input.kind}"`);
  }

  if (input.sensitivity !== undefined && !VALID_SENSITIVITIES.has(input.sensitivity)) {
    throw new Error(
      `Invalid sensitivity: "${input.sensitivity}" — must be one of: public, internal, private, restricted`,
    );
  }

  if (input.scannerLevel !== undefined && !VALID_SCANNER_LEVELS.has(input.scannerLevel)) {
    throw new Error(`Invalid scannerLevel: ${input.scannerLevel} — must be one of: 0, 1, 2, 3, auto`);
  }

  if (input.fieldMapping !== undefined) {
    const mapping = input.fieldMapping;
    if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
      throw new Error('fieldMapping must be an object');
    }
    const fields = mapping as Record<string, unknown>;
    const isField = (value: unknown): value is string =>
      typeof value === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,79}$/.test(value);
    if (Object.keys(fields).some((key) => !['summary', 'keywords', 'status'].includes(key))) {
      throw new Error('fieldMapping supports only summary, keywords and status');
    }
    if (fields.summary !== undefined && !isField(fields.summary)) {
      throw new Error('fieldMapping.summary must name a top-level frontmatter field');
    }
    if (
      fields.keywords !== undefined &&
      (!Array.isArray(fields.keywords) || fields.keywords.length > 20 || !fields.keywords.every(isField))
    ) {
      throw new Error('fieldMapping.keywords must contain at most 20 frontmatter field names');
    }
    if (fields.status !== undefined) {
      if (
        !fields.status ||
        typeof fields.status !== 'object' ||
        Array.isArray(fields.status) ||
        Object.entries(fields.status).some(
          ([source, target]) =>
            !isField(source) ||
            typeof target !== 'string' ||
            !(EVIDENCE_STATUSES as readonly string[]).includes(target),
        )
      ) {
        throw new Error('fieldMapping.status must map source status names to supported evidence statuses');
      }
    }
    if (input.scannerLevel !== 1 && input.scannerLevel !== 2 && input.scannerLevel !== 3) {
      throw new Error('fieldMapping requires explicit structured scannerLevel 1, 2 or 3');
    }
  }

  const stat = statSync(input.root, { throwIfNoEntry: false });
  if (!stat) {
    throw new Error(`Root path does not exist: ${input.root}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Root path is not a directory: ${input.root}`);
  }
}

export const SEARCH_DIMENSIONS = ['project', 'global', 'all', 'library', 'collection'] as const;
export type SearchDimension = (typeof SEARCH_DIMENSIONS)[number];

export const ILibraryCatalogSymbol = Symbol.for('ILibraryCatalog');
