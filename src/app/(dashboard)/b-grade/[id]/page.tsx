import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import Link from 'next/link'
import Btn from '@/components/ui/Btn'
import StatusBadge from '@/components/ui/StatusBadge'
import BgradeMechanicPanel from '@/components/cases/BgradeMechanicPanel'
import QCChecklistForm from '@/components/cases/QCChecklistForm'
import LocationPicker from '@/components/cases/LocationPicker'
import DeleteCaseButton from '@/components/cases/DeleteCaseButton'
import StageTracker from '@/components/cases/StageTracker'

/**
 * B-Grade case detail page.
 *
 * v2 changes (April 2026):
 *   • Hero card matching warranty case detail style: thumbnail · order # ·
 *     brand/model · serial · grade badge · status badge.
 *   • Pipeline card visible to all roles below the hero.
 *   • Persistent context bar when status is IN_REPAIR.
 *   • 2-column layout: left sidebar with scooter info / grade / location /
 *     parts / QC; right column with the action panel.
 *   • Section labels → .eyebrow; info rows → .ir/.ik/.iv (matches warranty
 *     page and the rest of the app).
 *   • Grade card redesigned: large color-coded slab matching the
 *     BgradeMechanicPanel grade buttons (green=A / amber=B / red=C).
 *   • Source rendered as a chip (was inline accent text).
 *   • QC report uses .qci.pass/.qci.fail row classes.
 *   • Parts used as green check rows (matches MechanicPanel pattern).
 *   • BGRADE_RECORDED final state: empty-state styled block with the
 *     grade letter as the visual focal point.
 *   • All emojis (✓ ⚠ ✗ ←) replaced with inline SVG.
 *   • Removed local SectionLabel + InfoRow helpers — uses globals.css
 *     classes for consistency.
 *
 * Forward-compat: includes the new RepairStatus values from the schema
 * migration so the page renders correctly even when those statuses get
 * used by future workflow APIs.
 */

const caseInclude = {
  scooter: true,
  mechanic: { select: { id: true, name: true, role: true } },
  repairParts: { include: { part: true } },
  currentLocation: { select: { id: true, name: true, code: true, type: true } },
  currentPallet: { select: { id: true, palletNumber: true, locationCode: true } },
  qcSubmissions: {
    orderBy: { submittedAt: 'desc' as const },
    take: 1,
    include: {
      results: { include: { template: true } },
      submittedBy: { select: { name: true } },
    },
  },
} satisfies Prisma.RepairOrderInclude

type CaseDetail = Prisma.RepairOrderGetPayload<{ include: typeof caseInclude }>


/* ─── Status → pipeline step (matches warranty page + StageTracker) ── */

const STATUS_TO_STEP: Record<
  string,
  { step: 0 | 1 | 2 | 3 | 4 | -1; loopback?: boolean }
> = {
  AWAITING_INBOUND: { step: 0 },
  INBOUND_DIAGNOSIS: { step: 0 },
  AWAITING_CS: { step: 1 },
  WAITING_FOR_MECHANIC: { step: 2 },
  IN_REPAIR: { step: 2 },
  AWAITING_PARTS: { step: 2 },
  QC_FAILED: { step: 2, loopback: true },
  QUALITY_CONTROL: { step: 3 },
  READY_TO_SHIP: { step: 3 },
  BGRADE_RECORDED: { step: 4 },
  CANCELLED: { step: -1 },
}


/* ─── Grade visual mapping (match BgradeMechanicPanel) ──────────────── */

type GradeTone = 'green' | 'amber' | 'red'

const GRADE_TONES: Record<string, GradeTone> = {
  A: 'green',
  B: 'amber',
  C: 'red',
}

function gradeStyles(tone: GradeTone) {
  if (tone === 'green') {
    return {
      bg: 'var(--green-bg)',
      border: 'var(--green)',
      text: 'var(--green-text)',
      circle: 'var(--green)',
    }
  }
  if (tone === 'amber') {
    return {
      bg: 'var(--amber-bg)',
      border: 'var(--amber)',
      text: 'var(--amber-text)',
      circle: 'var(--amber)',
    }
  }
  return {
    bg: 'var(--red-bg)',
    border: 'var(--red)',
    text: 'var(--red-text)',
    circle: 'var(--red)',
  }
}


/* ─── Component ────────────────────────────────────────────────────── */

