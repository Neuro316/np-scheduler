'use client'

import { useState, useEffect } from 'react'

interface Poll {
  id: string
  title: string
  description: string | null
  duration_minutes: number
  status: string
  location: string
  created_by: string
  selected_slot_id: string | null
  zoom_join_url: string | null
  created_at: string
  poll_time_slots: {
    id: string
    start_time: string
    end_time: string
    available_count: number
    total_responses: number
    score: number
  }[]
  poll_participants: {
    id: string
    name: string
    email: string
    has_responded: boolean
    responded_at: string | null
  }[]
}

export default function AdminPage() {
  const [polls, setPolls] = useState<Poll[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedPoll, setExpandedPoll] = useState<string | null>(null)

  useEffect(() => {
    fetchPolls()
  }, [])

  async function fetchPolls() {
    const res = await fetch('/api/polls')
    const data = await res.json()
    setPolls(data.polls || [])
    setLoading(false)
  }

  const formatDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    active: 'bg-blue-50 text-blue-700',
    completed: 'bg-green-50 text-green-700',
    cancelled: 'bg-red-50 text-red-600',
    expired: 'bg-orange-50 text-orange-600',
  }

  async function triggerComplete(pollId: string) {
    const res = await fetch('/api/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poll_id: pollId }),
    })
    const data = await res.json()
    if (data.success) {
      fetchPolls()
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-np-blue/20 border-t-np-blue rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-np-dark" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
              Scheduling Polls
            </h1>
            <p className="text-np-gray mt-1">{polls.length} poll{polls.length !== 1 ? 's' : ''}</p>
          </div>
          <a
            href="/create"
            className="bg-np-blue text-white px-6 py-2.5 rounded-xl font-medium
                       hover:bg-np-blue-dark transition-all shadow-sm"
          >
            + New Poll
          </a>
        </div>

        {/* Polls */}
        {polls.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <p className="text-np-gray text-lg">No polls yet.</p>
            <a href="/create" className="text-np-blue font-medium mt-2 inline-block">
              Create your first scheduling poll
            </a>
          </div>
        ) : (
          <div className="space-y-4">
            {polls.map(poll => {
              const expanded = expandedPoll === poll.id
              const responded = poll.poll_participants?.filter(p => p.has_responded).length || 0
              const total = poll.poll_participants?.length || 0
              const bestSlot = poll.poll_time_slots?.reduce((best, s) =>
                s.available_count > (best?.available_count || 0) ? s : best, poll.poll_time_slots[0])

              return (
                <div key={poll.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  {/* Summary row */}
                  <button
                    onClick={() => setExpandedPoll(expanded ? null : poll.id)}
                    className="w-full p-6 text-left flex items-center justify-between hover:bg-gray-50/50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-np-dark">{poll.title}</h3>
                        <p className="text-sm text-np-gray mt-0.5">
                          {poll.duration_minutes}min &bull; {formatDate(poll.created_at)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Response progress */}
                      <div className="text-right">
                        <p className="text-sm font-medium text-np-dark">{responded}/{total} responded</p>
                        <div className="w-24 h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden">
                          <div
                            className="h-full bg-np-teal rounded-full transition-all"
                            style={{ width: `${total ? (responded / total) * 100 : 0}%` }}
                          />
                        </div>
                      </div>

                      <span className={`text-xs font-medium px-3 py-1 rounded-full ${statusColors[poll.status]}`}>
                        {poll.status}
                      </span>

                      <svg
                        width="20" height="20" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" strokeWidth="2"
                        className={`text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded details */}
                  {expanded && (
                    <div className="border-t border-gray-100 p-6">
                      {/* Participants */}
                      <div className="mb-6">
                        <h4 className="text-sm font-semibold text-np-gray uppercase tracking-wider mb-3">Participants</h4>
                        <div className="space-y-2">
                          {poll.poll_participants?.map(p => (
                            <div key={p.id} className="flex items-center justify-between py-2">
                              <div className="flex items-center gap-3">
                                <div className={`w-2.5 h-2.5 rounded-full ${p.has_responded ? 'bg-np-sage' : 'bg-gray-300'}`} />
                                <span className="text-sm text-np-dark font-medium">{p.name}</span>
                                <span className="text-sm text-np-gray">{p.email}</span>
                              </div>
                              <span className="text-xs text-np-gray">
                                {p.has_responded
                                  ? `Responded ${formatDate(p.responded_at!)}`
                                  : 'Waiting...'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Time Slots with scores */}
                      <div className="mb-6">
                        <h4 className="text-sm font-semibold text-np-gray uppercase tracking-wider mb-3">Time Slots</h4>
                        <div className="space-y-2">
                          {poll.poll_time_slots?.sort((a, b) =>
                            new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
                          ).map(slot => {
                            const isSelected = slot.id === poll.selected_slot_id
                            const isBest = slot.id === bestSlot?.id && poll.status === 'active'
                            return (
                              <div
                                key={slot.id}
                                className={`flex items-center justify-between py-2 px-3 rounded-lg ${
                                  isSelected ? 'bg-np-sage/10 border border-np-sage/30' :
                                  isBest ? 'bg-np-blue/5' : ''
                                }`}
                              >
                                <div>
                                  <span className="text-sm font-medium text-np-dark">
                                    {formatDate(slot.start_time)}
                                  </span>
                                  <span className="text-sm text-np-gray ml-2">
                                    {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                                  </span>
                                  {isSelected && (
                                    <span className="ml-2 text-xs font-medium text-np-sage">SELECTED</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-np-dark">
                                    {slot.available_count}/{slot.total_responses}
                                  </span>
                                  <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${
                                        slot.score >= 80 ? 'bg-np-sage' :
                                        slot.score >= 50 ? 'bg-np-gold' : 'bg-np-coral'
                                      }`}
                                      style={{ width: `${slot.score}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Actions */}
                      {poll.status === 'completed' && !poll.zoom_join_url && (
                        <button
                          onClick={() => triggerComplete(poll.id)}
                          className="bg-np-teal text-white px-6 py-2 rounded-xl text-sm font-medium
                                     hover:bg-np-teal/90 transition-all"
                        >
                          Create Calendar Event + Zoom Link
                        </button>
                      )}

                      {poll.zoom_join_url && (
                        <a
                          href={poll.zoom_join_url}
                          target="_blank"
                          className="inline-flex items-center gap-2 bg-[#2D8CFF] text-white px-6 py-2 rounded-xl text-sm font-medium"
                        >
                          Zoom Link
                        </a>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
