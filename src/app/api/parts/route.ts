import { NextRequest } from 'next/server'
import {
  requireAuth,
  parseBody,
  apiSuccess,
  withErrorHandler,
} from '@/lib/api-helpers'
import { createPartSchema } from '@/lib/schemas/part'
import { logAudit } from '@/lib/audit'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type { Part } from '@prisma/client'

/**
 * GET /api/parts
 *
 * Query params:
 *   - search    (string)  — name / sku / barcode (case-insensitive contains)
 *   - lowStock  (boolean) — only parts with stockQty <= reorderLevel
 *   - model     (string)  — only parts compatible with the given model
 *                           (matches if compatibleModels CONTAINS the value
 *                            OR compatibleModels IS NULL — null means
 *                            "compatible with everything")
 *   - page      (number)  — pagination
 *   - pageSize  (number)  — items per page (default 30, capped at 100)
 *
 * Bug fix in this revision:
 *   - Previously, when only `model` was provided, filters[0] was already
 *     of shape { OR: [...] }, and we set `where.OR = filters[0]` — that
 *     produced `where.OR = { OR: [...] }` which is invalid Prisma input.
 *     Now uses AND consistently, which composes safely whether one or
 *     many filter clauses are present.
 *   - Decimal fields (unitCost, retailPrice) are converted to plain
 *     numbers in the response so client components don't have to
 *     deal with Prisma's Decimal type.
 */
export const GET = withErrorHandler(async (req: NextRequest) => {
  await requireAuth('parts:view')

  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.trim() ?? ''
  const lowStock = searchParams.get('lowStock') === 'true'
  const model = searchParams.get('model')?.trim() ?? ''
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'))
  const requestedPageSize = parseInt(
    searchParams.get('pageSize') ?? '30'
  )
  const pageSize = Math.min(
    100,
    Math.max(1, isNaN(requestedPageSize) ? 30 : requestedPageSize)
  )

  /* ── Low-stock fast path ──────────────────────────────────────────── */
  if (lowStock) {
    const searchFilter = search
      ? Prisma.sql`AND ("name" ILIKE ${`%${search}%`} OR "sku" ILIKE ${`%${search}%`} OR "barcode" ILIKE ${`%${search}%`})`
      : Prisma.empty
    const modelFilter = model
      ? Prisma.sql`AND ("compatibleModels" IS NULL OR "compatibleModels" ILIKE ${`%${model}%`})`
      : Prisma.empty
    const offset = (page - 1) * pageSize
    const [parts, countRows] = await Promise.all([
      prisma.$queryRaw<Part[]>(Prisma.sql`
        SELECT * FROM "Part"
        WHERE "isActive" = true AND "stockQty" <= "reorderLevel"
        ${searchFilter}
        ${modelFilter}
        ORDER BY name ASC
        LIMIT ${pageSize} OFFSET ${offset}
      `),
      prisma.$queryRaw<[{ count: bigint }]>(Prisma.sql`
        SELECT COUNT(*) as count FROM "Part"
        WHERE "isActive" = true AND "stockQty" <= "reorderLevel"
        ${searchFilter}
        ${modelFilter}
      `),
    ])
    const partsWithFlag = parts.map(p => ({
      ...serializeDecimals(p),
      isLowStock: true,
    }))
    return apiSuccess({
      parts: partsWithFlag,
      total: Number(countRows[0].count),
      page,
      pageSize,
    })
  }

  /* ── Standard path ────────────────────────────────────────────────── */
  const andClauses: Prisma.PartWhereInput[] = []

  if (search) {
    andClauses.push({
      OR: [
        { name: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
      ],
    })
  }

  if (model) {
    // compatibleModels is a comma-separated string; null means "all models"
    andClauses.push({
      OR: [
        { compatibleModels: null },
        { compatibleModels: { contains: model, mode: 'insensitive' } },
      ],
    })
  }

  const where: Prisma.PartWhereInput = {
    isActive: true,
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  }

  const [parts, total] = await Promise.all([
    prisma.part.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.part.count({ where }),
  ])

  const partsWithFlag = parts.map(p => ({
    ...serializeDecimals(p),
    isLowStock: p.stockQty <= p.reorderLevel,
  }))

  return apiSuccess({ parts: partsWithFlag, total, page, pageSize })
})


export const POST = withErrorHandler(async (req: NextRequest) => {
  const user = await requireAuth('parts:manage')

  const { data, error } = await parseBody(req, createPartSchema)
  if (error) return error

  const part = await prisma.part.create({ data })

  await logAudit({
    userId: user.id,
    action: 'part.created',
    entityType: 'Part',
    entityId: part.id,
    newValue: { sku: part.sku, name: part.name, stockQty: 0 },
  })

  return apiSuccess(serializeDecimals(part), 201)
})


/**
 * Convert any Prisma Decimal fields on a Part to plain numbers so the
 * response is JSON-friendly and client components don't have to deal
 * with Decimal / { d: [...] } shape.
 */
function serializeDecimals<T extends { unitCost?: unknown; retailPrice?: unknown }>(
  part: T
): T & { unitCost: number | null; retailPrice: number | null } {
  return {
    ...part,
    unitCost:
      part.unitCost == null ? null : Number(part.unitCost as Prisma.Decimal),
    retailPrice:
      part.retailPrice == null
        ? null
        : Number(part.retailPrice as Prisma.Decimal),
  }
}