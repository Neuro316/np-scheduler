'use client'

import { useState } from 'react'

export default function Home() {
  const [showCreate, setShowCreate] = useState(false)

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-lg w-full text-center">
        {/* Logo area */}
        <div className="mb-8">
          <div className="w-16 h-16 bg-np-blue rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-np-dark" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
            NP Scheduler
          </h1>
          <p className="text-np-gray mt-2">
            Find the perfect meeting time for everyone
          </p>
        </div>

        <a
          href="/create"
          className="inline-flex items-center gap-2 bg-np-blue text-white px-8 py-3 rounded-xl font-medium
                     hover:bg-np-blue-dark transition-all shadow-lg hover:shadow-xl"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Create a Scheduling Poll
        </a>

        <p className="text-sm text-np-gray/60 mt-8">
          Powered by Neuro Progeny
        </p>
      </div>
    </div>
  )
}
