import { prisma } from '@/lib/prisma'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import UsersClient from './UsersClient'

/**
 * Users / staff management page.
 *
 * v2 changes (April 2026):
 *   • Now fetches role-grouped counts server-side and passes them to
 *     UsersClient — drives the role filter chips and the stat strip
 *     without needing an extra round trip.
 *   • Active / inactive split also computed server-side.
 *
 * Auth: ADMIN only.
 */
export default async function UsersPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const me = await prisma.user.findUnique({ where: { clerkId: userId } })
  if (!me || me.role !== 'ADMIN') redirect('/dashboard')

  const [users, roleGroups, activeCount, inactiveCount] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        _count: { select: { repairOrders: true } },
      },
    }),
    prisma.user.groupBy({
      by: ['role'],
      _count: { _all: true },
    }),
    prisma.user.count({ where: { isActive: true } }),
    prisma.user.count({ where: { isActive: false } }),
  ])

  const roleCounts: Record<string, number> = {}
  for (const g of roleGroups) {
    roleCounts[g.role] = g._count._all
  }

  return (
    <div className="fade-up">
      <PageHeader
        title="Users"
        sub={`${users.length} account${users.length === 1 ? '' : 's'}`}
      />

      <UsersClient
        users={users}
        currentUserId={me.id}
        roleCounts={roleCounts}
        activeCount={activeCount}
        inactiveCount={inactiveCount}
      />
    </div>
  )
}