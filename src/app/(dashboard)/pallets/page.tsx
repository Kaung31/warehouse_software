import { prisma } from '@/lib/prisma'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Btn from '@/components/ui/Btn'
import StatusBadge from '@/components/ui/StatusBadge'
import LinkRow from '@/components/ui/LinkRow'

export default async function PalletsPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const currentUser = await prisma.user.findUnique({ where: { clerkId: userId }, select: { role: true } })
  if (!currentUser) redirect('/dashboard')

  const pallets = await prisma.pallet.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { name: true } },
      _count:    { select: { items: { where: { removedAt: null } } } },
    },
  })

  const canCreate = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(currentUser.role)

  const bgrade  = pallets.filter(p => p.purpose === 'BGRADE')
  const holding = pallets.filter(p => p.purpose === 'HOLDING')

  return (
    <div className="fade-up">
      <PageHeader
        title="Pallets"
        sub="Group scooters for storage, B-grade batches, and temporary holds"
        action={
          canCreate && (
            <Link href="/pallets/new">
              <Btn variant="primary" size="sm">+ New pallet</Btn>
            </Link>
          )
        }
      />

      {[
        { label: 'B-Grade pallets', items: bgrade,  desc: 'Permanent storage for pre-owned scooters' },
        { label: 'Holding pallets', items: holding, desc: 'Warranty cases on temporary hold (awaiting parts / delayed)' },
      ].map(section => (
        <div key={section.label} style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{section.label}</div>
            <div style={{ fontSize: 12, color: 'var(--text-faint)' }}>{section.desc}</div>
          </div>

          {section.items.length === 0 ? (
            <div className="card" style={{ padding: '28px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
              No {section.label.toLowerCase()} yet
            </div>
          ) : (
            <div className="card">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Pallet ID</th>
                    <th>Scooters</th>
                    <th>Capacity</th>
                    <th>Location</th>
                    <th>Status</th>
                    <th>Created by</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {section.items.map(p => {
                    const fill = p._count.items
                    const pct  = Math.round((fill / p.capacity) * 100)
                    return (
                      <LinkRow key={p.id} href={`/pallets/${p.id}`}>
                        <td>
                          <span className="mono" style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 700 }}>
                            {p.palletNumber}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 13 }}>{fill} / {p.capacity}</span>
                            <div style={{ width: 60, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--red)' : pct > 70 ? 'var(--amber)' : 'var(--green)', borderRadius: 3 }} />
                            </div>
                          </div>
                        </td>
                        <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.capacity}</td>
                        <td>
                          <span className="mono" style={{ fontSize: 11, color: p.locationCode ? 'var(--text)' : 'var(--text-faint)' }}>
                            {p.locationCode ?? '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{
                            fontSize: 11, padding: '2px 8px', borderRadius: 10,
                            background: p.isSealed ? 'var(--bg-raised)' : 'var(--green-bg)',
                            color:      p.isSealed ? 'var(--text-faint)' : 'var(--green)',
                            fontWeight: 600,
                          }}>
                            {p.isSealed ? 'Sealed' : 'Open'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.createdBy.name}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                          {new Date(p.createdAt).toLocaleDateString('en-GB')}
                        </td>
                      </LinkRow>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
