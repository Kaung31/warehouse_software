import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/auth'
import { paymentInfoFromCase } from '@/lib/paymentInfo'
import JobClient from '@/components/workshop/JobClient'

/**
 * /workshop/job/[id] — repair workspace.
 *
 * Single-column scroll layout, mobile/tablet friendly. The mechanic
 * spends most of their time here while a job is open: ticking off
 * repair tasks, logging parts, jotting notes.
 *
 * Auth & gating:
 *   - Must be authenticated.
 *   - The case must be assigned to the calling mechanic, OR the caller
 *     must be ADMIN/MANAGER (so admins/managers can shadow a case).
 *   - The case must be in an "active repair" status; otherwise we bounce
 *     back to /workshop. (We don't want this page to render a stale
 *     workspace for a case that's already gone to QC, etc.)
 */

const ACTIVE_REPAIR_STATUSES: readonly string[] = [
  'IN_REPAIR',
  // We tolerate AWAITING_PARTS so the page can render briefly between
  // pause and the redirect — but we'll likely hide actions in that state.
  'AWAITING_PARTS',
  'QC_FAILED',
]

type Ctx = { params: Promise<{ id: string }> }

export default async function JobPage(ctx: Ctx) {
  const { id } = await ctx.params

  const user = await getCurrentUser()
  if (!user) redirect('/sign-in')

  const c = await prisma.repairOrder.findUnique({
    where: { id },
    include: {
      scooter:  { select: { brand: true, model: true, serialNumber: true } },
      customer: { select: { name: true } },
      mechanic: { select: { id: true, name: true } },
      invoice:  true,
      errorCodes: { orderBy: { createdAt: 'asc' } },
      currentLocation: { select: { id: true, name: true, code: true } },
      repairParts: {
        include: {
          part: {
            select: {
              id: true, name: true, sku: true, barcode: true,
              stockQty: true, warehouseLocation: true, unitCost: true,
            },
          },
        },
      },
      tasks: {
        orderBy: { order: 'asc' },
        include: {
          completedBy: { select: { id: true, name: true } },
        },
      },
    },
  })

  if (!c) notFound()

  /* ── Repair guides matching the scooter's model ──────────────────── */
  // Match is case-insensitive substring on either direction so we catch
  // model name variants (e.g. "Pure Air Pro 2" matches a guide for
  // "Pure Air Pro" — the brake-pad steps overlap). The `mode: 'insensitive'`
  // postgres-citext fallback handles casing without us normalising.
  const guideRows = await prisma.repairGuide.findMany({
    where: {
      OR: [
        { scooterModel: { contains: c.scooter.model, mode: 'insensitive' } },
        { scooterModel: { in: [c.scooter.model] } },
      ],
    },
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
    select: {
      id:           true,
      title:        true,
      category:     true,
      scooterModel: true,
      brand:        true,
    },
  })

  /* ── Compatible parts for this scooter (item #5) ─────────────────── */
  // The catalog stores compatibleModels as a comma-separated string. We
  // can't do a structured match in Prisma, so we filter in-memory after
  // fetching the active-parts shortlist. For a small parts table (~12)
  // this is perfectly fine; we'd revisit if it grows by orders of
  // magnitude.
  const allActiveParts = await prisma.part.findMany({
    where:  { isActive: true },
    select: {
      id:                true,
      sku:               true,
      name:              true,
      compatibleModels:  true,
      stockQty:          true,
      reorderLevel:      true,
      warehouseLocation: true,
    },
    orderBy: { name: 'asc' },
  })
  const modelLc = c.scooter.model.toLowerCase()
  const compatibleParts = allActiveParts
    .filter((p) =>
      (p.compatibleModels ?? '')
        .split(',')
        .some((m) => {
          const t = m.trim().toLowerCase()
          return t.length > 0 && (modelLc.includes(t) || t.includes(modelLc))
        }),
    )
    .map((p) => ({
      id:                p.id,
      sku:               p.sku,
      name:              p.name,
      stockQty:          p.stockQty,
      reorderLevel:      p.reorderLevel,
      warehouseLocation: p.warehouseLocation,
    }))

  // Mechanic gate: must be the assigned mechanic, or admin/manager.
  const isOwnerMechanic =
    user.role === 'MECHANIC' && c.mechanicId === user.id
  const isAdminOrManager =
    user.role === 'ADMIN' || user.role === 'MANAGER'
  if (!isOwnerMechanic && !isAdminOrManager) redirect('/workshop')

  // Status gate: if the case has moved out of an active repair stage,
  // there's nothing to do here — bounce back to the queue.
  if (!ACTIVE_REPAIR_STATUSES.includes(c.status)) redirect('/workshop')

  /* ── Serialise to plain JSON for the client island ───────────────── */
  const job = {
    id:                c.id,
    orderNumber:       c.orderNumber,
    caseType:          c.caseType,
    status:            c.status,
    scooter: {
      brand:        c.scooter.brand,
      model:        c.scooter.model,
      serialNumber: c.scooter.serialNumber,
    },
    location: {
      // Prefer the human rackLocation if the inbound team set one,
      // otherwise fall back to the WarehouseLocation.code/name.
      label:
        c.rackLocation
        ?? c.currentLocation?.code
        ?? c.currentLocation?.name
        ?? null,
      name: c.currentLocation?.name ?? null,
    },
    customerName:      c.customer?.name ?? null,
    faultDescription:  c.faultDescription,
    diagnosis:         c.diagnosis,
    internalNotes:     c.internalNotes,
    errorCodes:        c.errorCodes.map((ec) => ec.errorCode),
    repairStartedAt:   c.repairStartedAt?.toISOString() ?? null,
    createdAt:         c.createdAt.toISOString(),
    rechargeReason:    c.rechargeReason,
    customerApprovedAt: c.customerApprovedAt?.toISOString() ?? null,
    payment: paymentInfoFromCase({
      customerPrepaid:    c.customerPrepaid,
      csPaymentNote:      c.csPaymentNote,
      warrantyConfirmed:  c.warrantyConfirmed,
      quoteAmount:        c.quoteAmount,
      quotedAt:           c.quotedAt,
      quoteApprovedAt:    c.quoteApprovedAt,
      rechargeAmount:     c.rechargeAmount,
      rechargeReason:     c.rechargeReason,
      customerApprovedAt: c.customerApprovedAt,
      invoice:            c.invoice,
    }),
    tasks: c.tasks.map((t) => ({
      id:            t.id,
      title:         t.title,
      notes:         t.notes,
      order:         t.order,
      completedAt:   t.completedAt?.toISOString() ?? null,
      completedById: t.completedById,
      completedBy:   t.completedBy
        ? { id: t.completedBy.id, name: t.completedBy.name }
        : null,
    })),
    repairParts: c.repairParts.map((rp) => ({
      partId:           rp.partId,
      quantity:         rp.quantity,
      name:             rp.part.name,
      sku:              rp.part.sku,
      barcode:          rp.part.barcode,
      stockQty:         rp.part.stockQty,
      warehouseLocation: rp.part.warehouseLocation,
      unitCost:         rp.part.unitCost ? Number(rp.part.unitCost.toString()) : null,
    })),
    compatibleParts,
    guides: guideRows,
  }

  return <JobClient job={job} currentUserId={user.id} />
}
