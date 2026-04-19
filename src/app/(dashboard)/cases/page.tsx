import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Btn from '@/components/ui/Btn'
import StatusBadge from '@/components/ui/StatusBadge'
import LinkRow from '@/components/ui/LinkRow'

const ROLE_FILTER: Record<string, string[]> = {
  MECHANIC:  ['WAITING_FOR_MECHANIC', 'IN_REPAIR', 'QC_FAILED'],
  CS:        ['AWAITING_INBOUND', 'AWAITING_CS', 'DISPUTED'],
  WAREHOUSE: ['AWAITING_INBOUND', 'QUALITY_CONTROL', 'READY_TO_SHIP'],
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>
}) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const user = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!user) redirect('/dashboard')

  const sp     = await searchParams
  const page   = Math.max(1, parseInt(sp.page ?? '1'))
  const take   = 25
  const skip   = (page - 1) * take
  const search = sp.q?.trim() ?? ''

  const isAdminOrManager = ['ADMIN', 'MANAGER'].includes(user.role)
  const defaultStatuses  = ROLE_FILTER[user.role] ?? []
  const statusFilter     = sp.status
    ? [sp.status]
    : (isAdminOrManager ? [] : defaultStatuses)

  const where: Prisma.RepairOrderWhereInput = {
    ...(statusFilter.length > 0 ? { status: { in: statusFilter as never[] } } : {}),
    ...(search ? {
      OR: [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { scooter: { serialNumber: { contains: search, mode: 'insensitive' } } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
      ],
    } : {}),
  }

  const [cases, total] = await Promise.all([
    prisma.repairOrder.findMany({
      where,
      take,
      skip,
      orderBy: { updatedAt: 'desc' },
      include: {
        scooter:  { select: { serialNumber: true, brand: true, model: true } },
        customer: { select: { name: true } },
        mechanic: { select: { name: true } },
      },
    }),
    prisma.repairOrder.count({ where }),
  ])

  const pages = Math.ceil(total / take)

  const ALL_STATUSES = [
    'AWAITING_INBOUND', 'AWAITING_CS', 'WAITING_FOR_MECHANIC', 'DISPUTED',
    'IN_REPAIR', 'QUALITY_CONTROL', 'QC_FAILED',
    'READY_TO_SHIP', 'DISPATCHED', 'BGRADE_RECORDED',
  ]

  return (
    <div className="fade-up">
      <PageHeader
        title="Cases"
        sub={`${total} case${total !== 1 ? 's' : ''} found`}
        action={
          <Link href="/cases/new">
            <Btn variant="primary" size="sm">+ New case</Btn>
          </Link>
        }
      />

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <form style={{ display: 'flex', gap: 8, flex: 1, minWidth: 0 }}>
          <input
            name="q"
            defaultValue={search}
            placeholder="Search order #, serial, customer…"
            style={{ flex: 1, minWidth: 0 }}
          />
          <Btn variant="secondary" size="sm" type="submit">Search</Btn>
        </form>
      </div>

      {/* Status filter chips */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <Link href={`/cases${search ? `?q=${encodeURIComponent(search)}` : ''}`}>
          <span style={{
            padding: '4px 12px', fontSize: 12, borderRadius: 20, cursor: 'pointer',
            border: `1px solid ${!sp.status ? 'var(--accent)' : 'var(--border)'}`,
            background: !sp.status ? 'var(--accent-dim)' : 'transparent',
            color: !sp.status ? 'var(--accent)' : 'var(--text-muted)',
          }}>
            {isAdminOrManager ? 'All' : 'My queue'}
          </span>
        </Link>
        {ALL_STATUSES.map(s => {
          const active = sp.status === s
          return (
            <Link key={s} href={`/cases?status=${s}${search ? `&q=${encodeURIComponent(search)}` : ''}`}>
              <StatusBadge status={s} />
            </Link>
          )
        })}
      </div>

      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Order #</th>
              <th>Serial</th>
              <th>Customer</th>
              <th>Brand / Model</th>
              <th>Type</th>
              <th>Status</th>
              <th>Mechanic</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '32px 0' }}>
                  No cases found
                </td>
              </tr>
            ) : cases.map(c => (
              <LinkRow key={c.id} href={`/cases/${c.id}`}>
                <td><span className="mono" style={{ color: 'var(--accent)', fontSize: 12 }}>{c.orderNumber}</span></td>
                <td><span className="mono" style={{ fontSize: 12 }}>{c.scooter.serialNumber}</span></td>
                <td style={{ color: c.customer?.name ? 'var(--text)' : 'var(--text-faint)' }}>
                  {c.customer?.name ?? '—'}
                </td>
                <td style={{ fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{c.scooter.brand}</span>
                  <span style={{ color: 'var(--text-faint)', margin: '0 4px' }}>/</span>
                  {c.scooter.model}
                </td>
                <td>
                  <span style={{
                    fontSize: 11, fontWeight: 600,
                    color: (c as { caseType?: string }).caseType === 'WARRANTY' ? 'var(--accent)' : 'var(--amber)',
                  }}>
                    {(c as { caseType?: string }).caseType ?? '—'}
                  </span>
                </td>
                <td><StatusBadge status={c.status} /></td>
                <td style={{ color: c.mechanic ? 'var(--text)' : 'var(--text-faint)', fontSize: 12 }}>
                  {c.mechanic?.name ?? '—'}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {new Date(c.updatedAt).toLocaleDateString('en-GB')}
                </td>
              </LinkRow>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 16, borderTop: '1px solid var(--border-muted)' }}>
            {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
              <Link key={p} href={`/cases?page=${p}${sp.status ? `&status=${sp.status}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`}>
                <span style={{
                  display: 'inline-block', padding: '4px 10px', fontSize: 12, borderRadius: 'var(--radius)',
                  border: `1px solid ${p === page ? 'var(--accent)' : 'var(--border)'}`,
                  background: p === page ? 'var(--accent-dim)' : 'transparent',
                  color: p === page ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}>
                  {p}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
