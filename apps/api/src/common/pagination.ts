import type { Paginated, PaginationQuery } from '@dnd/contracts';

export interface PageArgs {
  readonly skip: number;
  readonly take: number;
  readonly orderBy: Record<string, 'asc' | 'desc'>;
}

/**
 * Translate a validated pagination query into Prisma arguments.
 *
 * `allowedSortFields` is a whitelist rather than a pass-through: letting a
 * client sort by an arbitrary column name invites both errors and a slow query
 * on an unindexed field.
 */
export function pageArgs(
  query: PaginationQuery,
  allowedSortFields: readonly string[],
  defaultSort = 'createdAt',
): PageArgs {
  const sortBy =
    query.sortBy && allowedSortFields.includes(query.sortBy) ? query.sortBy : defaultSort;
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    orderBy: { [sortBy]: query.sortDir },
  };
}

export function paginated<T>(data: readonly T[], total: number, query: PaginationQuery): Paginated<T> {
  return {
    data,
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

/** Case-insensitive "contains" filter for a free-text search box. */
export function searchFilter(
  search: string | undefined,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  const term = search?.trim();
  if (!term) return undefined;
  return { OR: fields.map((f) => ({ [f]: { contains: term, mode: 'insensitive' } })) };
}

/**
 * Prisma Decimal columns are serialised as strings on the wire.
 * See the note in @dnd/contracts: a JSON number is a float, and a 4-decimal
 * fabric quantity does not survive enough float round trips intact.
 */
export function decimalsToStrings<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === 'object' && 'toFixed' in v && typeof (v as { toFixed: unknown }).toFixed === 'function' && !(v instanceof Date)) {
      out[k] = String(v);
    } else if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      out[k] = decimalsToStrings(v as Record<string, unknown>);
    } else if (Array.isArray(v)) {
      out[k] = v.map((x) =>
        x && typeof x === 'object' && !(x instanceof Date) ? decimalsToStrings(x as Record<string, unknown>) : x,
      );
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
