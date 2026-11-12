import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'PayPal Commerce Wind Tunnel',
  description: 'Test the economy before the economy runs itself.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
