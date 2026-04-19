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

const caseInclude = {
  scooter:  true,
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
  errorCodes:  true,
  invoice:     true,
  qcSubmissions: {
    orderBy: { submittedAt: 'desc' as const },
    take: 1,
    include: {
      results:     { include: { template: true } },
      submittedBy: { select: { name: true } },
    },
  },
} satisfies Prisma.RepairOrderInclude

type CaseDetail = Prisma.RepairOrderGetPayload<{ include: typeof caseInclude }>

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

  const repair = await prisma.repairOrder.findUnique({
    where:   { id },
    include: caseInclude,
  }) as CaseDetail | null

  if (!repair) notFound()

  const rep = repair as CaseDetail

  const qcTemplates = await prisma.qCChecklistTemplate.findMany({
    where:   { isActive: true },
    orderBy: { stepNumber: 'asc' },
  })

  const userRole     = user!.role
  const canInbound   = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(userRole)
  const canCS        = ['ADMIN', 'MANAGER', 'CS'].includes(userRole)
  const canMechanic  = ['ADMIN', 'MANAGER', 'MECHANIC'].includes(userRole)
  const canQC        = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(userRole)
  const canDispatch  = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(userRole)
  const canComment   = ['ADMIN', 'MANAGER', 'CS', 'MECHANIC', 'WAREHOUSE'].includes(userRole)

  const status   = rep.status
  const latestQC = rep.qcSubmissions[0] ?? null

  function ActionPanel() {
    if (status === 'AWAITING_INBOUND') {
      if (!canInbound) return <RoleGate />
      return <InboundPanel caseId={id} />
    }

    if (status === 'AWAITING_CS' || status === 'DISPUTED') {
      if (!canCS) return <RoleGate />
      return (
        <CSActionPanel
          caseId={id}
          status={status}
          invoice={rep.invoice
            ? { invoiceNumber: rep.invoice.invoiceNumber, paymentStatus: rep.invoice.paymentStatus }
            : null}
        />
      )
    }

    if (status === 'WAITING_FOR_MECHANIC' || status === 'IN_REPAIR' || status === 'QC_FAILED') {
      if (!canMechanic) return <RoleGate />
      return (
        <MechanicPanel
          caseId={id}
          status={status}
          startedAt={rep.repairStartedAt ? rep.repairStartedAt.toISOString() : null}
          repairParts={rep.repairParts as Parameters<typeof MechanicPanel>[0]['repairParts']}
          userRole={userRole}
        />
      )
    }

    if (status === 'QUALITY_CONTROL') {
      if (!canQC) return <RoleGate />
      return (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
            QC Checklist
          </div>
          <QCChecklistForm caseId={id} templates={qcTemplates} />
        </div>
      )
    }

    if (status === 'READY_TO_SHIP') {
      if (!canDispatch) return <RoleGate />
      return <DispatchPanel caseId={id} repairId={id} status={status} />
    }

    if (status === 'DISPATCHED') {
      return <DispatchPanel caseId={id} repairId={id} status={status} />
    }

    if (status === 'BGRADE_RECORDED') {
      return (
        <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          B-Grade case recorded — awaiting mechanic assessment or QC.
        </div>
      )
    }

    return null
  }

  return (
    <div className="fade-up">
      <PageHeader
        title={rep.orderNumber}
        sub={`${rep.caseType ?? ''} · ${rep.scooter.brand} ${rep.scooter.model} · ${rep.scooter.serialNumber}`}
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusBadge status={status} />
            <Link href="/cases"><Btn variant="ghost" size="sm">← Cases</Btn></Link>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 300px', gap: 20, alignItems: 'flex-start' }}>

        {/* ─── Left panel: info + timeline ─── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="card" style={{ padding: '18px 20px' }}>
            <SectionLabel>Case info</SectionLabel>
            <InfoRow label="Order"    value={<span className="mono" style={{ color: 'var(--accent)', fontSize: 12 }}>{rep.orderNumber}</span>} />
            <InfoRow label="Type"     value={
              <span style={{ fontSize: 12, fontWeight: 600, color: rep.caseType === 'WARRANTY' ? 'var(--accent)' : 'var(--amber)' }}>
                {rep.caseType}
              </span>
            } />
            <InfoRow label="Priority" value={rep.priority} />
            <InfoRow label="Created"  value={new Date(rep.createdAt).toLocaleDateString('en-GB')} />
            <InfoRow label="Mechanic" value={rep.mechanic?.name ?? '— unassigned'} muted={!rep.mechanic} />
          </div>

          {rep.customer && (
            <div className="card" style={{ padding: '18px 20px' }}>
              <SectionLabel>Customer</SectionLabel>
              <InfoRow label="Name"  value={rep.customer.name} />
              {rep.customer.email && <InfoRow label="Email" value={rep.customer.email} />}
              {rep.customer.phone && <InfoRow label="Phone" value={rep.customer.phone} />}
              {rep.customer.postcode && <InfoRow label="Postcode" value={rep.customer.postcode} />}
              <div style={{ marginTop: 8 }}>
                <Link href={`/customers/${rep.customer.id}`} style={{ fontSize: 12, color: 'var(--accent)' }}>
                  View customer →
                </Link>
              </div>
            </div>
          )}

          {rep.errorCodes.length > 0 && (
            <div className="card" style={{ padding: '18px 20px' }}>
              <SectionLabel>Error codes</SectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {rep.errorCodes.map(ec => (
                  <span key={ec.id} style={{
                    padding: '3px 10px', fontSize: 11, fontWeight: 600,
                    border: '1px solid var(--border)', borderRadius: 20,
                    background: 'var(--bg-raised)', color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {ec.errorCode}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="card" style={{ padding: '18px 20px' }}>
            <SectionLabel>Fault description</SectionLabel>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, marginTop: 6, whiteSpace: 'pre-wrap' }}>
              {rep.faultDescription}
            </div>
            {rep.internalNotes && (
              <>
                <div style={{ marginTop: 12, marginBottom: 4, fontSize: 11, color: 'var(--text-faint)', fontWeight: 600 }}>INTERNAL NOTES</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{rep.internalNotes}</div>
              </>
            )}
          </div>

          <div className="card" style={{ padding: '18px 20px' }}>
            <SectionLabel>Timeline</SectionLabel>
            <div style={{ marginTop: 10 }}>
              <StatusTimeline
                history={rep.statusHistory.map(h => ({
                  id:         h.id,
                  fromStatus: h.fromStatus,
                  toStatus:   h.toStatus,
                  reason:     h.reason,
                  createdAt:  h.createdAt.toISOString(),
                  changedBy:  h.changedBy,
                }))}
              />
            </div>
          </div>

          {rep.invoice && (
            <div className="card" style={{ padding: '18px 20px' }}>
              <SectionLabel>Invoice</SectionLabel>
              <InfoRow label="Ref"     value={<span className="mono">{rep.invoice.invoiceNumber ?? '—'}</span>} />
              <InfoRow label="Payment" value={<StatusBadge status={rep.invoice.paymentStatus} type="payment" />} />
            </div>
          )}

          {latestQC && (
            <div className="card" style={{ padding: '18px 20px' }}>
              <SectionLabel>Last QC</SectionLabel>
              <InfoRow label="By"     value={latestQC.submittedBy.name} />
              <InfoRow label="Result" value={
                rep.qcPassed
                  ? <span style={{ color: 'var(--green)', fontWeight: 600, fontSize: 12 }}>✓ PASS</span>
                  : <span style={{ color: 'var(--red)', fontWeight: 600, fontSize: 12 }}>✗ FAIL</span>
              } />
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {latestQC.results.map(r2 => (
                  <div key={r2.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: 'var(--text-muted)' }}>{r2.template.stepName}</span>
                    <StatusBadge status={r2.result} type="qc" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ─── Middle panel: action area ─── */}
        <div>
          <div className="card" style={{ padding: '20px 24px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
              {status === 'AWAITING_INBOUND'    ? 'Stage 2 — Inbound Triage' :
               status === 'AWAITING_CS'         ? 'Stage 1 — CS Payment Review' :
               status === 'DISPUTED'            ? 'Stage 1 — CS Review (Disputed)' :
               status === 'WAITING_FOR_MECHANIC'|| status === 'IN_REPAIR' || status === 'QC_FAILED'
                                                ? 'Stage 3 — Mechanic Workshop' :
               status === 'QUALITY_CONTROL'     ? 'Stage 4 — Outbound QC' :
               status === 'READY_TO_SHIP'       ? 'Stage 4 — Dispatch' :
               'Action required'}
            </div>
            <ActionPanel />
          </div>

          {rep.repairParts.length > 0 && (
            <div className="card" style={{ padding: '18px 24px', marginTop: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
                Parts used
              </div>
              <table className="data-table" style={{ margin: 0 }}>
                <thead>
                  <tr><th>Part</th><th>SKU</th><th>Qty</th></tr>
                </thead>
                <tbody>
                  {rep.repairParts.map(rp => (
                    <tr key={rp.part.id}>
                      <td style={{ fontSize: 12 }}>{rp.part.name}</td>
                      <td><span className="mono" style={{ fontSize: 11 }}>{rp.part.sku}</span></td>
                      <td style={{ fontSize: 12 }}>×{rp.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ─── Right panel: comments ─── */}
        <div style={{ position: 'sticky', top: 24 }}>
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
              Comments
            </div>
            <CommentsThread
              caseId={id}
              comments={rep.comments.map(c => ({
                id:               c.id,
                content:          c.content,
                isCustomerFacing: c.isCustomerFacing,
                createdAt:        c.createdAt.toISOString(),
                author:           c.author,
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>
      {children}
    </div>
  )
}

function InfoRow({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
      <span style={{ color: 'var(--text-faint)' }}>{label}</span>
      <span style={{ color: muted ? 'var(--text-faint)' : 'var(--text)', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function RoleGate() {
  return (
    <div style={{ padding: '20px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
      No action required for your role at this stage.
    </div>
  )
}
