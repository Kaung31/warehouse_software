import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Btn from '@/components/ui/Btn'
import StatusBadge from '@/components/ui/StatusBadge'
import StatusTimeline from '@/components/cases/StatusTimeline'
import CommentsThread from '@/components/cases/CommentsThread'
import InboundPanel from '@/components/cases/InboundPanel'
import CSActionPanel from '@/components/cases/CSActionPanel'
import MechanicPanel from '@/components/cases/MechanicPanel'
import DispatchPanel from '@/components/cases/DispatchPanel'
import QCChecklistForm from '@/components/cases/QCChecklistForm'
import CasePhotos from '@/components/cases/CasePhotos'
import DeleteCaseButton from '@/components/cases/DeleteCaseButton'
import QRCodeDisplay from '@/components/ui/QRCodeDisplay'
import LocationPicker from '@/components/cases/LocationPicker'
import BgradeInboundPanel from '@/components/cases/BgradeInboundPanel'
import StageTracker from '@/components/cases/StageTracker'
import { paymentInfoFromCase } from '@/lib/paymentInfo'

/**
 * Case detail page — WARRANTY only (BGRADE redirected to /b-grade/[id]).
 *
 * v2 changes (April 2026):
 *   • Hero card on top: scooter thumbnail · order # · brand/model · customer name
 *     · status badge · stage pipeline. Single scannable card that establishes
 *     case identity. Replaces the cramped PageHeader with action buttons.
 *   • Stage pipeline visible to ALL roles at the top of the page.
 *     The action panel area (middle column) shows either the role-owned
 *     panel (e.g. MechanicPanel) OR a contextual notice for non-owning roles
 *     (StageTracker is no longer used as a giant fallback — its data is
 *     now in the hero card; non-owners just see the action panel area
 *     replaced by a friendly "stage owned by X" message).
 *   • All emoji icons replaced with inline SVGs (printer, check, alert,
 *     arrow-left, x, etc.).
 *   • Inline-style soup replaced with .eyebrow / .ir / .ik / .iv classes
 *     and the new .qci pass/fail QC step rows from globals.css.
 *   • QC report redesigned: each step rendered with .qci row classes,
 *     overall pass/fail uses .badge instead of bordered inline pill.
 *   • "Print label" button uses the printer icon.
 *   • "Back to cases" button uses the arrow-left icon.
 *   • Layout simplified: 3-column grid with cleaner gaps and padding.
 *   • Customer prepaid / barcode flags use semantic SVG icons.
 *   • Section labels are .eyebrow (consistent with rest of app).
 *
 * Note: New workflow states (CS_TRIAGE, INBOUND_DIAGNOSIS, CS_RECHARGE)
 * will be added in Phase 3 along with their action panels. For now, this
 * page handles the existing RepairStatus enum values exactly as before.
 */

const caseInclude = {
  scooter: true,
  customer: true,
  mechanic: { select: { id: true, name: true, role: true } },
  statusHistory: {
    orderBy: { createdAt: 'asc' as const },
    include: { changedBy: { select: { name: true, role: true } } },
  },
  comments: {
    orderBy: { createdAt: 'asc' as const },
    include: { author: { select: { name: true, role: true } } },
  },
  repairParts: { include: { part: true } },
  errorCodes: true,
  invoice: true,
  qcSubmissions: {
    orderBy: { submittedAt: 'desc' as const },
    take: 1,
    include: {
      results: { include: { template: true } },
      submittedBy: { select: { name: true } },
    },
  },
  currentLocation: { select: { id: true, name: true, code: true, type: true } },
  currentPallet: { select: { id: true, palletNumber: true, locationCode: true } },
} satisfies Prisma.RepairOrderInclude

type CaseDetail = Prisma.RepairOrderGetPayload<{ include: typeof caseInclude }>


/* ─── Status → pipeline mapping (matches StageTracker / KanbanBoard) ─ */

const STATUS_TO_STEP: Record<
  string,
  { step: 0 | 1 | 2 | 3 | 4 | -1; loopback?: boolean }
