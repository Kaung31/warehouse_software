import { prisma } from '@/lib/prisma'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import WarehouseMap from '@/components/locations/WarehouseMap'

const INACTIVE = ['DISPATCHED', 'CANCELLED'] as const

export default async function LocationsPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const currentUser = await prisma.user.findUnique({
    where:  { clerkId: userId },
    select: { role: true },
  })
  if (!currentUser) redirect('/dashboard')

  const isAdmin = ['ADMIN', 'MANAGER'].includes(currentUser.role)

  const zones = await prisma.warehouseLocation.findMany({
    where:   { parentId: null },
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: {
      _count: {
        select: { cases: { where: { status: { notIn: [...INACTIVE] } } } },
      },
      children: {
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: { cases: { where: { status: { notIn: [...INACTIVE] } } } },
          },
        },
      },
    },
  })

  const allLocationIds = [
    ...zones.map(z => z.id),
    ...zones.flatMap(z => z.children.map(r => r.id)),
  ]

  const casesByLocation: Record<string, { id: string; orderNumber: string; status: string; brand: string; model: string }[]> = {}
  await Promise.all(
    allLocationIds.map(async (locId) => {
      const cases = await prisma.repairOrder.findMany({
        where:   { currentLocationId: locId, status: { notIn: [...INACTIVE] } },
        take:    20,
        orderBy: { updatedAt: 'desc' },
        include: { scooter: { select: { brand: true, model: true } } },
      })
      casesByLocation[locId] = cases.map(c => ({
        id:          c.id,
        orderNumber: c.orderNumber,
        status:      c.status,
        brand:       (c.scooter as { brand: string }).brand,
        model:       (c.scooter as { model: string }).model,
      }))
    })
  )

  return (
    <WarehouseMap
      zones={zones.map(z => ({
        id:          z.id,
        name:        z.name,
        code:        z.code,
        type:        z.type,
        capacity:    z.capacity,
        activeCases: z._count.cases,
        isActive:    z.isActive,
        description: z.description ?? null,
        racks: z.children.map(r => ({
          id:          r.id,
          name:        r.name,
          code:        r.code,
          type:        r.type,
          capacity:    r.capacity,
          activeCases: r._count.cases,
          isActive:    r.isActive,
          description: r.description ?? null,
        })),
      }))}
      casesByLocation={casesByLocation}
      isAdmin={isAdmin}
    />
  )
}
