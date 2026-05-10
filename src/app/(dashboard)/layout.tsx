import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import LayoutClient from '@/components/layout/LayoutClient'
import Sidebar from '@/components/layout/Sidebar'
import TopBar from '@/components/layout/TopBar'
import ZoneBar from '@/components/layout/ZoneBar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  let role = ''
  let name = ''
  if (userId) {
    const user = await prisma.user.findUnique({
      where:  { clerkId: userId },
      select: { role: true, name: true },
    })
    role = user?.role ?? ''
    name = user?.name ?? ''
  }

  // Mechanics don't manage warehouse zones — they're working on benches.
  // Hiding the persistent zone bar reclaims the footer real-estate for
  // their workspace and keeps their view focused.
  const showZoneBar = role !== 'MECHANIC'

  return (
    <LayoutClient role={role} name={name}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* App row: sidebar + main */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          <Sidebar role={role} name={name} />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <TopBar />
            <main style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
              {children}
            </main>
          </div>
        </div>
        {/* Persistent zone bar — hidden for mechanics. */}
        {showZoneBar && <ZoneBar />}
      </div>
    </LayoutClient>
  )
}
