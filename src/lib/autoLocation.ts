import { prisma } from '@/lib/prisma'

// Maps repair status → warehouse location code
const STATUS_LOCATION_MAP: Record<string, string> = {
  AWAITING_INBOUND:     'INBOUND',
  AWAITING_CS:          'WARRANTY',
  WAITING_FOR_MECHANIC: 'MECH_Q',
  IN_REPAIR:            'MECH_Q',
  AWAITING_PARTS:       'MECH_Q',
  QUALITY_CONTROL:      'QC',
  QC_FAILED:            'MECH_Q',
  READY_TO_SHIP:        'DISPATCH',
  BGRADE_RECORDED:      'BGRADE',
}

export async function autoSetLocation(caseId: string, toStatus: string) {
  const code = STATUS_LOCATION_MAP[toStatus]
  if (!code) return

  const loc = await prisma.warehouseLocation.findUnique({ where: { code } })
  if (!loc || !loc.isActive) return

  await prisma.repairOrder.update({
    where: { id: caseId },
    data:  { currentLocationId: loc.id },
  })
}
