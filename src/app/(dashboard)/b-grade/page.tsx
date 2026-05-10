import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Btn from '@/components/ui/Btn'
import StatusBadge from '@/components/ui/StatusBadge'
import LinkRow from '@/components/ui/LinkRow'

export default async function BgradePage({
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

  const where: Prisma.RepairOrderWhereInput = {
    caseType: 'BGRADE',
    ...(sp.status ? { status: sp.status as never } : {}),
    ...(search ? {
      OR: [
        { orderNumber: { contains: search, mode: 'insensitive' } },
        { scooter: { serialNumber: { contains: search, mode: 'insensitive' } } },
        { scooter: { brand:        { contains: search, mode: 'insensitive' } } },
        { scooter: { model:        { contains: search, mode: 'insensitive' } } },
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
        scooter:       { select: { serialNumber: true, brand: true, model: true } },
        mechanic:      { select: { name: true } },
        currentPallet: { select: { palletNumber: true, locationCode: true } },
      },
    }),
    prisma.repairOrder.count({ where }),
  ])

  const pages = Math.ceil(total / take)

  const BGRADE_STATUSES = [
    'AWAITING_INBOUND', 'WAITING_FOR_MECHANIC', 'IN_REPAIR', 'AWAITING_PARTS',
    'QUALITY_CONTROL', 'QC_FAILED', 'BGRADE_RECORDED',
  ]

  return (
    <div className="fade-up">
      <PageHeader
        title="B-Grade"
        sub={`${total} b-grade scooter${total !== 1 ? 's' : ''}`}
        action={
          <Link href="/b-grade/new">
            <Btn variant="primary" size="sm">+ New B-grade entry</Btn>
          </Link>
        }
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <form style={{ display: 'flex', gap: 8, flex: 1, minWidth: 0 }}>
          <input
            name="q"
            defaultValue={search}
            placeholder="Search order #, serial, brand, model…"
            style={{ flex: 1, minWidth: 0 }}
          />
          <Btn variant="secondary" size="sm" type="submit">Search</Btn>
        </form>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        <Link href={`/b-grade${search ? `?q=${encodeURIComponent(search)}` : ''}`}>
          <span style={{
            padding: '4px 12px', fontSize: 12, borderRadius: 20, cursor: 'pointer',
            border: `1px solid ${!sp.status ? 'var(--accent)' : 'var(--border)'}`,
            background: !sp.status ? 'var(--accent-dim)' : 'transparent',
            color: !sp.status ? 'var(--accent)' : 'var(--text-muted)',
          }}>
            All
          </span>
        </Link>
        {BGRADE_STATUSES.map(s => (
          <Link key={s} href={`/b-grade?status=${s}${search ? `&q=${encodeURIComponent(search)}` : ''}`}>
            <StatusBadge status={s} />
          </Link>
        ))}
      </div>

      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Order #</th>
              <th>Serial</th>
              <th>Brand / Model</th>
              <th>Status</th>
              <th>Mechanic</th>
              <th>Pallet</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {cases.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-faint)', padding: '32px 0' }}>
                  No B-grade scooters found
                </td>
              </tr>
            ) : cases.map(c => (
              <LinkRow key={c.id} href={`/b-grade/${c.id}`}>
                <td><span className="mono" style={{ color: 'var(--accent)', fontSize: 12 }}>{c.orderNumber}</span></td>
                <td><span className="mono" style={{ fontSize: 12 }}>{c.scooter.serialNumber}</span></td>
                <td style={{ fontSize: 12 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{c.scooter.brand}</span>
                  <span style={{ color: 'var(--text-faint)', margin: '0 4px' }}>/</span>
                  {c.scooter.model}
                </td>
                <td><StatusBadge status={c.status} /></td>
                <td style={{ color: c.mechanic ? 'var(--text)' : 'var(--text-faint)', fontSize: 12 }}>
                  {c.mechanic?.name ?? '—'}
                </td>
                <td>
                  {c.currentPallet
                    ? <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>
                        {c.currentPallet.palletNumber}
                        {c.currentPallet.locationCode && (
                          <span style={{ color: 'var(--text-faint)', marginLeft: 4 }}>· {c.currentPallet.locationCode}</span>
                        )}
                      </span>
                    : <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>—</span>
                  }
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {new Date(c.updatedAt).toLocaleDateString('en-GB')}
                </td>
              </LinkRow>
            ))}
          </tbody>
        </table>

        {pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 16, borderTop: '1px solid var(--border-muted)' }}>
            {Array.from({ length: pages }, (_, i) => i + 1).map(p => (
              <Link key={p} href={`/b-grade?page=${p}${sp.status ? `&status=${sp.status}` : ''}${search ? `&q=${encodeURIComponent(search)}` : ''}`}>
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
