import './globals.css'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Neuro Progeny Scheduler',
  description: 'Find the best meeting time for everyone',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-np-light">
        {children}
      </body>
    </html>
  )
}
