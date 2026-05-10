'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

/**
 * Btn — primary button component.
 *
 * v2 changes (April 2026):
 *   • Added `loading` prop with built-in SVG spinner — no more manual
 *     "busy" state + disabled wrangling in every action handler
 *   • Added `iconLeft` / `iconRight` props for icons without manually
 *     composing them in children every time
 *   • Default `type="button"` to prevent accidental form submissions
 *     (React's default is "submit" which causes bugs in nested forms)
 *   • Exported BtnVariant / BtnSize types for use by other components
 *   • Spinner uses native SVG animateTransform — no CSS keyframes needed,
 *     works on any browser without touching globals.css
 *
 * Usage:
 *   <Btn variant="primary" loading={busy} onClick={save}>Save</Btn>
 *   <Btn variant="success" iconLeft={<CheckIcon />}>Approve</Btn>
 *   <Btn variant="ghost" size="sm">Cancel</Btn>
 */

export type BtnVariant =
  | 'primary'   // accent blue — main action
  | 'secondary' // white/dark surface — secondary action
  | 'ghost'     // transparent — tertiary action
  | 'danger'    // red — destructive action
  | 'success'   // green — confirm/approve
  | 'warning'   // amber — caution action

export type BtnSize =
  | 'sm'  // 30px tall, 12px font — table actions
  | 'md'  // 36px tall, 13px font — default
  | 'lg'  // 44px tall, 14px font — primary page action
  | 'xl'  // 52px tall, full width — mobile/mechanic primary

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant
  size?: BtnSize
  /** Show spinner and disable the button. Useful while awaiting async actions. */
  loading?: boolean
  /** Icon rendered before the label. Replaced by spinner when loading. */
  iconLeft?: ReactNode
  /** Icon rendered after the label. Hidden when loading. */
  iconRight?: ReactNode
}

const VARIANT_CLASS: Record<BtnVariant, string> = {
  primary:   'btn btn-p',
  secondary: 'btn btn-s',
  ghost:     'btn btn-gh',
  danger:    'btn btn-dn',
  success:   'btn btn-ok',
  warning:   'btn btn-wn',
}

const SIZE_CLASS: Record<BtnSize, string> = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
  xl: 'btn-xl',
}

/**
 * Inline SVG spinner using native SVG animateTransform.
 * No CSS keyframes required — works in any browser, no globals.css touch.
 * Inherits color from the button's text color via currentColor.
 */
function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      style={{ flexShrink: 0 }}
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2"
        opacity="0.25"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  )
}

export default function Btn({
  variant = 'secondary',
  size = 'md',
  loading = false,
  iconLeft,
  iconRight,
  children,
  className,
  disabled,
  type = 'button',
  ...props
}: Props) {
  const cls = [
    VARIANT_CLASS[variant] ?? 'btn btn-s',
    SIZE_CLASS[size] ?? '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type={type}
      className={cls}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Spinner /> : iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  )
}
