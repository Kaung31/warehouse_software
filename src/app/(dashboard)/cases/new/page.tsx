'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Btn from '@/components/ui/Btn'

type ScooterHistory = {
  id: string; orderNumber: string; status: string; faultDescription: string; createdAt: string
}

export default function NewCasePage() {
  const router    = useRouter()
  const serialRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    serialNumber:     '',
    brand:            '',
    model:            '',
    caseType:         '' as 'WARRANTY' | 'BGRADE' | '',
    customerName:     '',
    customerPostcode: '',
    customerPhone:    '',
    customerEmail:    '',
    invoiceNumber:    '',
    faultDescription: '',
    internalNotes:    '',
    priority:         'NORMAL',
  })
  const [history,   setHistory]   = useState<ScooterHistory[]>([])
  const [busy,      setBusy]      = useState(false)
  const [error,     setError]     = useState('')
  const [lookingUp, setLookingUp] = useState(false)

  useEffect(() => { serialRef.current?.focus() }, [])

  // Debounced serial lookup — auto-fills brand/model if scooter already in DB
  useEffect(() => {
    if (form.serialNumber.length < 4) { setHistory([]); return }
    const t = setTimeout(async () => {
      setLookingUp(true)
      const res  = await fetch(`/api/scooters?search=${encodeURIComponent(form.serialNumber)}&pageSize=1`)
      const d    = await res.json()
      const found = d.data?.scooters?.[0]
      if (found && found.serialNumber.toLowerCase() === form.serialNumber.toLowerCase()) {
        const r2 = await fetch(`/api/repairs?scooterId=${found.id}&pageSize=5`)
        const d2 = await r2.json()
        setHistory(d2.data?.repairs ?? [])
        setForm(f => ({ ...f, brand: found.brand || f.brand, model: found.model || f.model }))
      } else {
        setHistory([])
      }
      setLookingUp(false)
    }, 400)
    return () => clearTimeout(t)
  }, [form.serialNumber])

  function set(field: string, value: string) {
    setForm(f => ({ ...f, [field]: value }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.caseType) { setError('Select WARRANTY or B-GRADE'); return }
    setBusy(true); setError('')

    const res = await fetch('/api/cases/intake', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serialNumber:     form.serialNumber.trim().toUpperCase(),
        brand:            form.brand.trim(),
        model:            form.model.trim(),
        caseType:         form.caseType,
        customerName:     form.customerName.trim()     || undefined,
        customerPostcode: form.customerPostcode.trim() || undefined,
        customerPhone:    form.customerPhone.trim()    || undefined,
        customerEmail:    form.customerEmail.trim()    || undefined,
        invoiceNumber:    form.invoiceNumber.trim()    || undefined,
        faultDescription: form.faultDescription.trim(),
        internalNotes:    form.internalNotes.trim()   || undefined,
        priority:         form.priority,
      }),
    })

    setBusy(false)
    if (res.ok) {
      const { data } = await res.json()
      router.push(`/cases/${data.id}`)
    } else {
      const body = await res.json()
      setError(body.error ?? 'Failed to create case')
    }
  }

  const isWarranty = form.caseType === 'WARRANTY'
  const isBgrade   = form.caseType === 'BGRADE'

  return (
    <div className="fade-up">
      <PageHeader
        title="New case"
        sub="Stage 1 of 4 — CS creates the case folder"
        action={<Link href="/cases"><Btn variant="ghost" size="sm">← Back</Btn></Link>}
      />

      {/* Workflow steps indicator */}
      <div style={{
        display: 'flex', gap: 0, marginBottom: 24, background: 'var(--bg-surface)',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden',
      }}>
        {[
          { n: 1, label: 'CS Intake',      active: true  },
          { n: 2, label: 'Inbound Triage', active: false },
          { n: 3, label: 'Mechanic',       active: false },
          { n: 4, label: 'Outbound QC',    active: false },
        ].map((s, i) => (
          <div key={s.n} style={{
            flex: 1, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 8,
            background:  s.active ? 'var(--accent-dim)' : 'transparent',
            borderRight: i < 3 ? '1px solid var(--border)' : 'none',
          }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0,
              background: s.active ? 'var(--accent)' : 'var(--bg-raised)',
              color:      s.active ? '#fff' : 'var(--text-faint)',
            }}>
              {s.n}
            </div>
            <span style={{ fontSize: 12, fontWeight: s.active ? 600 : 400, color: s.active ? 'var(--accent)' : 'var(--text-faint)' }}>
              {s.label}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'flex-start' }}>
        {/* ─── Main form ─── */}
        <form onSubmit={submit}>
          <div className="card" style={{ padding: '24px 24px 8px' }}>

            {/* Serial number — customer provides this, or it's on their invoice */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8, display: 'block' }}>
                Serial number <Req />
              </label>
              <input
                ref={serialRef}
                value={form.serialNumber}
                onChange={e => set('serialNumber', e.target.value)}
                placeholder="From customer invoice or scooter sticker…"
                required
                style={{ fontSize: 18, padding: '14px 16px', fontFamily: 'var(--font-mono)', letterSpacing: '0.05em' }}
                autoComplete="off"
                autoCapitalize="characters"
              />
              {lookingUp && (
                <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 6 }}>Looking up scooter…</div>
              )}
            </div>

            {/* Brand + Model */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <Field label="Brand *">
                <input list="brands" value={form.brand} onChange={e => set('brand', e.target.value)}
                  placeholder="Pure, Xiaomi…" required />
                <datalist id="brands">
                  {['Pure','Xiaomi','Segway','Apollo','Kaabo','Vsett','Dualtron'].map(b => <option key={b} value={b} />)}
                </datalist>
              </Field>
              <Field label="Model *">
                <input list="models" value={form.model} onChange={e => set('model', e.target.value)}
                  placeholder="Pure Air, M365…" required />
                <datalist id="models">
                  {['Pure Air','Pure Air Pro','Xiaomi M365','Ninebot Max','Apollo City'].map(m => <option key={m} value={m} />)}
                </datalist>
              </Field>
            </div>

            <Divider />

            {/* Case type */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, display: 'block' }}>
                Case type <Req />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { key: 'WARRANTY', label: '🔒 WARRANTY', desc: 'Customer submitted with invoice', colour: 'var(--accent)' },
                  { key: 'BGRADE',   label: '♻ B-GRADE',   desc: 'Pre-owned / refurb grading',    colour: 'var(--amber)' },
                ].map(opt => (
                  <button key={opt.key} type="button" onClick={() => set('caseType', opt.key)}
                    style={{
                      padding: '16px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
                      border:      `2px solid ${form.caseType === opt.key ? opt.colour : 'var(--border)'}`,
                      borderRadius: 'var(--radius-lg)',
                      background:   form.caseType === opt.key ? opt.colour + '18' : 'var(--bg-raised)',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14, color: form.caseType === opt.key ? opt.colour : 'var(--text)', marginBottom: 4 }}>
                      {opt.label}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Customer details */}
            {(isWarranty || isBgrade) && (
              <>
                <Divider />
                <div style={{ marginBottom: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, display: 'block' }}>
                    Customer {isWarranty
                      ? <Req />
                      : <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>(optional)</span>}
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <Field label={isWarranty ? 'Full name *' : 'Full name'}>
                      <input value={form.customerName} onChange={e => set('customerName', e.target.value)}
                        placeholder="John Smith" required={isWarranty} />
                    </Field>
                    <Field label={isWarranty ? 'Postcode *' : 'Postcode'}>
                      <input value={form.customerPostcode} onChange={e => set('customerPostcode', e.target.value.toUpperCase())}
                        placeholder="SW1A 1AA" required={isWarranty} style={{ fontFamily: 'var(--font-mono)' }} />
                    </Field>
                    <Field label="Phone">
                      <input value={form.customerPhone} onChange={e => set('customerPhone', e.target.value)}
                        placeholder="07700 900000" />
                    </Field>
                    <Field label="Email">
                      <input type="email" value={form.customerEmail} onChange={e => set('customerEmail', e.target.value)}
                        placeholder="john@example.com" />
                    </Field>
                  </div>
                </div>
              </>
            )}

            {/* Invoice number (WARRANTY) */}
            {isWarranty && (
              <div style={{ marginBottom: 20 }}>
                <Field label="Invoice / ticket number *">
                  <input value={form.invoiceNumber} onChange={e => set('invoiceNumber', e.target.value)}
                    placeholder="INV-00123" required style={{ fontFamily: 'var(--font-mono)' }} />
                </Field>
              </div>
            )}

            <Divider />

            {/* Customer complaint — what the customer reported */}
            <Field label="Customer complaint *">
              <textarea rows={4} value={form.faultDescription} onChange={e => set('faultDescription', e.target.value)}
                placeholder="Describe the fault or issue as reported by the customer…"
                required style={{ resize: 'vertical' }} />
            </Field>

            <div style={{ padding: '10px 14px', background: 'var(--bg-raised)', borderRadius: 'var(--radius)', border: '1px solid var(--border-muted)', fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
              Error codes and technical diagnosis will be recorded by the <strong>Inbound team</strong> when the scooter physically arrives.
            </div>

            {/* Priority + internal notes */}
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 16, marginBottom: 8 }}>
              <Field label="Priority">
                <select value={form.priority} onChange={e => set('priority', e.target.value)}>
                  <option value="LOW">Low</option>
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </Field>
              <Field label="Internal notes">
                <input value={form.internalNotes} onChange={e => set('internalNotes', e.target.value)}
                  placeholder="Visible to staff only…" />
              </Field>
            </div>

            {error && (
              <div style={{
                padding: '10px 14px', background: 'var(--red-bg)', border: '1px solid var(--red)',
                borderRadius: 'var(--radius)', color: 'var(--red)', fontSize: 13, marginBottom: 16,
              }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, paddingBottom: 24 }}>
              <Link href="/cases"><Btn variant="secondary">Cancel</Btn></Link>
              <Btn variant="primary" type="submit" disabled={busy}>
                {busy ? 'Creating…' : '+ Create case folder'}
              </Btn>
            </div>
          </div>
        </form>

        {/* ─── Right panel: history + instructions ─── */}
        <div style={{ position: 'sticky', top: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Workflow instructions */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
              What happens next
            </div>
            {[
              { icon: '1', text: 'CS creates this folder with customer details + complaint' },
              { icon: '2', text: 'Inbound team scans the scooter when it arrives & adds diagnosis' },
              { icon: '3', text: 'CS confirms payment — unlocks mechanic queue' },
              { icon: '4', text: 'Mechanic fixes it, Outbound QC checks & ships' },
            ].map(step => (
              <div key={step.icon} style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'flex-start' }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', background: 'var(--accent-dim)',
                  color: 'var(--accent)', fontSize: 11, fontWeight: 700, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {step.icon}
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{step.text}</span>
              </div>
            ))}
          </div>

          {/* Scooter history */}
          <div className="card" style={{ padding: '18px 20px' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
              Scooter history
            </div>
            {history.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>
                {form.serialNumber.length >= 4
                  ? 'No previous cases — new scooter'
                  : 'Enter serial number to check history'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {history.map(r => (
                  <Link key={r.id} href={`/cases/${r.id}`} style={{ textDecoration: 'none' }}>
                    <div style={{
                      padding: '10px 12px', background: 'var(--bg-raised)',
                      borderRadius: 'var(--radius)', border: '1px solid var(--border-muted)', cursor: 'pointer',
                    }}>
                      <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{r.orderNumber}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{r.faultDescription.slice(0, 50)}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 4 }}>
                        {new Date(r.createdAt).toLocaleDateString('en-GB')}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label>{label}</label>
      {children}
    </div>
  )
}
function Divider() {
  return <div style={{ borderTop: '1px solid var(--border-muted)', margin: '4px 0 20px' }} />
}
function Req() {
  return <span style={{ color: 'var(--red)', marginLeft: 3 }}>*</span>
}
