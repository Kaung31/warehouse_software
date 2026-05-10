import { prisma } from '@/lib/prisma'
import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Btn from '@/components/ui/Btn'
import StatusBadge from '@/components/ui/StatusBadge'
import QRCodeDisplay from '@/components/ui/QRCodeDisplay'
import PalletClient from '@/components/pallets/PalletClient'

type Ctx = { params: Promise<{ id: string }> }

export default async function PalletDetailPage({ params }: Ctx) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const currentUser = await prisma.user.findUnique({ where: { clerkId: userId }, select: { role: true } })
  if (!currentUser) redirect('/dashboard')

  const { id } = await params

  const pallet = await prisma.pallet.findUnique({
    where:   { id },
    include: {
      createdBy: { select: { name: true } },
      items: {
        where:   { removedAt: null },
        include: {
          repairOrder: {
            include: {
              scooter:  { select: { serialNumber: true, brand: true, model: true } },
              customer: { select: { name: true } },
              mechanic: { select: { name: true } },
            },
          },
          addedBy: { select: { name: true } },
        },
        orderBy: { addedAt: 'desc' },
      },
    },
  })

  if (!pallet) notFound()

  const canEdit = ['ADMIN', 'MANAGER', 'WAREHOUSE'].includes(currentUser.role)
  const fill    = pallet.items.length

  return (
    <div className="fade-up">
      <PageHeader
        title={pallet.palletNumber}
        sub={`${pallet.purpose === 'BGRADE' ? 'B-Grade pallet' : 'Holding pallet'} · ${fill} / ${pallet.capacity} scooters`}
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 10, fontWeight: 600,
              background: pallet.isSealed ? 'var(--bg-raised)' : 'var(--green-bg)',
              color:      pallet.isSealed ? 'var(--text-faint)' : 'var(--green)',
            }}>
              {pallet.isSealed ? 'Sealed' : 'Open'}
            </span>
            <Link href="/pallets"><Btn variant="ghost" size="sm">← Pallets</Btn></Link>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'flex-start' }}>

        {/* Left — pallet info + QR */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div className="card" style={{ padding: '18px 20px' }}>
            <SectionLabel>Pallet info</SectionLabel>
            <InfoRow label="ID"       value={<span className="mono" style={{ color: 'var(--accent)', fontSize: 12 }}>{pallet.palletNumber}</span>} />
            <InfoRow label="Type"     value={pallet.purpose === 'BGRADE' ? '♻ B-Grade' : '⏳ Holding'} />
            <InfoRow label="Capacity" value={`${fill} / ${pallet.capacity}`} />
            <InfoRow label="Location" value={pallet.locationCode ?? '— not set'} mono={!!pallet.locationCode} />
            <InfoRow label="Created"  value={new Date(pallet.createdAt).toLocaleDateString('en-GB')} />
            <InfoRow label="By"       value={pallet.createdBy.name} />
            {pallet.notes && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-muted)', fontSize: 12, color: 'var(--text-muted)' }}>
                {pallet.notes}
              </div>
            )}
          </div>

          {/* Pallet QR */}
          <div className="card" style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <SectionLabel>Pallet QR code</SectionLabel>
            <QRCodeDisplay value={pallet.palletNumber} size={140} label={pallet.palletNumber} />
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8, textAlign: 'center' }}>
              Scan to view all scooters in this pallet
            </div>
          </div>

          {/* Fill bar */}
          <div className="card" style={{ padding: '16px 20px' }}>
            <SectionLabel>Capacity</SectionLabel>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fill} scooters</span>
              <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>max {pallet.capacity}</span>
            </div>
            <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 4,
                width: `${Math.min(100, Math.round((fill / pallet.capacity) * 100))}%`,
                background: fill >= pallet.capacity ? 'var(--red)' : fill / pallet.capacity > 0.7 ? 'var(--amber)' : 'var(--green)',
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        </div>

        {/* Right — items table + actions */}
        <PalletClient
          palletId={id}
          palletNumber={pallet.palletNumber}
          isSealed={pallet.isSealed}
          locationCode={pallet.locationCode}
          canEdit={canEdit}
          items={pallet.items.map(item => ({
            id:       item.id,
            addedAt:  item.addedAt.toISOString(),
            addedBy:  item.addedBy.name,
            repairOrder: {
              id:          item.repairOrder.id,
              orderNumber: item.repairOrder.orderNumber,
              status:      item.repairOrder.status,
              caseType:    item.repairOrder.caseType,
              scooter:     item.repairOrder.scooter,
              customer:    item.repairOrder.customer,
              mechanic:    item.repairOrder.mechanic,
            },
          }))}
        />
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
function InfoRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 8 }}>
      <span style={{ color: 'var(--text-faint)' }}>{label}</span>
      <span style={{ color: 'var(--text)', textAlign: 'right', fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}>{value}</span>
    </div>
  )
}
