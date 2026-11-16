import type { Pool } from "pg";
import { AppError } from "../errors";
import { evaluateFlag, type Evaluation } from "./evaluate";
import * as repo from "./repository";
import type { CreateFlagInput, ListQuery, UpdateFlagInput } from "./schemas";

export interface FlagDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  enabled: boolean;
  rolloutPercentage: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OverrideDto {
  subjectId: string;
  enabled: boolean;
  createdAt: Date;
}

export interface Page<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface EvaluationResult {
  subjectId: string;
  flags: Record<string, Evaluation>;
}

function toFlag(row: repo.FlagRow): FlagDto {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    rolloutPercentage: row.rollout_percentage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toOverride(row: repo.OverrideRow): OverrideDto {
  return { subjectId: row.subject_id, enabled: row.enabled, createdAt: row.created_at };
}

function pageOf<T>(data: T[], total: number, query: ListQuery): Page<T> {
  return {
    data,
    meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
  };
}

export class FlagService {
  constructor(private readonly pool: Pool) {}

  async create(input: CreateFlagInput): Promise<FlagDto> {
    try {
      return toFlag(await repo.insertFlag(this.pool, input));
    } catch (err) {
      const { code, constraint } = err as { code?: string; constraint?: string };
      if (code === "23505" && constraint === "feature_flags_key_key") {
        throw new AppError(409, "FLAG_KEY_TAKEN", "A flag with this key already exists");
      }
      throw err;
    }
  }

  async get(id: string): Promise<FlagDto> {
    return toFlag(await this.requireFlag(id));
  }

  async list(query: ListQuery): Promise<Page<FlagDto>> {
    const { rows, total } = await repo.listFlags(this.pool, query.limit, (query.page - 1) * query.limit);
    return pageOf(rows.map(toFlag), total, query);
  }

  async update(id: string, patch: UpdateFlagInput): Promise<FlagDto> {
    await this.requireFlag(id);
    return toFlag(await repo.updateFlag(this.pool, id, patch));
  }

  async remove(id: string): Promise<void> {
    await this.requireFlag(id);
    await repo.deleteFlag(this.pool, id);
  }

  async setOverride(id: string, subjectId: string, enabled: boolean): Promise<OverrideDto> {
    await this.requireFlag(id);
    return toOverride(await repo.upsertOverride(this.pool, id, subjectId, enabled));
  }

  async removeOverride(id: string, subjectId: string): Promise<void> {
    await this.requireFlag(id);
    const removed = await repo.deleteOverride(this.pool, id, subjectId);
    if (!removed) throw new AppError(404, "OVERRIDE_NOT_FOUND", "Override not found");
  }

  async listOverrides(id: string, query: ListQuery): Promise<Page<OverrideDto>> {
    await this.requireFlag(id);
    const { rows, total } = await repo.listOverrides(this.pool, id, query.limit, (query.page - 1) * query.limit);
    return pageOf(rows.map(toOverride), total, query);
  }

  /**
   * Evaluates flags for one subject. Without `keys`, every flag is evaluated.
   * A requested key that does not exist is answered as off, so a client never breaks
   * because a flag was deleted or not created yet.
   */
  async evaluate(subjectId: string, keys?: string[]): Promise<EvaluationResult> {
    const uniqueKeys = keys ? [...new Set(keys)] : undefined;
    const flags = uniqueKeys
      ? await repo.findFlagsByKeys(this.pool, uniqueKeys)
      : await repo.findAllFlags(this.pool);
    const overrides = await repo.findOverridesForSubject(
      this.pool,
      flags.map((flag) => flag.id),
      subjectId,
    );

    const result: Record<string, Evaluation> = {};
    for (const flag of flags) {
      result[flag.key] = evaluateFlag(
        { key: flag.key, enabled: flag.enabled, rolloutPercentage: flag.rollout_percentage },
        subjectId,
        overrides.get(flag.id),
      );
    }
    for (const key of uniqueKeys ?? []) {
      if (!(key in result)) result[key] = { enabled: false, reason: "not_found" };
    }

    return { subjectId, flags: result };
  }

  private async requireFlag(id: string): Promise<repo.FlagRow> {
    const flag = await repo.findFlag(this.pool, id);
    if (!flag) throw new AppError(404, "FLAG_NOT_FOUND", "Flag not found");
    return flag;
  }
}
