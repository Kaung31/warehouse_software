import type { Metadata } from 'next'
import Script from 'next/script'
import { ClerkProvider } from '@clerk/nextjs'
import PostHogProvider from '@/components/PosthogProvider'
import './globals.css'

export const metadata: Metadata = {
  title: 'ScooterHub',
  description: 'Scooter repair & stock management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body>
          <Script
            id="sh-theme-init"
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var t=localStorage.getItem('sh_theme')||'light';document.documentElement.setAttribute('data-theme',t);}catch(e){}})()`,
            }}
          />
          <PostHogProvider>
            {children}
          </PostHogProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}