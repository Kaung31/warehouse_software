import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  requireAuth,
  apiSuccess,
  apiError,
  withErrorHandler,
} from '@/lib/api-helpers'

/**
 * POST /api/cases/[id]/comments
 *
 * Creates a new CaseComment on a repair order.
 *
 * Replaces the old pattern where comments were piggybacked on the
 * /cs-update endpoint (which is the CS payment-update endpoint and
 * shouldn't handle comments).
 *
 * Auth: any authenticated user with role in
 *       [ADMIN, MANAGER, CS, MECHANIC, WAREHOUSE]
 *
 * Request body: { content: string; isCustomerFacing: boolean }
 */
export const POST = withErrorHandler(
  async (req: NextRequest, ctx?: unknown) => {
    // Just authenticate (no specific permission). We gate on role inline
    // below since this codebase's `requireAuth` takes a single Permission
    // and "comment on case" doesn't have its own permission scope yet.
    const user = await requireAuth()

    const ALLOWED_ROLES = ['ADMIN', 'MANAGER', 'CS', 'MECHANIC', 'WAREHOUSE']
    if (!ALLOWED_ROLES.includes(user.role)) {
      return apiError('Forbidden', 403)
    }

    const { id } = await (ctx as { params: Promise<{ id: string }> }).params
    const body = await req.json().catch(() => null)

    if (!body || typeof body.content !== 'string') {
      return apiError('Missing content', 400)
    }

    const content = body.content.trim()
    if (!content) return apiError('Content cannot be empty', 400)
    if (content.length > 5000) {
      return apiError('Comment too long (max 5000 chars)', 400)
    }

    const isCustomerFacing = Boolean(body.isCustomerFacing)

    // Confirm the case exists before writing
    const found = await prisma.repairOrder.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!found) return apiError('Case not found', 404)

    const comment = await prisma.caseComment.create({
      data: {
        caseId: id,
        authorId: user.id,
        content,
        isCustomerFacing,
      },
      include: {
        author: { select: { name: true, role: true } },
      },
    })

    return apiSuccess({ comment })
  }
)