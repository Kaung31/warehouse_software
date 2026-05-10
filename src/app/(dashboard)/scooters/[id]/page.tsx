import { prisma } from '@/lib/prisma'
import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import StatusBadge from '@/components/ui/StatusBadge'
import Btn from '@/components/ui/Btn'
import LinkRow from '@/components/ui/LinkRow'
import DeleteScooterButton from '@/components/scooters/DeleteScooterButton'

type Ctx = { params: Promise<{ id: string }> }

export default async function ScooterDetailPage({ params }: Ctx) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const currentUser = await prisma.user.findUnique({ where: { clerkId: userId }, select: { role: true } })
  if (!currentUser) redirect('/dashboard')

  const { id } = await params

  const scooter = await prisma.scooter.findUnique({
    where: { id },
    include: {
      customer: true,
      repairOrders: {
        orderBy: { createdAt: 'desc' },
        include: {
          mechanic: { select: { name: true } },
        },
      },
    },
  })

  if (!scooter) notFound()

  const Field = ({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) => (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>
        {label}
      </div>
      <div style={{
        fontSize:   13,
        color:      value ? 'var(--text)' : 'var(--text-faint)',
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
      }}>
        {value ?? '—'}
      </div>
    </div>
  )

  return (
    <div className="fade-up">
      <PageHeader
        title={scooter.serialNumber}
        sub={`${scooter.brand} ${scooter.model}`}
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <StatusBadge status={scooter.status} type="scooter" />
            {['ADMIN', 'MANAGER'].includes(currentUser.role) && (
              <DeleteScooterButton scooterId={scooter.id} serialNumber={scooter.serialNumber} />
            )}
            <Link href="/scooters"><Btn variant="ghost" size="sm">← Back</Btn></Link>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Scooter details */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle>Scooter details</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
            <Field label="Serial number" value={scooter.serialNumber} mono />
            <Field label="Brand"         value={scooter.brand} />
            <Field label="Model"         value={scooter.model} />
            <Field label="Colour"        value={scooter.colour} />
            {scooter.grade && <Field label="Grade" value={scooter.grade} />}
            {scooter.purchaseCost && (
              <Field label="Purchase cost" value={`£${Number(scooter.purchaseCost).toFixed(2)}`} />
            )}
            {scooter.salePrice && (
              <Field label="Sale price" value={`£${Number(scooter.salePrice).toFixed(2)}`} />
            )}
          </div>
          {scooter.notes && (
            <div style={{ borderTop: '1px solid var(--border-muted)', paddingTop: 12, marginTop: 4 }}>
              <Field label="Notes" value={scooter.notes} />
            </div>
          )}
        </div>

        {/* Customer */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <SectionTitle>Customer</SectionTitle>
          {scooter.customer ? (
            <>
              <Field label="Name"     value={scooter.customer.name} />
              <Field label="Email"    value={scooter.customer.email} />
              <Field label="Phone"    value={scooter.customer.phone} />
              <Field label="Address"  value={[scooter.customer.addressLine1, scooter.customer.city].filter(Boolean).join(', ')} />
              <Field label="Postcode" value={scooter.customer.postcode} mono />
              <Link href={`/customers/${scooter.customer.id}`}>
                <Btn variant="ghost" size="sm" style={{ marginTop: 8 }}>View customer →</Btn>
              </Link>
            </>
          ) : (
            <div style={{ color: 'var(--text-faint)', fontSize: 13, paddingTop: 4 }}>
              No customer linked
            </div>
          )}
        </div>
      </div>

      {/* Repair history */}
      <div className="card">
        <div style={{
          padding:        '14px 18px',
          borderBottom:   '1px solid var(--border)',
          display:        'flex',
          justifyContent: 'space-between',
          alignItems:     'center',
        }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            Repair history ({scooter.repairOrders.length})
          </span>
          <Link href={`/repairs/new?scooterId=${scooter.id}`}>
            <Btn variant="primary" size="sm">+ New repair</Btn>
          </Link>
        </div>
        {scooter.repairOrders.length === 0 ? (
          <div style={{ padding: '32px 18px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            No repairs yet
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Order #</th>
                <th>Fault</th>
                <th>Mechanic</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {scooter.repairOrders.map((r) => (
                <LinkRow key={r.id} href={`/repairs/${r.id}`}>
                  <td><span className="mono" style={{ color: 'var(--accent)' }}>{r.orderNumber}</span></td>
                  <td style={{ maxWidth: 280, color: 'var(--text-muted)', fontSize: 12 }}>
                    {r.faultDescription.slice(0, 70)}{r.faultDescription.length > 70 ? '…' : ''}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    {r.mechanic?.name ?? '—'}
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                  <td style={{ color: 'var(--text-faint)', fontSize: 11 }}>
                    {new Date(r.createdAt).toLocaleDateString('en-GB')}
                  </td>
                </LinkRow>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 600, color: 'var(--text-faint)',
      textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14,
    }}>
      {children}
    </div>
  )
}
