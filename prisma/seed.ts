import {
  PrismaClient,
  RepairStatus,
  ScooterStatus,
  Priority,
  CaseType,
  QCResult,
  ErrorCode,
  PaymentStatus,
  Grade,
} from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding — clearing old data...')

  await prisma.customerNotification.deleteMany()
  await prisma.palletItem.deleteMany()
  await prisma.pallet.deleteMany()
  await prisma.qCChecklistResult.deleteMany()
  await prisma.qCSubmission.deleteMany()
  await prisma.errorCodeReport.deleteMany()
  await prisma.invoiceReference.deleteMany()
  await prisma.caseStatusHistory.deleteMany()
  await prisma.caseComment.deleteMany()
  await prisma.repairTimeLog.deleteMany()
  await prisma.stockMovement.deleteMany()
  await prisma.repairPart.deleteMany()
  await prisma.shipment.deleteMany()
  await prisma.repairOrder.deleteMany()
  await prisma.scooter.deleteMany()
  await prisma.part.deleteMany()
  await prisma.customer.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.qCChecklistTemplate.deleteMany()
  await prisma.warehouseLocation.deleteMany()
  await prisma.user.deleteMany({ where: { clerkId: { startsWith: 'seed_' } } })

  // ── Warehouse Locations ────────────────────────────────────────────────────
  console.log('Creating locations...')
  await prisma.warehouseLocation.createMany({
    data: [
      { name: 'Inbound Area',    code: 'INBOUND',   type: 'INBOUND_AREA',   description: 'Scooters just received',               capacity: 30, isActive: true },
      { name: 'Warranty Rack',   code: 'WARRANTY',  type: 'WARRANTY_RACK',  description: 'Warranty cases awaiting CS approval',  capacity: 20, isActive: true },
      { name: 'B-Grade Area',    code: 'BGRADE',    type: 'BGRADE_AREA',    description: 'B-grade scooters',                     capacity: 50, isActive: true },
      { name: 'Mechanic Queue',  code: 'MECH_Q',    type: 'MECHANIC_QUEUE', description: 'Waiting for or in mechanic workshop',  capacity: 15, isActive: true },
      { name: 'QC Rack',         code: 'QC',        type: 'QC_RACK',        description: 'Awaiting QC inspection',               capacity: 10, isActive: true },
      { name: 'Dispatch Area',   code: 'DISPATCH',  type: 'DISPATCH_AREA',  description: 'Ready to ship',                        capacity: 20, isActive: true },
      { name: 'General Storage', code: 'STORAGE',   type: 'STORAGE',        description: 'Misc holding',                         capacity: 100, isActive: true },
    ],
  })
  const locs = await prisma.warehouseLocation.findMany()
  const loc  = (code: string) => locs.find(l => l.code === code)!.id

  // ── Users ──────────────────────────────────────────────────────────────────
  console.log('Creating users...')
  const [admin, manager, mechanic1, mechanic2, warehouse1, csUser] = await Promise.all([
    prisma.user.create({ data: { clerkId: 'seed_admin',     email: 'admin@scooterhub.test',     name: 'Alex Admin',    role: 'ADMIN'     } }),
    prisma.user.create({ data: { clerkId: 'seed_manager',   email: 'manager@scooterhub.test',   name: 'Sarah Manager', role: 'MANAGER'   } }),
    prisma.user.create({ data: { clerkId: 'seed_mechanic1', email: 'john@scooterhub.test',      name: 'John Mechanic', role: 'MECHANIC'  } }),
    prisma.user.create({ data: { clerkId: 'seed_mechanic2', email: 'tom@scooterhub.test',       name: 'Tom Wrench',    role: 'MECHANIC'  } }),
    prisma.user.create({ data: { clerkId: 'seed_warehouse', email: 'mike@scooterhub.test',      name: 'Mike Inbound',  role: 'WAREHOUSE' } }),
    prisma.user.create({ data: { clerkId: 'seed_cs',        email: 'emma@scooterhub.test',      name: 'Emma CS',       role: 'CS'        } }),
  ])

  // ── QC Templates ──────────────────────────────────────────────────────────
  console.log('Creating QC templates...')
  const templates = await Promise.all([
    { stepNumber: 1,  stepName: 'Power on / off',          description: 'Powers on and off cleanly' },
    { stepNumber: 2,  stepName: 'Battery level display',   description: 'Battery % shows correctly on display' },
    { stepNumber: 3,  stepName: 'Throttle response',       description: 'Throttle accelerates smoothly, no judder' },
    { stepNumber: 4,  stepName: 'Brake effectiveness',     description: 'Both brakes stop within spec distance' },
    { stepNumber: 5,  stepName: 'Brake lights',            description: 'Brake lights illuminate on both sides' },
    { stepNumber: 6,  stepName: 'Headlight & tail light',  description: 'Both lights operational, correct brightness' },
    { stepNumber: 7,  stepName: 'Speed display accuracy',  description: 'Speed display matches GPS reference' },
    { stepNumber: 8,  stepName: 'Tyre condition',          description: 'No damage, cuts, adequate pressure' },
    { stepNumber: 9,  stepName: 'Frame & deck integrity',  description: 'No cracks, deformations, or structural damage' },
    { stepNumber: 10, stepName: 'Folding mechanism',       description: 'Stem folds and locks securely' },
  ].map(s => prisma.qCChecklistTemplate.create({ data: { ...s, isActive: true } })))

  // ── Customers ──────────────────────────────────────────────────────────────
  // Phase B: spread notificationPreference across the dataset so the customer
  // tracking portal has cases with each preference path.
  //   c1 EMAIL  / c2 SMS    / c3 BOTH
  //   c4 NONE   / c5 EMAIL  / c6 BOTH
  console.log('Creating customers...')
  const [c1, c2, c3, c4, c5, c6] = await Promise.all([
    prisma.customer.create({ data: { name: 'James Wilson',  email: 'james@mail.com',  phone: '07700900001', addressLine1: '12 Baker St',    city: 'London',     postcode: 'SW1A 1AA', notificationPreference: 'EMAIL' } }),
    prisma.customer.create({ data: { name: 'Sarah Brown',   email: 'sarah@mail.com',  phone: '07700900002', addressLine1: '5 Oak Avenue',   city: 'Manchester', postcode: 'M1 1AE',  notificationPreference: 'SMS'   } }),
    prisma.customer.create({ data: { name: 'Daniel Taylor', email: 'daniel@mail.com', phone: '07700900003', addressLine1: '88 High Street', city: 'Birmingham', postcode: 'B1 1BB',  notificationPreference: 'BOTH'  } }),
    prisma.customer.create({ data: { name: 'Emily Johnson', email: 'emily@mail.com',  phone: '07700900004', addressLine1: '3 Mill Road',    city: 'Leeds',      postcode: 'LS1 1BA', notificationPreference: 'NONE'  } }),
    prisma.customer.create({ data: { name: 'Chris Lee',     email: 'chris@mail.com',  phone: '07700900005', addressLine1: '47 Park Lane',   city: 'Bristol',    postcode: 'BS1 1AA', notificationPreference: 'EMAIL' } }),
    prisma.customer.create({ data: { name: 'Priya Sharma',  email: 'priya@mail.com',  phone: '07700900006', addressLine1: '22 Park Road',   city: 'London',     postcode: 'E1 6AN',  notificationPreference: 'BOTH'  } }),
  ])

  // ── Parts ─────────────────────────────────────────────────────────────────
  console.log('Creating parts...')
  const parts = await Promise.all([
    prisma.part.create({ data: { sku: 'P-001', barcode: 'BC001', name: 'Brake Cable',       description: 'Front/rear brake cable 1.2m', stockQty: 25, reorderLevel: 5,  unitCost: 8,   supplierName: 'ScooterParts Ltd', warehouseLocation: 'PART-S1-R1-C1', compatibleModels: 'Pure Air,Pure Air Pro,Pure Air Go' } }),
    prisma.part.create({ data: { sku: 'P-002', barcode: 'BC002', name: 'Inner Tube 8.5"',   description: '8.5 inch inner tube',         stockQty: 40, reorderLevel: 10, unitCost: 6,   supplierName: 'ScooterParts Ltd', warehouseLocation: 'PART-S1-R1-C2', compatibleModels: 'Pure Air,Pure Air Pro,Xiaomi M365' } }),
    prisma.part.create({ data: { sku: 'P-003', barcode: 'BC003', name: 'Controller Board',  description: 'Main ESC controller',          stockQty: 8,  reorderLevel: 3,  unitCost: 45,  supplierName: 'TechParts UK',     warehouseLocation: 'PART-S2-R1-C1', compatibleModels: 'Xiaomi M365,Xiaomi M365 Pro,Xiaomi ES4' } }),
    prisma.part.create({ data: { sku: 'P-004', barcode: 'BC004', name: 'Battery Pack 36V',  description: '36V 7.8Ah lithium battery',    stockQty: 6,  reorderLevel: 3,  unitCost: 120, supplierName: 'TechParts UK',     warehouseLocation: 'PART-S2-R2-C1', compatibleModels: 'Pure Air Pro,Pure Air Pro 2,Segway Ninebot Max' } }),
    prisma.part.create({ data: { sku: 'P-005', barcode: 'BC005', name: 'Brake Lever Set',   description: 'Left + right brake levers',    stockQty: 30, reorderLevel: 8,  unitCost: 12,  supplierName: 'ScooterParts Ltd', warehouseLocation: 'PART-S1-R2-C1', compatibleModels: 'Pure Air,Pure Air Pro,Segway G30,Segway Ninebot Max' } }),
    prisma.part.create({ data: { sku: 'P-006', barcode: 'BC006', name: 'Display Screen',    description: 'LED dashboard display',        stockQty: 4,  reorderLevel: 3,  unitCost: 35,  supplierName: 'TechParts UK',     warehouseLocation: 'PART-S2-R1-C2', compatibleModels: 'Xiaomi M365,Xiaomi M365 Pro' } }),
    prisma.part.create({ data: { sku: 'P-007', barcode: 'BC007', name: 'Throttle Trigger',  description: 'Right-hand throttle assembly', stockQty: 15, reorderLevel: 5,  unitCost: 18,  supplierName: 'ScooterParts Ltd', warehouseLocation: 'PART-S1-R2-C2', compatibleModels: 'Pure Air,Pure Air Pro,Pure Air Go,Segway G30' } }),
    prisma.part.create({ data: { sku: 'P-008', barcode: 'BC008', name: 'Stem Latch Clip',   description: 'Folding stem latch',           stockQty: 50, reorderLevel: 10, unitCost: 4,   supplierName: 'ScooterParts Ltd', warehouseLocation: 'PART-S1-R3-C1', compatibleModels: 'Pure Air,Pure Air Pro,Pure Air Go,Xiaomi M365' } }),
    prisma.part.create({ data: { sku: 'P-009', barcode: 'BC009', name: 'Motor Hub 350W',    description: '350W rear motor wheel hub',    stockQty: 3,  reorderLevel: 2,  unitCost: 85,  supplierName: 'TechParts UK',     warehouseLocation: 'PART-S3-R1-C1', compatibleModels: 'Segway Ninebot Max,Segway G30' } }),
    prisma.part.create({ data: { sku: 'P-010', barcode: 'BC010', name: 'Tyre 10" Solid',    description: '10 inch honeycomb solid tyre', stockQty: 20, reorderLevel: 5,  unitCost: 22,  supplierName: 'ScooterParts Ltd', warehouseLocation: 'PART-S1-R3-C2', compatibleModels: 'Segway Ninebot Max,Segway G30,Pure Air Pro 2' } }),
    prisma.part.create({ data: { sku: 'P-011', barcode: 'BC011', name: 'Charging Port',     description: 'DC charging port 42V',        stockQty: 12, reorderLevel: 4,  unitCost: 9,   supplierName: 'TechParts UK',     warehouseLocation: 'PART-S2-R2-C2', compatibleModels: 'Pure Air,Pure Air Pro,Xiaomi M365,Xiaomi M365 Pro' } }),
    prisma.part.create({ data: { sku: 'P-012', barcode: 'BC012', name: 'Deck Grip Tape',    description: 'Anti-slip deck tape 50x14cm',  stockQty: 60, reorderLevel: 15, unitCost: 3,   supplierName: 'ScooterParts Ltd', warehouseLocation: 'PART-S1-R4-C1', compatibleModels: 'Pure Air,Pure Air Pro,Pure Air Go,Segway G30,Xiaomi M365' } }),
  ])

  // ── Pallets ───────────────────────────────────────────────────────────────
  console.log('Creating pallets...')
  const [palletBG1, palletBG2, palletHolding1] = await Promise.all([
    prisma.pallet.create({ data: { palletNumber: 'PLT-20260422-0001', purpose: 'BGRADE',  capacity: 10, locationCode: 'BGRADE',  notes: 'B-grade intake pallet A', createdById: warehouse1.id } }),
    prisma.pallet.create({ data: { palletNumber: 'PLT-20260422-0002', purpose: 'BGRADE',  capacity: 10, locationCode: 'BGRADE',  notes: 'B-grade intake pallet B', createdById: warehouse1.id } }),
    prisma.pallet.create({ data: { palletNumber: 'PLT-20260422-0003', purpose: 'HOLDING', capacity: 8,  locationCode: 'MECH_Q',  notes: 'Warranty holding — awaiting parts', createdById: warehouse1.id } }),
  ])

  // ── Scooters ──────────────────────────────────────────────────────────────
  console.log('Creating scooters...')
  const scooters = await Promise.all([
    // WARRANTY scooters
    prisma.scooter.create({ data: { serialNumber: 'PA-W001', brand: 'Pure Electric', model: 'Pure Air Pro',    status: 'IN_REPAIR',     customerId: c1.id } }),
    prisma.scooter.create({ data: { serialNumber: 'PA-W002', brand: 'Pure Electric', model: 'Pure Air Pro',    status: 'IN_REPAIR',     customerId: c2.id } }),
    prisma.scooter.create({ data: { serialNumber: 'XM-W003', brand: 'Xiaomi',        model: 'M365 Pro',        status: 'IN_REPAIR',     customerId: c3.id } }),
    prisma.scooter.create({ data: { serialNumber: 'SG-W004', brand: 'Segway',        model: 'Ninebot Max',     status: 'IN_REPAIR',     customerId: c4.id } }),
    prisma.scooter.create({ data: { serialNumber: 'PA-W005', brand: 'Pure Electric', model: 'Pure Air Go',     status: 'IN_REPAIR',     customerId: c5.id } }),
    prisma.scooter.create({ data: { serialNumber: 'XM-W006', brand: 'Xiaomi',        model: 'M365',            status: 'IN_REPAIR',     customerId: c6.id } }),
    prisma.scooter.create({ data: { serialNumber: 'SG-W007', brand: 'Segway',        model: 'G30',             status: 'READY_TO_SHIP', customerId: c1.id } }),
    prisma.scooter.create({ data: { serialNumber: 'PA-W008', brand: 'Pure Electric', model: 'Pure Air Pro 2',  status: 'IN_REPAIR',     customerId: c2.id } }),
    // BGRADE scooters
    prisma.scooter.create({ data: { serialNumber: 'BG-B001', brand: 'Xiaomi',        model: 'M365',            status: 'IN_REPAIR'  } }),
    prisma.scooter.create({ data: { serialNumber: 'BG-B002', brand: 'Segway',        model: 'Ninebot Max G30', status: 'IN_REPAIR'  } }),
    prisma.scooter.create({ data: { serialNumber: 'BG-B003', brand: 'Pure Electric', model: 'Pure Air',        status: 'IN_REPAIR'  } }),
    prisma.scooter.create({ data: { serialNumber: 'BG-B004', brand: 'Xiaomi',        model: 'Mi Pro 2',        status: 'IN_REPAIR',  colour: 'Black', totalMileage: 1240, grade: 'B' } }),
  ])

  const [s1,s2,s3,s4,s5,s6,s7,s8,bg1,bg2,bg3,bg4] = scooters

  // ── Helper: order number generator ────────────────────────────────────────
  let orderSeq = 1
  const nextOrder = () => `RO-${String(orderSeq++).padStart(6, '0')}`

  // ── WARRANTY CASES — all stages covered ────────────────────────────────────
  console.log('Creating warranty cases...')

  // 1. AWAITING_INBOUND — CS just created
  const case1 = await prisma.repairOrder.create({
    data: {
      orderNumber:       nextOrder(),
      scooterId:         s1.id,
      customerId:        c1.id,
      faultDescription:  'Scooter does not power on. Customer says it stopped working after riding in rain.',
      status:            'AWAITING_INBOUND',
      priority:          'HIGH',
      caseType:          'WARRANTY',
      customerPrepaid:   false,
      warrantyConfirmed: true,
      csPaymentNote:     'Under warranty — invoice #INV-2026-0041',
      barcodeAssigned:   false,
      currentLocationId: loc('INBOUND'),
    },
  })
  await prisma.invoiceReference.create({ data: { caseId: case1.id, invoiceNumber: 'INV-2026-0041', paymentStatus: 'WARRANTY_APPROVED', updatedById: csUser.id } })
  await prisma.caseStatusHistory.create({ data: { caseId: case1.id, fromStatus: null, toStatus: 'AWAITING_INBOUND', changedById: csUser.id, reason: 'CS created warranty case' } })
  await prisma.caseComment.create({ data: { caseId: case1.id, authorId: csUser.id, content: 'Customer called in — scooter stopped working after light rain exposure. Still within 12-month warranty.', isCustomerFacing: false } })

  // 2. AWAITING_CS — Inbound scanned, waiting for CS payment approval
  const case2 = await prisma.repairOrder.create({
    data: {
      orderNumber:       nextOrder(),
      scooterId:         s2.id,
      customerId:        c2.id,
      faultDescription:  'Battery draining extremely fast — barely 5km range now.',
      diagnosis:         'Battery cells degraded, BMS throwing fault codes. Needs new 36V pack.',
      status:            'AWAITING_CS',
      priority:          'NORMAL',
      caseType:          'WARRANTY',
      customerPrepaid:   false,
      warrantyConfirmed: false,
      barcodeAssigned:   true,
      currentLocationId: loc('WARRANTY'),
    },
  })
  await prisma.invoiceReference.create({ data: { caseId: case2.id, invoiceNumber: 'INV-2026-0038', paymentStatus: 'UNPAID', updatedById: csUser.id } })
  await prisma.errorCodeReport.create({ data: { caseId: case2.id, errorCode: 'E02' } })
  await prisma.caseStatusHistory.createMany({ data: [
    { caseId: case2.id, fromStatus: null, toStatus: 'AWAITING_INBOUND', changedById: csUser.id, reason: 'CS created case' },
    { caseId: case2.id, fromStatus: 'AWAITING_INBOUND', toStatus: 'AWAITING_CS', changedById: warehouse1.id, reason: 'Scooter received — sent to CS for payment confirmation' },
  ]})

  // 3. WAITING_FOR_MECHANIC — CS approved, mechanic not yet assigned
  const case3 = await prisma.repairOrder.create({
    data: {
      orderNumber:       nextOrder(),
      scooterId:         s3.id,
      customerId:        c3.id,
      faultDescription:  'Throttle sometimes cuts out mid-ride. Intermittent issue.',
      diagnosis:         'Throttle hall sensor failing. Controller also showing E04 under load.',
      status:            'WAITING_FOR_MECHANIC',
      priority:          'NORMAL',
      caseType:          'WARRANTY',
      customerPrepaid:   true,
      warrantyConfirmed: true,
      csPaymentNote:     'Prepaid £45 for parts on 2026-04-18',
      barcodeAssigned:   true,
      currentLocationId: loc('MECH_Q'),
    },
  })
  await prisma.invoiceReference.create({ data: { caseId: case3.id, invoiceNumber: 'INV-2026-0035', paymentStatus: 'PAID', updatedById: csUser.id } })
  await prisma.errorCodeReport.createMany({ data: [{ caseId: case3.id, errorCode: 'E05' }, { caseId: case3.id, errorCode: 'E04' }] })
  await prisma.caseStatusHistory.createMany({ data: [
    { caseId: case3.id, fromStatus: null,              toStatus: 'AWAITING_INBOUND',     changedById: csUser.id,      reason: 'CS created case' },
    { caseId: case3.id, fromStatus: 'AWAITING_INBOUND', toStatus: 'WAITING_FOR_MECHANIC', changedById: warehouse1.id, reason: 'Prepaid — sent directly to mechanic' },
  ]})

  // 4. IN_REPAIR — mechanic assigned and working
  const repairStart4 = new Date(Date.now() - 90 * 60000)
  const case4 = await prisma.repairOrder.create({
    data: {
      orderNumber:           nextOrder(),
      scooterId:             s4.id,
      customerId:            c4.id,
      mechanicId:            mechanic1.id,
      faultDescription:      'Rear brake completely ineffective. Front brake also feels soft.',
      diagnosis:             'Rear brake cable snapped. Front brake pads worn to metal.',
      status:                'IN_REPAIR',
      priority:              'HIGH',
      caseType:              'WARRANTY',
      customerPrepaid:       true,
      warrantyConfirmed:     true,
      barcodeAssigned:       true,
      repairStartedAt:       repairStart4,
      currentLocationId:     loc('MECH_Q'),
    },
  })
  await prisma.invoiceReference.create({ data: { caseId: case4.id, invoiceNumber: 'INV-2026-0032', paymentStatus: 'WARRANTY_APPROVED', updatedById: csUser.id } })
  await prisma.errorCodeReport.create({ data: { caseId: case4.id, errorCode: 'E06' } })
  await prisma.repairTimeLog.create({ data: { caseId: case4.id, mechanicId: mechanic1.id, startedAt: repairStart4 } })
  await prisma.repairPart.create({ data: { repairOrderId: case4.id, partId: parts[0].id, quantity: 1 } })
  await prisma.caseStatusHistory.createMany({ data: [
    { caseId: case4.id, fromStatus: null, toStatus: 'AWAITING_INBOUND', changedById: csUser.id, reason: 'CS created case' },
    { caseId: case4.id, fromStatus: 'AWAITING_INBOUND', toStatus: 'WAITING_FOR_MECHANIC', changedById: warehouse1.id, reason: 'Prepaid — sent to mechanic' },
    { caseId: case4.id, fromStatus: 'WAITING_FOR_MECHANIC', toStatus: 'IN_REPAIR', changedById: mechanic1.id, reason: 'Mechanic started repair' },
  ]})

  // 5. AWAITING_PARTS
  const case5 = await prisma.repairOrder.create({
    data: {
      orderNumber:       nextOrder(),
      scooterId:         s5.id,
      customerId:        c5.id,
      mechanicId:        mechanic2.id,
      faultDescription:  'Screen not working, shows nothing.',
      diagnosis:         'Display board completely failed. Need replacement unit.',
      status:            'AWAITING_PARTS',
      priority:          'NORMAL',
      caseType:          'WARRANTY',
      customerPrepaid:   false,
      warrantyConfirmed: true,
      barcodeAssigned:   true,
      currentLocationId: loc('MECH_Q'),
      currentPalletId:   palletHolding1.id,
    },
  })
  await prisma.invoiceReference.create({ data: { caseId: case5.id, invoiceNumber: 'INV-2026-0029', paymentStatus: 'WARRANTY_APPROVED', updatedById: csUser.id } })
  await prisma.errorCodeReport.create({ data: { caseId: case5.id, errorCode: 'E07' } })
  await prisma.palletItem.create({ data: { palletId: palletHolding1.id, repairOrderId: case5.id, addedById: warehouse1.id } })
  await prisma.caseStatusHistory.createMany({ data: [
    { caseId: case5.id, fromStatus: null, toStatus: 'AWAITING_INBOUND', changedById: csUser.id, reason: 'CS created case' },
    { caseId: case5.id, fromStatus: 'AWAITING_INBOUND', toStatus: 'WAITING_FOR_MECHANIC', changedById: warehouse1.id, reason: 'Sent to mechanic' },
    { caseId: case5.id, fromStatus: 'WAITING_FOR_MECHANIC', toStatus: 'IN_REPAIR', changedById: mechanic2.id, reason: 'Started repair' },
    { caseId: case5.id, fromStatus: 'IN_REPAIR', toStatus: 'AWAITING_PARTS', changedById: mechanic2.id, reason: 'Awaiting parts: display board P-006' },
  ]})
  await prisma.caseComment.create({ data: { caseId: case5.id, authorId: mechanic2.id, content: 'Display board needed — part P-006. Ordered from TechParts UK, expected in 3 days.', isCustomerFacing: false } })

  // 6. QUALITY_CONTROL
  const repairEnd6 = new Date(Date.now() - 30 * 60000)
  const case6 = await prisma.repairOrder.create({
    data: {
      orderNumber:           nextOrder(),
      scooterId:             s6.id,
      customerId:            c6.id,
      mechanicId:            mechanic1.id,
      faultDescription:      'Keeps beeping with E01 error code, wont move.',
      diagnosis:             'Wheel sensor loose and controller reset needed.',
      resolution:            'Re-seated wheel sensor, flashed controller firmware.',
      status:                'QUALITY_CONTROL',
      priority:              'NORMAL',
      caseType:              'WARRANTY',
      customerPrepaid:       true,
      warrantyConfirmed:     true,
      barcodeAssigned:       true,
      repairStartedAt:       new Date(Date.now() - 180 * 60000),
      repairCompletedAt:     repairEnd6,
      repairDurationMinutes: 150,
      currentLocationId:     loc('QC'),
    },
  })
  await prisma.invoiceReference.create({ data: { caseId: case6.id, invoiceNumber: 'INV-2026-0025', paymentStatus: 'WARRANTY_APPROVED', updatedById: csUser.id } })
  await prisma.errorCodeReport.create({ data: { caseId: case6.id, errorCode: 'E01' } })
  await prisma.caseStatusHistory.createMany({ data: [
    { caseId: case6.id, fromStatus: null, toStatus: 'AWAITING_INBOUND', changedById: csUser.id, reason: 'CS created case' },
    { caseId: case6.id, fromStatus: 'AWAITING_INBOUND', toStatus: 'WAITING_FOR_MECHANIC', changedById: warehouse1.id, reason: 'Sent to mechanic' },
    { caseId: case6.id, fromStatus: 'WAITING_FOR_MECHANIC', toStatus: 'IN_REPAIR', changedById: mechanic1.id, reason: 'Started repair' },
    { caseId: case6.id, fromStatus: 'IN_REPAIR', toStatus: 'QUALITY_CONTROL', changedById: mechanic1.id, reason: 'Repair completed' },
  ]})

  // 7. READY_TO_SHIP — QC passed
  const case7 = await prisma.repairOrder.create({
    data: {
      orderNumber:           nextOrder(),
      scooterId:             s7.id,
      customerId:            c1.id,
      mechanicId:            mechanic2.id,
      faultDescription:      'Folding latch broken — stem wont lock.',
      diagnosis:             'Latch clip broken. Replaced with new part.',
      resolution:            'Replaced stem latch clip P-008.',
      status:                'READY_TO_SHIP',
      priority:              'NORMAL',
      caseType:              'WARRANTY',
      customerPrepaid:       false,
      warrantyConfirmed:     true,
      barcodeAssigned:       true,
      repairStartedAt:       new Date(Date.now() - 5 * 3600000),
      repairCompletedAt:     new Date(Date.now() - 2 * 3600000),
      repairDurationMinutes: 45,
      qcPassed:              true,
      currentLocationId:     loc('DISPATCH'),
    },
  })
  await prisma.invoiceReference.create({ data: { caseId: case7.id, invoiceNumber: 'INV-2026-0020', paymentStatus: 'WARRANTY_APPROVED', updatedById: csUser.id } })
  await prisma.repairPart.create({ data: { repairOrderId: case7.id, partId: parts[7].id, quantity: 2 } })
  await prisma.caseStatusHistory.createMany({ data: [
    { caseId: case7.id, fromStatus: null, toStatus: 'AWAITING_INBOUND', changedById: csUser.id, reason: 'CS created case' },
    { caseId: case7.id, fromStatus: 'AWAITING_INBOUND', toStatus: 'WAITING_FOR_MECHANIC', changedById: warehouse1.id, reason: 'Sent to mechanic' },
    { caseId: case7.id, fromStatus: 'WAITING_FOR_MECHANIC', toStatus: 'IN_REPAIR', changedById: mechanic2.id, reason: 'Started repair' },
    { caseId: case7.id, fromStatus: 'IN_REPAIR', toStatus: 'QUALITY_CONTROL', changedById: mechanic2.id, reason: 'Repair done' },
    { caseId: case7.id, fromStatus: 'QUALITY_CONTROL', toStatus: 'READY_TO_SHIP', changedById: warehouse1.id, reason: 'QC passed' },
  ]})

  // 8. DISPUTED
  const case8 = await prisma.repairOrder.create({
    data: {
      orderNumber:       nextOrder(),
      scooterId:         s8.id,
      customerId:        c2.id,
      faultDescription:  'Scooter has physical crack on deck — customer claiming warranty.',
      diagnosis:         'Physical impact damage — crack on deck near rear wheel. Not covered by warranty.',
      status:            'DISPUTED',
      priority:          'HIGH',
      caseType:          'WARRANTY',
      customerPrepaid:   false,
      warrantyConfirmed: false,
      barcodeAssigned:   true,
      currentLocationId: loc('WARRANTY'),
    },
  })
  await prisma.invoiceReference.create({ data: { caseId: case8.id, invoiceNumber: 'INV-2026-0018', paymentStatus: 'DISPUTED', updatedById: csUser.id } })
  await prisma.errorCodeReport.create({ data: { caseId: case8.id, errorCode: 'PHYSICAL_CRACK' } })
  await prisma.caseStatusHistory.createMany({ data: [
    { caseId: case8.id, fromStatus: null, toStatus: 'AWAITING_INBOUND', changedById: csUser.id, reason: 'CS created case' },
    { caseId: case8.id, fromStatus: 'AWAITING_INBOUND', toStatus: 'AWAITING_CS', changedById: warehouse1.id, reason: 'Physical damage found — need CS review' },
    { caseId: case8.id, fromStatus: 'AWAITING_CS', toStatus: 'DISPUTED', changedById: csUser.id, reason: 'Physical impact — not under warranty, customer disputing' },
  ]})
  await prisma.caseComment.createMany({ data: [
    { caseId: case8.id, authorId: warehouse1.id, content: 'Crack runs along the deck near rear wheel. Looks like an impact — not a manufacturing defect.', isCustomerFacing: false },
    { caseId: case8.id, authorId: csUser.id, content: 'Customer insisting it was a pre-existing crack. Manager review requested.', isCustomerFacing: false },
    { caseId: case8.id, authorId: csUser.id, content: 'We are reviewing your warranty claim. Our inbound team identified physical impact damage which may affect coverage. We will follow up within 2 business days.', isCustomerFacing: true },
  ]})

  // ── BGRADE CASES ──────────────────────────────────────────────────────────
  console.log('Creating B-grade cases...')

  // BG1: WAITING_FOR_MECHANIC (freshly received, on pallet)
  const bgCase1 = await prisma.repairOrder.create({
    data: {
      orderNumber:       nextOrder(),
      scooterId:         bg1.id,
      customerId:        (await prisma.customer.create({ data: { name: 'Unknown — BG-B001', postcode: 'UNKNOWN' } })).id,
      faultDescription:  'B-grade intake from Currys',
      internalNotes:     'Good cosmetic condition, minor scuffs on deck',
      status:            'WAITING_FOR_MECHANIC',
      priority:          'NORMAL',
      caseType:          'BGRADE',
      source:            'Currys',
      barcodeAssigned:   true,
      currentLocationId: loc('BGRADE'),
      currentPalletId:   palletBG1.id,
    },
  })
  await prisma.palletItem.create({ data: { palletId: palletBG1.id, repairOrderId: bgCase1.id, addedById: warehouse1.id } })
  await prisma.caseStatusHistory.createMany({ data: [
    { caseId: bgCase1.id, fromStatus: null, toStatus: 'AWAITING_INBOUND', changedById: warehouse1.id, reason: 'B-grade case created by inbound' },
    { caseId: bgCase1.id, fromStatus: 'AWAITING_INBOUND', toStatus: 'WAITING_FOR_MECHANIC', changedById: warehouse1.id, reason: 'B-grade scooter received — assigned to mechanic queue' },
  ]})

  // BG2: IN_REPAIR (mechanic working on it)
  const bgStart2 = new Date(Date.now() - 60 * 60000)
  const bgCase2 = await prisma.repairOrder.create({
    data: {
      orderNumber:       nextOrder(),
      scooterId:         bg2.id,
      customerId:        (await prisma.customer.create({ data: { name: 'Unknown — BG-B002', postcode: 'UNKNOWN' } })).id,
      mechanicId:        mechanic2.id,
      faultDescription:  'B-grade intake from Argos',
      diagnosis:         'Worn tyres, brake pads need replacement. Battery at 80%.',
      status:            'IN_REPAIR',
      priority:          'NORMAL',
      caseType:          'BGRADE',
      source:            'Argos',
      barcodeAssigned:   true,
      repairStartedAt:   bgStart2,
      currentLocationId: loc('MECH_Q'),
      currentPalletId:   palletBG1.id,
    },
  })
  await prisma.palletItem.create({ data: { palletId: palletBG1.id, repairOrderId: bgCase2.id, addedById: warehouse1.id } })
  await prisma.repairTimeLog.create({ data: { caseId: bgCase2.id, mechanicId: mechanic2.id, startedAt: bgStart2 } })
  await prisma.caseStatusHistory.createMany({ data: [
    { caseId: bgCase2.id, fromStatus: null, toStatus: 'AWAITING_INBOUND', changedById: warehouse1.id, reason: 'B-grade created' },
    { caseId: bgCase2.id, fromStatus: 'AWAITING_INBOUND', toStatus: 'WAITING_FOR_MECHANIC', changedById: warehouse1.id, reason: 'Received' },
    { caseId: bgCase2.id, fromStatus: 'WAITING_FOR_MECHANIC', toStatus: 'IN_REPAIR', changedById: mechanic2.id, reason: 'Started repair' },
  ]})

  // BG3: QUALITY_CONTROL
  const bgCase3 = await prisma.repairOrder.create({
    data: {
      orderNumber:           nextOrder(),
      scooterId:             bg3.id,
      customerId:            (await prisma.customer.create({ data: { name: 'Unknown — BG-B003', postcode: 'UNKNOWN' } })).id,
      mechanicId:            mechanic1.id,
      faultDescription:      'B-grade intake from John Lewis',
      diagnosis:             'Worn brake cable and grip tape. Battery good at 90%.',
      resolution:            'Replaced brake cable, new grip tape applied, cleaned and tested.',
      status:                'QUALITY_CONTROL',
      priority:              'NORMAL',
      caseType:              'BGRADE',
      source:                'John Lewis',
      barcodeAssigned:       true,
      repairStartedAt:       new Date(Date.now() - 4 * 3600000),
      repairCompletedAt:     new Date(Date.now() - 1 * 3600000),
      repairDurationMinutes: 180,
      currentLocationId:     loc('QC'),
      currentPalletId:       palletBG2.id,
    },
  })
  await prisma.palletItem.create({ data: { palletId: palletBG2.id, repairOrderId: bgCase3.id, addedById: warehouse1.id } })
  await prisma.caseStatusHistory.createMany({ data: [
    { caseId: bgCase3.id, fromStatus: null, toStatus: 'AWAITING_INBOUND', changedById: warehouse1.id, reason: 'Created' },
    { caseId: bgCase3.id, fromStatus: 'AWAITING_INBOUND', toStatus: 'WAITING_FOR_MECHANIC', changedById: warehouse1.id, reason: 'Received' },
    { caseId: bgCase3.id, fromStatus: 'WAITING_FOR_MECHANIC', toStatus: 'IN_REPAIR', changedById: mechanic1.id, reason: 'Started' },
    { caseId: bgCase3.id, fromStatus: 'IN_REPAIR', toStatus: 'QUALITY_CONTROL', changedById: mechanic1.id, reason: 'Repair done — sent to QC' },
  ]})
  await prisma.repairPart.create({ data: { repairOrderId: bgCase3.id, partId: parts[0].id, quantity: 1 } })

  // BG4: BGRADE_RECORDED — fully through the pipeline
  const bgCase4 = await prisma.repairOrder.create({
    data: {
      orderNumber:           nextOrder(),
      scooterId:             bg4.id,
      customerId:            (await prisma.customer.create({ data: { name: 'Unknown — BG-B004', postcode: 'UNKNOWN' } })).id,
      mechanicId:            mechanic1.id,
      faultDescription:      'B-grade intake — trade-in unit',
      diagnosis:             'Normal wear. Tyres slightly worn. All electronics functional.',
      resolution:            'Service and clean. New grip tape. Grade B assigned.',
      status:                'BGRADE_RECORDED',
      priority:              'NORMAL',
      caseType:              'BGRADE',
      source:                'Trade-in',
      barcodeAssigned:       true,
      repairStartedAt:       new Date(Date.now() - 2 * 24 * 3600000),
      repairCompletedAt:     new Date(Date.now() - 1 * 24 * 3600000),
      repairDurationMinutes: 120,
      qcPassed:              true,
      currentLocationId:     loc('BGRADE'),
      currentPalletId:       palletBG2.id,
    },
  })
  await prisma.palletItem.create({ data: { palletId: palletBG2.id, repairOrderId: bgCase4.id, addedById: warehouse1.id } })
  await prisma.caseStatusHistory.createMany({ data: [
    { caseId: bgCase4.id, fromStatus: null, toStatus: 'AWAITING_INBOUND', changedById: warehouse1.id, reason: 'Created' },
    { caseId: bgCase4.id, fromStatus: 'AWAITING_INBOUND', toStatus: 'WAITING_FOR_MECHANIC', changedById: warehouse1.id, reason: 'Received' },
    { caseId: bgCase4.id, fromStatus: 'WAITING_FOR_MECHANIC', toStatus: 'IN_REPAIR', changedById: mechanic1.id, reason: 'Started' },
    { caseId: bgCase4.id, fromStatus: 'IN_REPAIR', toStatus: 'QUALITY_CONTROL', changedById: mechanic1.id, reason: 'Done' },
    { caseId: bgCase4.id, fromStatus: 'QUALITY_CONTROL', toStatus: 'BGRADE_RECORDED', changedById: warehouse1.id, reason: 'QC passed — B-grade recorded to pallet' },
  ]})

  // ── Stock Movements ───────────────────────────────────────────────────────
  console.log('Creating stock movements...')
  await prisma.stockMovement.createMany({
    data: [
      { partId: parts[0].id, delta: 30,  reason: 'PURCHASE_IN',      notes: 'Initial stock order',         performedById: admin.id },
      { partId: parts[0].id, delta: -5,  reason: 'REPAIR_CONSUMED',  referenceId: case4.id, notes: 'Used in repair',     performedById: mechanic1.id },
      { partId: parts[1].id, delta: 50,  reason: 'PURCHASE_IN',      notes: 'Initial stock order',         performedById: admin.id },
      { partId: parts[2].id, delta: 10,  reason: 'PURCHASE_IN',      notes: 'Initial stock order',         performedById: admin.id },
      { partId: parts[2].id, delta: -2,  reason: 'REPAIR_CONSUMED',  notes: 'Used in various repairs',     performedById: mechanic2.id },
      { partId: parts[3].id, delta: 8,   reason: 'PURCHASE_IN',      notes: 'Initial stock order',         performedById: admin.id },
      { partId: parts[3].id, delta: -2,  reason: 'REPAIR_CONSUMED',  notes: 'Used in repairs',             performedById: mechanic1.id },
      { partId: parts[7].id, delta: 60,  reason: 'PURCHASE_IN',      notes: 'Initial stock order',         performedById: admin.id },
      { partId: parts[7].id, delta: -10, reason: 'REPAIR_CONSUMED',  referenceId: case7.id, notes: 'Used in repair', performedById: mechanic2.id },
      { partId: parts[8].id, delta: 5,   reason: 'PURCHASE_IN',      notes: 'Initial stock order',         performedById: admin.id },
      { partId: parts[9].id, delta: 25,  reason: 'PURCHASE_IN',      notes: 'Initial stock order',         performedById: admin.id },
    ],
  })

  // ── Phase B: CustomerNotification audit trail ────────────────────────────
  // A small spread across SENT / QUEUED / FAILED states + both channels so
  // the audit trail is non-empty when CS opens a case.
  //
  // case1 (c1, EMAIL pref) — sent arrival email
  // case2 (c2, SMS pref)   — queued recharge SMS (will be flushed in Step 7)
  // case3 (c3, BOTH pref)  — sent both an email and an SMS for the same event
  // case4 (c4, NONE pref)  — failed email (NONE pref → would skip in real flow,
  //                          but useful to demonstrate the FAILED state)
  // case6 (c6, BOTH pref)  — manual link share by CS
  console.log('Creating customer notifications...')
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
  await prisma.customerNotification.createMany({
    data: [
      {
        caseId:       case1.id,
        channel:      'EMAIL',
        recipient:    'james@mail.com',
        status:       'SENT',
        subject:      'Your scooter has arrived at the workshop',
        body:         'Hi James — your Pure Air Pro arrived safely with our team. We\'ll start checking it over today.',
        triggerEvent: 'STATUS_CHANGE_INBOUND_DIAGNOSIS',
        sentAt:       twoHoursAgo,
      },
      {
        caseId:       case2.id,
        channel:      'SMS',
        recipient:    '07700900002',
        status:       'QUEUED',
        body:         'Hi Sarah — we\'ve found additional work needed on your scooter. Our team will be in touch with a quote shortly.',
        triggerEvent: 'STATUS_CHANGE_CS_RECHARGE',
      },
      {
        caseId:       case3.id,
        channel:      'EMAIL',
        recipient:    'daniel@mail.com',
        status:       'SENT',
        subject:      'Repair in progress',
        body:         'Hi Daniel — our technician has started work on your Xiaomi M365 Pro.',
        triggerEvent: 'STATUS_CHANGE_IN_REPAIR',
        sentAt:       oneHourAgo,
      },
      {
        caseId:       case3.id,
        channel:      'SMS',
        recipient:    '07700900003',
        status:       'SENT',
        body:         'Repair in progress on your Xiaomi M365 Pro. We\'ll text you again when it\'s ready for QC.',
        triggerEvent: 'STATUS_CHANGE_IN_REPAIR',
        sentAt:       oneHourAgo,
      },
      {
        caseId:       case4.id,
        channel:      'EMAIL',
        recipient:    'emily@mail.com',
        status:       'FAILED',
        subject:      'Repair started',
        body:         'Hi Emily — the technician has started work on your scooter.',
        triggerEvent: 'STATUS_CHANGE_IN_REPAIR',
        errorMessage: 'SMTP error: invalid recipient (placeholder seed data — real flow respects NONE preference and would not have sent).',
      },
      {
        caseId:       case6.id,
        channel:      'EMAIL',
        recipient:    'priya@mail.com',
        status:       'SENT',
        subject:      'Track your repair',
        body:         'Hi Priya — here\'s a private link to check on your repair: https://example.com/track/RO-000006?token=...',
        triggerEvent: 'MANUAL_LINK_SHARE',
        sentAt:       oneHourAgo,
      },
    ],
  })

  // ── Phase A: RepairGuide placeholder dataset ─────────────────────────────
  // Small starter set so the workshop's guide picker has content to show.
  // Real authored guides will replace these in a future phase.
  const guideRows: Array<{
    scooterModel: string
    brand?:       string
    title:        string
    body:         string
    category?:    string
  }> = [
    {
      scooterModel: 'Pure Air Pro',
      brand:        'Pure Electric',
      category:     'brakes',
      title:        'Replace front brake pads',
      body: `# Replace front brake pads — Pure Air Pro

**Tools:** 4 mm Allen key, torque wrench, brake-cleaner spray.

1. Lift the scooter onto a stand. Remove the front wheel by undoing the two M5 bolts on the fork.
2. Pop the brake calliper off. Note which way the pads are facing.
3. Inspect the rotor for grooves; if there's > 0.5 mm wear, flag for rotor replacement instead.
4. Slide new pads in. Apply a tiny dab of copper grease to the back of each pad.
5. Reseat the calliper, torque the bolts to **6 Nm**.
6. Spin the wheel and squeeze the lever — pads should bite cleanly with no rub.

> Bedding-in: brake from 15 to 5 km/h ten times before declaring complete.`,
    },
    {
      scooterModel: 'Pure Air Pro',
      brand:        'Pure Electric',
      category:     'battery',
      title:        'Battery cell-pack diagnostic',
      body: `# Battery cell-pack diagnostic — Pure Air Pro

1. Power off, disconnect the battery harness.
2. Probe each cell group with a multimeter — they should be within **0.05 V** of each other.
3. Anything > 0.1 V apart: log a recharge to CS for a battery replacement quote.
4. If all cells balanced but capacity reading is < 70 %: same — needs replacement.
5. If all good: reseat the BMS connector and confirm error code clears with the diagnostic app.`,
    },
    {
      scooterModel: 'Pure Air Go',
      brand:        'Pure Electric',
      category:     'wheel',
      title:        'Front wheel bearing replacement',
      body: `# Front wheel bearing replacement — Pure Air Go

1. Remove the wheel (two M5 fork bolts).
2. Use a bearing puller to extract both inner bearings.
3. Clean the hub seat with brake cleaner — no metal shavings left behind.
4. Press in fresh **608-2RS** bearings, one per side, until flush.
5. Reinstall, torque the fork bolts to **8 Nm**, spin to confirm zero wobble.`,
    },
    {
      scooterModel: 'M365',
      brand:        'Xiaomi',
      category:     'controller',
      title:        'Reset controller after E-04 error',
      body: `# Reset controller after E-04 — Xiaomi M365

E-04 means the controller has lost handshake with the dash.

1. Power off, unplug the dashboard ribbon cable.
2. Inspect for bent pins on either end. Re-seat firmly.
3. Power on. If E-04 persists: swap in a known-good dashboard from spares.
4. Still failing → flag to CS for a controller replacement quote.`,
    },
    {
      scooterModel: 'M365 Pro',
      brand:        'Xiaomi',
      category:     'brakes',
      title:        'Rear disc-brake adjustment',
      body: `# Rear disc-brake adjustment — Xiaomi M365 Pro

1. Loosen the calliper mounting bolts a quarter-turn.
2. Squeeze the brake lever firmly and hold.
3. Re-tighten the calliper bolts while holding the lever — this self-aligns the calliper to the rotor.
4. Release the lever. Spin the wheel — should be free of rub.
5. If the lever feels spongy after, bleed the line.`,
    },
    {
      scooterModel: 'Ninebot Max',
      brand:        'Segway',
      category:     'tyre',
      title:        'Repair tubeless rear tyre puncture',
      body: `# Repair tubeless rear puncture — Segway Ninebot Max

1. Locate the puncture (soapy water bubble test).
2. Mark and remove any embedded debris.
3. Insert a tubeless plug strip with the insertion tool — twist 90° as you push in.
4. Trim flush. Re-inflate to **45 PSI**.
5. Re-test for leaks; if it holds for 5 minutes, complete.`,
    },
    {
      scooterModel: 'G30',
      brand:        'Segway',
      category:     'controller',
      title:        'Firmware update via Ninebot app',
      body: `# Firmware update — Segway G30

1. Charge the scooter to >= 50 %.
2. Pair to the test phone via the Ninebot app.
3. Trigger firmware update; **do not power off** until the dash shows "complete".
4. Reboot, verify version in the About screen matches the latest known good (currently 1.7.4).`,
    },
  ]

  // Idempotent-ish: only seed when the table is empty so re-running seed
  // doesn't duplicate rows.
  const existingGuideCount = await prisma.repairGuide.count()
  if (existingGuideCount === 0) {
    await prisma.repairGuide.createMany({ data: guideRows })
    console.log(`   Repair guides: ${guideRows.length}`)
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete!')
  console.log(`   Locations: ${locs.length}`)
  console.log(`   Users:     6 (admin, manager, 2 mechanics, warehouse, CS)`)
  console.log(`   Templates: 10 QC steps`)
  console.log(`   Customers: 6`)
  console.log(`   Parts:     12`)
  console.log(`   Pallets:   3`)
  console.log(`   Scooters:  12`)
  console.log(`   Cases:     12 (8 warranty + 4 b-grade, all pipeline stages covered)`)
  console.log(`   Customer notifications: 6 (mix of SENT / QUEUED / FAILED, EMAIL + SMS)`)
  console.log('\n📋 Test scenarios:')
  console.log('   WARRANTY: AWAITING_INBOUND → AWAITING_CS → WAITING_FOR_MECHANIC → IN_REPAIR → AWAITING_PARTS → QUALITY_CONTROL → READY_TO_SHIP → DISPUTED')
  console.log('   BGRADE:   WAITING_FOR_MECHANIC → IN_REPAIR → QUALITY_CONTROL → BGRADE_RECORDED')
  console.log('\n📨 Phase B notification preference spread:')
  console.log('   c1 James  EMAIL   c2 Sarah  SMS    c3 Daniel BOTH')
  console.log('   c4 Emily  NONE    c5 Chris  EMAIL  c6 Priya  BOTH')
}

main().catch(e => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
