/**
 * Minimum fixtures for cs-update + dispatcher integration tests.
 *
 * Every helper here is callable post-resetDb() — it assumes empty
 * tables and creates the bare graph cs-update needs:
 *
 *   User (CS) → Customer → Scooter → RepairOrder
 *                                  ↘ InvoiceReference
 *
 * Plus a WarehouseLocation per status code the autoSetLocation map
 * touches, so the dispatch handler's first side-effect can resolve.
 */

import { prisma } from '@/lib/prisma'
import { FAKE_CLERK_ID } from './setup'

export type CsUpdateFixture = {
  user:        { id: string; role: string }
  customer:    { id: string }
  scooter:     { id: string }
  repairOrder: { id: string; orderNumber: string; status: string }
  invoice:     { id: string; paymentStatus: string }
  locationIds: Record<string, string>  // location code → location.id
}

export async function seedCsUpdateFixture(
  initialStatus: 'AWAITING_CS' | 'AWAITING_INBOUND' = 'AWAITING_CS',
): Promise<CsUpdateFixture> {
  const user = await prisma.user.create({
    data: {
      clerkId: FAKE_CLERK_ID,
      name:    'Integration CS Tester',
      email:   `cs-tester-${Date.now()}@example.com`,
      role:    'CS',
    },
  })

  const customer = await prisma.customer.create({
    data: {
      name:     'Integration Customer',
      email:    'integration-customer@example.com',
      phone:    '07700900000',
      postcode: 'SW1A 1AA',
    },
  })

  const scooter = await prisma.scooter.create({
    data: {
      serialNumber: `INT-${Date.now()}`,
      model:        'TestModel',
      brand:        'TestBrand',
      customerId:   customer.id,
    },
  })

  // Locations referenced by autoSetLocation's STATUS_LOCATION_MAP. We
  // seed the codes that cs-update transitions can hit.
  const locationCodes = ['MECH_Q', 'WARRANTY']
  const locationIds: Record<string, string> = {}
  for (const code of locationCodes) {
    const loc = await prisma.warehouseLocation.create({
      data: {
        code,
        name: code,
        type: code === 'MECH_Q' ? 'MECHANIC_QUEUE' : 'WARRANTY_RACK',
      },
    })
    locationIds[code] = loc.id
  }

  const repairOrder = await prisma.repairOrder.create({
    data: {
      orderNumber:      `RO-INT-${Date.now()}`,
      scooterId:        scooter.id,
      customerId:       customer.id,
      faultDescription: 'Integration-test fault',
      status:           initialStatus,
    },
  })

  const invoice = await prisma.invoiceReference.create({
    data: {
      caseId:        repairOrder.id,
      paymentStatus: 'UNPAID',
      updatedById:   user.id,
    },
  })

  return {
    user:        { id: user.id, role: user.role },
    customer:    { id: customer.id },
    scooter:     { id: scooter.id },
    repairOrder: { id: repairOrder.id, orderNumber: repairOrder.orderNumber, status: repairOrder.status },
    invoice:     { id: invoice.id, paymentStatus: invoice.paymentStatus },
    locationIds,
  }
}
