'use client'
import { useState, useEffect, createContext, useContext } from 'react'

type LayoutCtx = {
  collapsed:    boolean
  setCollapsed: (v: boolean) => void
  theme:        string
  setTheme:     (v: string) => void
}
export const LayoutContext = createContext<LayoutCtx>({
  collapsed: false, setCollapsed: () => {},
  theme: 'light',   setTheme: () => {},
})
export const useLayout = () => useContext(LayoutContext)

type Props = {
  children:  React.ReactNode
  role:      string
  name:      string
}

export default function LayoutClient({ children, role, name }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [theme, setTheme]         = useState('light')
  const [mounted, setMounted]     = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('sh_theme') ?? 'light'
    const col   = localStorage.getItem('sh_collapsed') === 'true'
    setTheme(saved)
    setCollapsed(col)
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('sh_theme', theme)
  }, [theme, mounted])

  useEffect(() => {
    if (!mounted) return
    localStorage.setItem('sh_collapsed', String(collapsed))
  }, [collapsed, mounted])

  // Prevent flash: apply theme immediately from localStorage via inline script
  // (handled in root layout via suppressHydrationWarning)

  return (
    <LayoutContext.Provider value={{ collapsed, setCollapsed, theme, setTheme }}>
      {children}
    </LayoutContext.Provider>
  )
}
