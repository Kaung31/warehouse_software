import { prisma } from './prisma'

export async function generatePalletNumber(): Promise<string> {
  const date     = new Date()
  const datePart = date.toISOString().slice(0, 10).replace(/-/g, '')

  const startOfDay = new Date(date.setHours(0, 0, 0, 0))
  const count = await prisma.pallet.count({
    where: { createdAt: { gte: startOfDay } },
  })

  const sequence = String(count + 1).padStart(4, '0')
  return `PLT-${datePart}-${sequence}`
}
