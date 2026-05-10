import QRCode from 'qrcode'

type Props = {
  value: string
  size?: number
  label?: string
}

export default async function QRCodeDisplay({ value, size = 160, label }: Props) {
  const svg = await QRCode.toString(value, {
    type:          'svg',
    width:         size,
    margin:        2,
    errorCorrectionLevel: 'M',
    color: { dark: '#1f2328', light: '#ffffff' },
  })

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div
        dangerouslySetInnerHTML={{ __html: svg }}
        style={{ lineHeight: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}
      />
      {label && (
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
          {label}
        </div>
      )}
    </div>
  )
}
