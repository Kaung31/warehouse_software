import { prisma } from '@/lib/prisma'
import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import QRCodeDisplay from '@/components/ui/QRCodeDisplay'
import LabelActions from '@/components/cases/LabelActions'

/**
 * /cases/[id]/label — printable repair ticket / label page.
 *
 * v2 changes (April 2026):
 *   • Removed the inline <style> tag — Next.js was warning about
 *     script tags during render, and inline <style> in a server
 *     component triggers the same path. All print-specific CSS
 *     now lives in globals.css under @media print.
 *   • Emojis (⚡ 🔒 ♻) replaced with inline SVG. Emojis print
 *     inconsistently — different fonts, different rendering, often
 *     missing on thermal printers entirely.
 *   • Type pill (Warranty / B-Grade) gets distinct color: blue for
 *     warranty (matching the header stripe), amber for B-grade
 *     (matching the rest of the app's B-grade visual treatment).
 *   • The label itself uses fixed hex colors — print MUST be
 *     predictable across devices and not depend on CSS custom
 *     properties or dark-mode variables.
 *   • Print sizing: the .label-card class in globals.css enforces
 *     A6 dimensions (105×148mm) when printed.
 *   • Removed unused `labelData` object.
 *
 * NOTE: Add the print CSS from print-styles.css to your globals.css
 * (under any existing @media print block, or as a new one at the end).
 */

type Ctx = { params: Promise<{ id: string }> }

export default async function LabelPage({ params }: Ctx) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  const { id } = await params

  const repair = await prisma.repairOrder.findUnique({
    where: { id },
    include: {
      scooter: { select: { serialNumber: true, brand: true, model: true } },
      customer: { select: { name: true, phone: true, email: true } },
      invoice: { select: { invoiceNumber: true, paymentStatus: true } },
    },
  })

  if (!repair) notFound()

  const fault =
    repair.faultDescription.slice(0, 100) +
    (repair.faultDescription.length > 100 ? '…' : '')

  const isWarranty = repair.caseType === 'WARRANTY'

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      {/* Action bar — hidden on print */}
      <div className="no-print">
        <LabelActions
          caseId={id}
          orderNumber={repair.orderNumber}
          customerEmail={repair.customer?.email ?? null}
          customerName={repair.customer?.name ?? null}
        />
      </div>

      {/* The label */}
      <div
        className="label-card"
        id="repair-label"
        style={{
          background: '#ffffff',
          border: '1px solid #d0d7de',
          borderRadius: 12,
          boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
          width: 420,
          maxWidth: '100%',
          overflow: 'hidden',
          marginTop: 20,
        }}
      >
        {/* Label header stripe */}
        <div
          style={{
            background: '#0969da',
            padding: '14px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            color: '#ffffff',
          }}
        >
          <span style={{ display: 'inline-flex', flexShrink: 0 }}>
            <BoltIcon size={22} />
          </span>
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: '-0.01em',
              }}
            >
              ScooterHub — Repair Ticket
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.75)' }}>
              Keep this label with your scooter
            </div>
          </div>
        </div>

        <div style={{ padding: '24px 24px 20px' }}>
          {/* QR + order number side by side */}
          <div
            style={{
              display: 'flex',
              gap: 20,
              alignItems: 'center',
              marginBottom: 20,
            }}
          >
            <QRCodeDisplay value={repair.orderNumber} size={130} />
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: '#888',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  marginBottom: 4,
                  fontWeight: 600,
                }}
              >
                Repair order
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                  letterSpacing: '0.04em',
                  color: '#000',
                  lineHeight: 1.2,
                }}
              >
                {repair.orderNumber}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: '#555' }}>
                Scan the QR code or quote the order number above when
                contacting us.
              </div>
            </div>
          </div>

          {/* Divider */}
          <div
            style={{ borderTop: '1px solid #e0e0e0', marginBottom: 16 }}
          />

          {/* Info rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <LabelRow
              label="Scooter"
              value={`${repair.scooter.brand} ${repair.scooter.model}`}
            />
            <LabelRow
              label="Serial"
              value={repair.scooter.serialNumber}
              mono
            />
            {repair.customer?.name && (
              <LabelRow label="Customer" value={repair.customer.name} />
            )}
            {repair.customer?.phone && (
              <LabelRow label="Phone" value={repair.customer.phone} />
            )}
            <LabelRow
              label="Type"
              value={
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: isWarranty ? '#e7f1ff' : '#fff7e6',
                    color: isWarranty ? '#0969da' : '#b45309',
                    fontWeight: 600,
                    fontSize: 12,
                  }}
                >
                  {isWarranty ? (
                    <LockIcon size={11} />
                  ) : (
                    <RecycleIcon size={11} />
                  )}
                  {isWarranty ? 'Warranty repair' : 'B-Grade assessment'}
                </span>
              }
            />
            <LabelRow label="Fault" value={fault} />
          </div>

          {/* Footer */}
          <div
            style={{
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px dashed #ccc',
              fontSize: 10,
              color: '#999',
              textAlign: 'center',
              lineHeight: 1.7,
            }}
          >
            This label confirms your scooter is registered in our repair
            system.
            <br />
            Attach securely to the scooter or packaging before sending.
          </div>
        </div>
      </div>

      <div
        className="no-print"
        style={{
          marginTop: 12,
          fontSize: 12,
          color: 'var(--text-faint)',
        }}
      >
        Print or screenshot to attach physically to the scooter.
      </div>
    </div>
  )
}


function LabelRow({
  label,
  value,
  mono,
}: {
  label: string
  value: React.ReactNode
  mono?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 13 }}>
      <span
        style={{
          width: 64,
          flexShrink: 0,
          fontSize: 11,
          color: '#888',
          paddingTop: 1,
          fontWeight: 500,
        }}
      >
        {label}
      </span>
      <span
        style={{
          color: '#111',
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace'
            : 'inherit',
          fontWeight: mono ? 600 : 400,
          minWidth: 0,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </span>
    </div>
  )
}


/* ─── Inline icons (work on print, no Unicode dependency) ─────────────── */

function BoltIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
    >
      <path d="M13 2L3 14h7v8l10-12h-7V2z" />
    </svg>
  )
}

function LockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function RecycleIcon({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 19H4.815a1.83 1.83 0 0 1-1.57-.881 1.785 1.785 0 0 1-.004-1.784L7.196 9.5" />
      <path d="M11 19h8.203a1.83 1.83 0 0 0 1.556-.89 1.784 1.784 0 0 0 0-1.775l-1.226-2.12" />
      <path d="M14 16l-3 3 3 3" />
      <path d="M8.293 13.596 7.196 9.5 3.1 10.598" />
      <path d="m9.344 5.811 1.093-1.892A1.83 1.83 0 0 1 11.985 3a1.784 1.784 0 0 1 1.546.888l3.943 6.843" />
      <path d="m13.378 9.633 4.096 1.098 1.097-4.096" />
    </svg>
  )
}