> = {
  AWAITING_INBOUND: { step: 0 },
  AWAITING_CS: { step: 1 },
  DISPUTED: { step: 1, loopback: true },
  WAITING_FOR_MECHANIC: { step: 2 },
  IN_REPAIR: { step: 2 },
  AWAITING_PARTS: { step: 2 },
  QC_FAILED: { step: 2, loopback: true },
  QUALITY_CONTROL: { step: 3 },
  READY_TO_SHIP: { step: 3 },
  DISPATCHED: { step: 4 },
  BGRADE_RECORDED: { step: 4 },
  CANCELLED: { step: -1 },
  // Forward-compat (Phase 3) — render correctly even before migration
  NEW: { step: 1 },
  CS_TRIAGE: { step: 1 },
  QUOTE_SENT: { step: 1 },
  AWAITING_PICKUP: { step: 1 },
  IN_TRANSIT: { step: 1 },
  INBOUND_DIAGNOSIS: { step: 0 },
  CS_RECHARGE: { step: 1, loopback: true },
  DELIVERED: { step: 4 },
  RECEIVED: { step: 0 },
  DIAGNOSING: { step: 2 },
  QUALITY_CHECK: { step: 3 },
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

type IconName =
  | 'printer'
  | 'arrow-left'
  | 'check'
  | 'alert'
  | 'x'
  | 'qr'
  | 'pin'
  | 'wrench'
  | 'eye'
  | 'edit'

function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  const p = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'printer':
      return (
        <svg {...p}>
          <polyline points="6 9 6 2 18 2 18 9" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
      )
    case 'arrow-left':
      return (
        <svg {...p}>
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      )
    case 'check':
      return (
        <svg {...p}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )
    case 'alert':
      return (
        <svg {...p}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      )
    case 'x':
      return (
        <svg {...p}>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </svg>
      )
    case 'qr':
      return (
        <svg {...p}>
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <line x1="14" y1="14" x2="14" y2="17" />
          <line x1="14" y1="20" x2="17" y2="20" />
          <line x1="20" y1="14" x2="20" y2="14" />
          <line x1="17" y1="17" x2="20" y2="17" />
          <line x1="20" y1="20" x2="20" y2="20" />
        </svg>
      )
    case 'pin':
      return (
        <svg {...p}>
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      )
    case 'wrench':
      return (
        <svg {...p}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )
    case 'eye':
      return (
        <svg {...p}>
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case 'edit':
      return (
        <svg {...p}>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      )
    default:
      return null
  }
}