export default async function BgradeDetailPage({
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
  if (repair.caseType !== 'BGRADE') redirect(`/cases/${id}`)

  const rep = repair as CaseDetail

  const qcTemplates = await prisma.qCChecklistTemplate.findMany({
    where: { isActive: true },
    orderBy: { stepNumber: 'asc' },
  })

  const userRole = user.role
  const canMechanic = ['ADMIN', 'MANAGER', 'MECHANIC'].includes(userRole)
  const canQC = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(userRole)
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

  const grade = rep.scooter.grade ?? null
  const gradeT = grade ? GRADE_TONES[grade] : null
  const gradeS = gradeT ? gradeStyles(gradeT) : null

  return (
    <div className="fade-up">
      {/* ── Top action bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <Link href="/b-grade">
          <Btn
            variant="ghost"
            size="sm"
            iconLeft={<Icon name="arrow-left" size={13} />}
          >
            All B-Grade
          </Btn>
        </Link>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {['ADMIN', 'MANAGER'].includes(userRole) &&
            !['DISPATCHED', 'CANCELLED', 'BGRADE_RECORDED'].includes(status) && (
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
          <span>Assessment by {rep.mechanic.name}</span>
          <span style={{ marginLeft: 'auto' }} className="mono">
            Started{' '}
            {new Date(rep.repairStartedAt).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      )}

      {/* ── Hero card ── */}
      <div
        className="card"
        style={{
          padding: '20px 22px',
          marginBottom: 18,
          display: 'grid',
          gridTemplateColumns: '64px 1fr auto auto',
          gap: 16,
          alignItems: 'center',
        }}
      >
        {/* Thumbnail */}
        <div
          className="thumb thumb-lg"
          style={{
            background: 'var(--amber-bg)',
            color: 'var(--amber-text)',
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
              color: 'var(--amber-text)',
              marginBottom: 4,
            }}
          >
            {rep.orderNumber}{' '}
            <span style={{ opacity: 0.7 }}>· B-Grade</span>
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
            {rep.source && (
              <>
                <span style={{ color: 'var(--text-faint)' }}>·</span>
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    background: 'var(--accent-dim)',
                    color: 'var(--accent-text)',
                    padding: '2px 8px',
                    borderRadius: 999,
                    textTransform: 'uppercase',
                    letterSpacing: '.06em',
                    fontWeight: 500,
                  }}
                >
                  {rep.source}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Grade badge (prominent) */}
        {grade && gradeS ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 12px',
              borderRadius: 'var(--radius)',
              background: gradeS.bg,
              border: `1px solid ${gradeS.border}`,
            }}
            title={`Grade ${grade}`}
          >
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: gradeS.circle,
                color: '#fff',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {grade}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: gradeS.text,
              }}
            >
              Grade {grade}
            </span>
          </div>
        ) : (
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-faint)',
              fontStyle: 'italic',
            }}
          >
            Not graded
          </span>
        )}

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

      {/* ── Pipeline card ── */}
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
            { step: 2, label: 'Assess' },
            { step: 3, label: 'QC' },
            { step: 4, label: 'Recorded' },
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

      {/* ── 2-column layout ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '300px 1fr',
          gap: 18,
          alignItems: 'flex-start',
        }}
      >
        {/* ─── LEFT: scooter / grade / location / parts / QC ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Scooter info */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              Scooter
            </div>
            <div className="ir">
              <span className="ik">Serial</span>
              <span className="iv mono">{rep.scooter.serialNumber}</span>
            </div>
            <div className="ir">
              <span className="ik">Brand</span>
              <span className="iv">{rep.scooter.brand}</span>
            </div>
            <div className="ir">
              <span className="ik">Model</span>
              <span className="iv">{rep.scooter.model}</span>
            </div>
            <div className="ir">
              <span className="ik">Mechanic</span>
              <span className="iv">
                {rep.mechanic?.name ?? (
                  <span
                    style={{
                      color: 'var(--text-faint)',
                      fontWeight: 400,
                    }}
                  >
                    Unassigned
                  </span>
                )}
              </span>
            </div>
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
          </div>

          {/* Grade assessment card */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              Assessment
            </div>

            {grade && gradeS ? (
              <div
                style={{
                  padding: '14px 16px',
                  background: gradeS.bg,
                  border: `1.5px solid ${gradeS.border}`,
                  borderRadius: 'var(--radius)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: '50%',
                    background: gradeS.circle,
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                    flexShrink: 0,
                  }}
                >
                  {grade}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: gradeS.text,
                    }}
                  >
                    Grade {grade}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: gradeS.text,
                      opacity: 0.8,
                    }}
                  >
                    {grade === 'A' && 'Excellent condition'}
                    {grade === 'B' && 'Good condition'}
                    {grade === 'C' && 'Fair condition'}
                  </div>
                </div>
              </div>
            ) : (
              <div
                style={{
                  padding: '12px 14px',
                  background: 'var(--s2)',
                  border: '1px dashed var(--border2)',
                  borderRadius: 'var(--radius)',
                  textAlign: 'center',
                  fontSize: 12,
                  color: 'var(--text-faint)',
                  marginBottom: 12,
                }}
              >
                Awaiting mechanic grade
              </div>
            )}

            {rep.scooter.colour && (
              <div className="ir">
                <span className="ik">Colour</span>
                <span className="iv">{rep.scooter.colour}</span>
              </div>
            )}
            {rep.scooter.totalMileage != null && (
              <div className="ir">
                <span className="ik">Mileage</span>
                <span className="iv mono">
                  {rep.scooter.totalMileage.toLocaleString()} km
                </span>
              </div>
            )}
          </div>

          {/* Location / pallet */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              Location
            </div>
            <LocationPicker
              caseId={id}
              currentLocation={rep.currentLocation}
              canEdit={['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(userRole)}
            />
            {rep.currentPallet && (
              <div className="ir" style={{ marginTop: 8 }}>
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

          {/* Parts used */}
          {rep.repairParts.length > 0 && (
            <div className="card" style={{ padding: '18px 20px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                }}
              >
                <div className="eyebrow">Parts used</div>
                <span
                  className="mono"
                  style={{ fontSize: 11, color: 'var(--sub)' }}
                >
                  {rep.repairParts.length}
                </span>
              </div>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
              >
                {rep.repairParts.map(rp => (
                  <div
                    key={rp.part.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px 12px',
                      background: 'var(--green-bg)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--green-b)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span
                        style={{
                          color: 'var(--green-text)',
                          display: 'inline-flex',
                          flexShrink: 0,
                        }}
                      >
                        <Icon name="check" size={12} />
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--text)',
                          fontWeight: 500,
                        }}
                      >
                        {rp.part.name}
                      </span>
                    </div>
                    <span
                      className="mono"
                      style={{
                        fontSize: 12,
                        color: 'var(--green-text)',
                        fontWeight: 600,
                      }}
                    >
                      ×{rp.quantity}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* QC report */}
          {latestQC && (
            <div className="card" style={{ padding: '18px 20px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <div>
                  <div className="eyebrow">QC report</div>
                  <div
                    style={{
                      fontSize: 11,
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
        </div>

        {/* ─── RIGHT: action panel ─── */}
        <div className="card" style={{ padding: '20px 22px' }}>
          {/* Mechanic stages */}
          {[
            'WAITING_FOR_MECHANIC',
            'IN_REPAIR',
            'AWAITING_PARTS',
            'QC_FAILED',
          ].includes(status) &&
            (canMechanic ? (
              <BgradeMechanicPanel
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
                scooterColour={rep.scooter.colour}
                scooterGrade={rep.scooter.grade}
                scooterMileage={rep.scooter.totalMileage}
                source={rep.source}
              />
            ) : (
              <StageTracker {...trackerProps} />
            ))}

          {/* QC stage */}
          {status === 'QUALITY_CONTROL' &&
            (canQC ? (
              <div>
                <div className="eyebrow" style={{ marginBottom: 14 }}>
                  QC checklist
                </div>
                <QCChecklistForm
                  caseId={id}
                  templates={qcTemplates}
                  caseType="BGRADE"
                />
              </div>
            ) : (
              <StageTracker {...trackerProps} />
            ))}

          {/* Recorded final state */}
          {status === 'BGRADE_RECORDED' && (
            <div className="empty-state" style={{ padding: '24px 16px' }}>
              {grade && gradeS ? (
                <div
                  style={{
                    width: 64,
                    height: 64,
                    margin: '0 auto 12px',
                    borderRadius: '50%',
                    background: gradeS.circle,
                    color: '#fff',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 28,
                    fontWeight: 600,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {grade}
                </div>
              ) : (
                <div className="empty-state-icon">
                  <Icon name="check" size={20} />
                </div>
              )}
              <div className="empty-state-title">B-Grade recorded</div>
              <div className="empty-state-msg">
                Assessment complete. Ready for inventory or dispatch.
              </div>
            </div>
          )}

          {/* Inbound waiting */}
          {status === 'AWAITING_INBOUND' && (
            <div className="empty-state" style={{ padding: '24px 16px' }}>
              <div className="empty-state-icon">
                <Icon name="inbox" size={20} />
              </div>
              <div className="empty-state-title">Awaiting inbound</div>
              <div className="empty-state-msg">
                Waiting for the scooter to be received and scanned at the
                warehouse.
              </div>
            </div>
          )}

          {/* Dispatched (rare for BGRADE but possible) */}
          {['DISPATCHED', 'CANCELLED'].includes(status) && (
            <StageTracker {...trackerProps} />
          )}
        </div>
      </div>
    </div>
  )
}


/* ─── Inline icons ─────────────────────────────────────────────────── */

type IconName =
  | 'arrow-left'
  | 'check'
  | 'alert'
  | 'x'
  | 'inbox'
  | 'wrench'

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
    case 'arrow-left':
      return (
        <svg {...p}>
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="12 19 5 12 12 5" />
        </svg>
      )
    case 'check':
      return (
        <svg {...p} strokeWidth="2">
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
        <svg {...p} strokeWidth="2">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </svg>
      )
    case 'inbox':
      return (
        <svg {...p}>
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </svg>
      )
    case 'wrench':
      return (
        <svg {...p}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      )
    default:
      return null
  }
}