/* ─── Component ────────────────────────────────────────────────────── */

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) redirect('/dashboard')

  const { id } = await params

  const repair = (await prisma.repairOrder.findUnique({
    where: { id },
    include: caseInclude,
  })) as CaseDetail | null

  if (!repair) notFound()
  if (repair.caseType === 'BGRADE') redirect(`/b-grade/${id}`)

  const rep = repair as CaseDetail

  const qcTemplates = await prisma.qCChecklistTemplate.findMany({
    where: { isActive: true },
    orderBy: { stepNumber: 'asc' },
  })

  const userRole = user.role
  const canInbound = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(userRole)
  const canCS = ['ADMIN', 'MANAGER', 'CS'].includes(userRole)
  const canMechanic = ['ADMIN', 'MANAGER', 'MECHANIC'].includes(userRole)
  const canQC = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(userRole)
  const canDispatch = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(userRole)
  const canComment = ['ADMIN', 'MANAGER', 'CS', 'MECHANIC', 'WAREHOUSE'].includes(
    userRole
  )

  const status = rep.status
  const latestQC = rep.qcSubmissions[0] ?? null
  const stage = STATUS_TO_STEP[status] ?? { step: -1 as -1 }

  const trackerProps = {
    status,
    mechanicName: rep.mechanic?.name ?? null,
    startedAt: rep.repairStartedAt ? rep.repairStartedAt.toISOString() : null,
    userRole,
  }

  const initials = (rep.scooter.brand[0] + rep.scooter.model[0]).toUpperCase()
  const isInRepair = status === 'IN_REPAIR'

  function ActionPanel() {
    if (status === 'AWAITING_INBOUND') {
      if (!canInbound) return <StageTracker {...trackerProps} />
      if (rep.caseType === 'BGRADE') {
        return (
          <BgradeInboundPanel
            caseId={id}
            serialNumber={rep.scooter.serialNumber}
          />
        )
      }
      return (
        <InboundPanel
          caseId={id}
          serialNumber={rep.scooter.serialNumber}
          paymentInfo={paymentInfoFromCase({
            customerPrepaid: rep.customerPrepaid ?? false,
            csPaymentNote: rep.csPaymentNote ?? null,
            warrantyConfirmed: rep.warrantyConfirmed ?? false,
            quoteAmount: rep.quoteAmount ?? null,
            quotedAt: rep.quotedAt ?? null,
            quoteApprovedAt: rep.quoteApprovedAt ?? null,
            rechargeAmount: rep.rechargeAmount ?? null,
            rechargeReason: rep.rechargeReason ?? null,
            customerApprovedAt: rep.customerApprovedAt ?? null,
            invoice: rep.invoice ?? null,
          })}
        />
      )
    }

    if (status === 'AWAITING_CS' || status === 'DISPUTED') {
      if (!canCS) return <StageTracker {...trackerProps} />
      return (
        <CSActionPanel
          caseId={id}
          status={status}
          invoice={
            rep.invoice
              ? {
                  invoiceNumber: rep.invoice.invoiceNumber,
                  paymentStatus: rep.invoice.paymentStatus,
                }
              : null
          }
          customerPrepaid={rep.customerPrepaid ?? false}
          csPaymentNote={rep.csPaymentNote ?? null}
          // Bug 3: pass real recharge fields so CS sees what was found
          recharge={
            rep.rechargeOrigin && rep.rechargeReason
              ? {
                  origin: rep.rechargeOrigin,
                  reason: rep.rechargeReason,
                  requestedAt: rep.rechargeRequestedAt
                    ? rep.rechargeRequestedAt.toISOString()
                    : null,
                }
              : null
          }
        />
      )
    }

    if (
      ['WAITING_FOR_MECHANIC', 'IN_REPAIR', 'AWAITING_PARTS', 'QC_FAILED'].includes(
        status
      )
    ) {
      if (!canMechanic) return <StageTracker {...trackerProps} />
      return (
        <MechanicPanel
          caseId={id}
          status={status}
          startedAt={
            rep.repairStartedAt ? rep.repairStartedAt.toISOString() : null
          }
          repairParts={rep.repairParts.map(rp => ({
            quantity: rp.quantity,
            part: {
              ...rp.part,
              unitCost: rp.part.unitCost ? Number(rp.part.unitCost) : null,
            },
          }))}
          userRole={userRole}
          mechanicId={rep.mechanicId}
          scooterModel={rep.scooter.model}
          caseType={rep.caseType ?? 'WARRANTY'}
          paymentInfo={paymentInfoFromCase({
            customerPrepaid: rep.customerPrepaid ?? false,
            csPaymentNote: rep.csPaymentNote ?? null,
            warrantyConfirmed: rep.warrantyConfirmed ?? false,
            quoteAmount: rep.quoteAmount ?? null,
            quotedAt: rep.quotedAt ?? null,
            quoteApprovedAt: rep.quoteApprovedAt ?? null,
            rechargeAmount: rep.rechargeAmount ?? null,
            rechargeReason: rep.rechargeReason ?? null,
            customerApprovedAt: rep.customerApprovedAt ?? null,
            invoice: rep.invoice ?? null,
          })}
        />
      )
    }

    if (status === 'QUALITY_CONTROL') {
      if (!canQC) return <StageTracker {...trackerProps} />
      return (
        <div>
          <div className="eyebrow" style={{ marginBottom: 14 }}>
            QC checklist
          </div>
          <QCChecklistForm
            caseId={id}
            templates={qcTemplates}
            caseType={rep.caseType ?? 'WARRANTY'}
          />
        </div>
      )
    }

    if (status === 'READY_TO_SHIP') {
      if (!canDispatch) return <StageTracker {...trackerProps} />
      return <DispatchPanel caseId={id} repairId={id} status={status} />
    }

    if (status === 'DISPATCHED') {
      return <DispatchPanel caseId={id} repairId={id} status={status} />
    }

    if (status === 'BGRADE_RECORDED') {
      return (
        <div className="empty-state" style={{ padding: '24px 16px' }}>
          <div className="empty-state-icon">
            <Icon name="check" size={20} />
          </div>
          <div className="empty-state-title">B-Grade case recorded</div>
          <div className="empty-state-msg">
            Awaiting mechanic assessment or QC.
          </div>
        </div>
      )
    }

    return null
  }

  return (
    <div className="fade-up">
      {/* ── Top bar: action buttons only ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <Link href="/cases">
          <Btn
            variant="ghost"
            size="sm"
            iconLeft={<Icon name="arrow-left" size={13} />}
          >
            All cases
          </Btn>
        </Link>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Link href={`/cases/${id}/label`}>
            <Btn
              variant="secondary"
              size="sm"
              iconLeft={<Icon name="printer" size={13} />}
            >
              Print label
            </Btn>
          </Link>
          {['ADMIN', 'MANAGER'].includes(userRole) &&
            !['DISPATCHED', 'CANCELLED'].includes(status) && (
              <DeleteCaseButton
                caseId={id}
                orderNumber={rep.orderNumber}
                status={status}
              />
            )}
        </div>
      </div>

      {/* ── Persistent context bar (only when In Repair) ── */}
      {isInRepair && rep.mechanic && rep.repairStartedAt && (
        <div
          className="context-bar"
          style={{ borderRadius: 'var(--radius)', marginBottom: 14, top: 0 }}
        >
          <Icon name="wrench" size={14} />
          <span className="context-bar-id">{rep.orderNumber}</span>
          <span style={{ opacity: 0.7 }}>·</span>
          <span>In repair by {rep.mechanic.name}</span>
          <span style={{ marginLeft: 'auto' }} className="mono">
            Started{' '}
            {new Date(rep.repairStartedAt).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      )}

      {/* ── Hero card: case identity ── */}
      <div
        className="card"
        style={{
          padding: '20px 22px',
          marginBottom: 18,
          display: 'grid',
          gridTemplateColumns: '64px 1fr auto',
          gap: 16,
          alignItems: 'center',
        }}
      >
        {/* Scooter thumbnail */}
        <div
          className="thumb thumb-lg"
          style={{
            background: 'var(--accent-dim)',
            color: 'var(--accent-text)',
            fontFamily: 'var(--font-mono)',
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          {initials}
        </div>

        {/* Identity */}
        <div style={{ minWidth: 0 }}>
          <div
            className="eyebrow"
            style={{
              fontFamily: 'var(--font-mono)',
              color: 'var(--accent-text)',
              marginBottom: 4,
            }}
          >
            {rep.orderNumber}
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--text)',
              letterSpacing: '-0.01em',
            }}
          >
            {rep.scooter.brand} {rep.scooter.model}
          </div>
          <div
            style={{
              fontSize: 13,
              color: 'var(--sub)',
              marginTop: 2,
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <span className="mono">{rep.scooter.serialNumber}</span>
            {rep.customer && (
              <>
                <span style={{ color: 'var(--text-faint)' }}>·</span>
                <span>{rep.customer.name}</span>
              </>
            )}
          </div>
        </div>

        {/* Status */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 6,
          }}
        >
          <StatusBadge status={status} />
          <span
            style={{
              fontSize: 11,
              color: 'var(--sub)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {rep.priority}
          </span>
        </div>
      </div>

      {/* ── Pipeline visible to all roles ── */}
      <div className="card" style={{ padding: '14px 22px', marginBottom: 18 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            marginBottom: 6,
          }}
        >
          {[
            { step: 0, label: 'Intake' },
            { step: 1, label: 'CS' },
            { step: 2, label: 'Repair' },
            { step: 3, label: 'QC' },
            { step: 4, label: 'Done' },
          ].map(p => (
            <div
              key={p.step}
              className="pl-label"
              style={{
                color:
                  p.step === stage.step
                    ? stage.loopback
                      ? 'var(--red-text)'
                      : 'var(--accent)'
                    : 'var(--text-faint)',
                fontWeight: p.step === stage.step ? 600 : 500,
              }}
            >
              {p.label}
            </div>
          ))}
        </div>
        <div className="pipeline">
          {[0, 1, 2, 3, 4].map((i, idx) => {
            const done = stage.step >= 0 && i < stage.step
            const current = i === stage.step
            const failed = stage.loopback && current
            const dotClass = failed
              ? 'failed'
              : done
              ? 'done'
              : current
              ? 'current'
              : ''
            const lineClass =
              i < 4 && stage.step >= 0 && i < stage.step ? 'done' : ''
            return (
              <div key={i} style={{ display: 'contents' }}>
                <span className={`pl-dot ${dotClass}`} />
                {idx < 4 && <span className={`pl-line ${lineClass}`} />}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Main 3-column layout ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '280px 1fr 320px',
          gap: 18,
          alignItems: 'flex-start',
        }}
      >
        {/* ─── LEFT: case info + customer + timeline ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Case info */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Case info
            </div>
            <div className="ir">
              <span className="ik">Type</span>
              <span className="iv">
                <StatusBadge status={rep.caseType} type="case" />
              </span>
            </div>
            <div className="ir">
              <span className="ik">Priority</span>
              <span className="iv">
                <StatusBadge status={rep.priority} type="priority" />
              </span>
            </div>
            <div className="ir">
              <span className="ik">Created</span>
              <span className="iv mono">
                {new Date(rep.createdAt).toLocaleDateString('en-GB')}
              </span>
            </div>
            <div className="ir">
              <span className="ik">Mechanic</span>
              <span className="iv">
                {rep.mechanic?.name ?? (
                  <span style={{ color: 'var(--text-faint)' }}>Unassigned</span>
                )}
              </span>
            </div>
            {rep.customerPrepaid && (
              <div className="ir">
                <span className="ik">Pre-paid</span>
                <span
                  className="iv"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    color: 'var(--green-text)',
                  }}
                >
                  <Icon name="check" size={12} />
                  Customer paid
                </span>
              </div>
            )}
            <div className="ir">
              <span className="ik">Barcode</span>
              <span
                className="iv"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  color: rep.barcodeAssigned
                    ? 'var(--green-text)'
                    : 'var(--amber-text)',
                }}
              >
                <Icon
                  name={rep.barcodeAssigned ? 'check' : 'alert'}
                  size={12}
                />
                {rep.barcodeAssigned ? 'Attached' : 'Not printed'}
              </span>
            </div>
            {/* CS Note moved to PaymentInfoBanner — was duplicating data
                shown in the inbound/mechanic payment notes (Bug 1 fix). */}
          </div>

          {/* Location */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Location
            </div>
            <LocationPicker
              caseId={id}
              currentLocation={rep.currentLocation}
              canEdit={['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(userRole)}
            />
            {rep.rackLocation && (
              <div className="ir" style={{ marginTop: 8 }}>
                <span className="ik">Rack</span>
                <span className="iv mono">{rep.rackLocation}</span>
              </div>
            )}
            {rep.currentPallet && (
              <div className="ir">
                <span className="ik">Pallet</span>
                <span className="iv">
                  <Link
                    href={`/pallets/${rep.currentPallet.id}`}
                    style={{
                      textDecoration: 'none',
                      color: 'var(--accent-text)',
                    }}
                    className="mono"
                  >
                    {rep.currentPallet.palletNumber}
                  </Link>
                </span>
              </div>
            )}
          </div>

          {/* QR code */}
          <div
            className="card"
            style={{
              padding: '18px 20px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div className="eyebrow" style={{ marginBottom: 10, alignSelf: 'flex-start' }}>
              Repair ticket QR
            </div>
            <QRCodeDisplay
              value={rep.orderNumber}
              size={140}
              label={rep.orderNumber}
            />
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-faint)',
                marginTop: 8,
                textAlign: 'center',
              }}
            >
              Scan to open this case
            </div>
          </div>

          {/* Customer */}
          {rep.customer && (
            <div className="card" style={{ padding: '18px 20px' }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Customer
              </div>
              <div className="ir">
                <span className="ik">Name</span>
                <span className="iv">{rep.customer.name}</span>
              </div>
              {rep.customer.email && (
                <div className="ir">
                  <span className="ik">Email</span>
                  <span className="iv" style={{ fontSize: 12 }}>
                    {rep.customer.email}
                  </span>
                </div>
              )}
              {rep.customer.phone && (
                <div className="ir">
                  <span className="ik">Phone</span>
                  <span className="iv mono">{rep.customer.phone}</span>
                </div>
              )}
              {rep.customer.postcode && (
                <div className="ir">
                  <span className="ik">Postcode</span>
                  <span className="iv mono">{rep.customer.postcode}</span>
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                <Link
                  href={`/customers/${rep.customer.id}`}
                  style={{
                    fontSize: 12,
                    color: 'var(--accent-text)',
                    textDecoration: 'none',
                  }}
                >
                  View customer →
                </Link>
              </div>
            </div>
          )}

          {/* Error codes */}
          {rep.errorCodes.length > 0 && (
            <div className="card" style={{ padding: '18px 20px' }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Error codes
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {rep.errorCodes.map(ec => (
                  <span
                    key={ec.id}
                    className="mono"
                    style={{
                      padding: '3px 10px',
                      fontSize: 11,
                      fontWeight: 500,
                      border: '1px solid var(--border)',
                      borderRadius: 999,
                      background: 'var(--s2)',
                      color: 'var(--sub)',
                    }}
                  >
                    {ec.errorCode}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Fault description */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Fault description
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text)',
                lineHeight: 1.55,
                whiteSpace: 'pre-wrap',
              }}
            >
              {rep.faultDescription}
            </div>
            {rep.internalNotes && (
              <>
                <div
                  className="eyebrow"
                  style={{ marginTop: 14, marginBottom: 4 }}
                >
                  Internal notes
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--sub)',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.55,
                  }}
                >
                  {rep.internalNotes}
                </div>
              </>
            )}
          </div>
        </div>

        {/* ─── MIDDLE: action panel + parts + photos ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: '20px 22px' }}>
            <ActionPanel />
          </div>

          {/* Parts used */}
          {rep.repairParts.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <div
                style={{
                  padding: '14px 20px 10px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div className="eyebrow">Parts used</div>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--sub)' }}
                >
                  {rep.repairParts.length} item
                  {rep.repairParts.length !== 1 ? 's' : ''}
                </span>
              </div>
              <table className="data-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Part</th>
                    <th>SKU</th>
                    <th>Location</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {rep.repairParts.map(rp => (
                    <tr key={rp.part.id}>
                      <td style={{ fontSize: 13 }}>{rp.part.name}</td>
                      <td>
                        <span className="mono" style={{ fontSize: 11 }}>
                          {rp.part.sku}
                        </span>
                      </td>
                      <td>
                        {rp.part.warehouseLocation ? (
                          <span
                            className="mono"
                            style={{ fontSize: 11, color: 'var(--sub)' }}
                          >
                            {rp.part.warehouseLocation}
                          </span>
                        ) : (
                          <span
                            style={{ fontSize: 11, color: 'var(--text-faint)' }}
                          >
                            —
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          fontSize: 13,
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        ×{rp.quantity}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* QC report */}
          {latestQC && (
            <div className="card" style={{ padding: '18px 22px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 14,
                }}
              >
                <div>
                  <div className="eyebrow">QC report</div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--sub)',
                      marginTop: 2,
                    }}
                  >
                    By {latestQC.submittedBy.name}
                  </div>
                </div>
                <span
                  className={`badge ${rep.qcPassed ? 'badge-pass' : 'badge-fail'}`}
                  style={{ fontSize: 12, fontWeight: 600 }}
                >
                  <Icon name={rep.qcPassed ? 'check' : 'x'} size={11} />
                  {rep.qcPassed ? 'PASS' : 'FAIL'}
                </span>
              </div>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
              >
                {latestQC.results
                  .sort(
                    (a, b) =>
                      (a.template.stepNumber ?? 0) - (b.template.stepNumber ?? 0)
                  )
                  .map(r2 => (
                    <div
                      key={r2.id}
                      className={`qci ${
                        r2.result === 'PASS'
                          ? 'pass'
                          : r2.result === 'FAIL'
                          ? 'fail'
                          : ''
                      }`}
                    >
                      <span className="qci-num">{r2.template.stepNumber}</span>
                      <span className="qci-text">{r2.template.stepName}</span>
                      <StatusBadge status={r2.result} type="qc" />
                      {r2.notes && (
                        <div
                          style={{
                            width: '100%',
                            fontSize: 11,
                            color: 'var(--red-text)',
                            marginTop: 4,
                            paddingLeft: 30,
                          }}
                        >
                          {r2.notes}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Photos */}
          <CasePhotos caseId={id} />
        </div>

        {/* ─── RIGHT: timeline + comments ─── */}
        <div
          style={{
            position: 'sticky',
            top: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {/* Timeline */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              Timeline
            </div>
            <StatusTimeline
              history={rep.statusHistory.map(h => ({
                id: h.id,
                fromStatus: h.fromStatus,
                toStatus: h.toStatus,
                reason: h.reason,
                createdAt: h.createdAt.toISOString(),
                changedBy: h.changedBy,
              }))}
            />
          </div>

          {/* Invoice */}
          {rep.invoice && (
            <div className="card" style={{ padding: '18px 20px' }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>
                Invoice
              </div>
              <div className="ir">
                <span className="ik">Reference</span>
                <span className="iv mono">
                  {rep.invoice.invoiceNumber ?? '—'}
                </span>
              </div>
              <div className="ir">
                <span className="ik">Payment</span>
                <span className="iv">
                  <StatusBadge
                    status={rep.invoice.paymentStatus}
                    type="payment"
                  />
                </span>
              </div>
            </div>
          )}

          {/* Comments */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              Comments
            </div>
            <CommentsThread
              caseId={id}
              comments={rep.comments.map(c => ({
                id: c.id,
                content: c.content,
                isCustomerFacing: c.isCustomerFacing,
                createdAt: c.createdAt.toISOString(),
                author: c.author,
              }))}
              userRole={userRole}
              canComment={canComment}
            />
          </div>
        </div>
      </div>
    </div>
  )
}