'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase'

interface Poll {
  id: string
  title: string
  description: string | null
  duration_minutes: number
  status: string
  created_by: string
  selected_slot_id: string | null
  zoom_join_url: string | null
}

interface TimeSlot {
  id: string
  start_time: string
  end_time: string
  available_count: number
  total_responses: number
}

interface Participant {
  id: string
  name: string
  email: string
  has_responded: boolean
}

interface Response {
  slot_id: string
  is_available: boolean
}

// Parse datetime string WITHOUT timezone conversion
function parseLocalTime(iso: string) {
  // Handle "2026-02-23T09:00:00" as literal ET time
  const match = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/)
  if (!match) return { year: 2026, month: 1, day: 1, hour: 9, minute: 0 }
  return {
    year: parseInt(match[1]),
    month: parseInt(match[2]),
    day: parseInt(match[3]),
    hour: parseInt(match[4]),
    minute: parseInt(match[5]),
  }
}

function formatDate(iso: string) {
  const t = parseLocalTime(iso)
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  // Use UTC constructor to avoid timezone shift
  const d = new Date(Date.UTC(t.year, t.month - 1, t.day))
  return days[d.getUTCDay()] + ', ' + months[t.month - 1] + ' ' + t.day
}

function formatTime(iso: string) {
  const t = parseLocalTime(iso)
  const h = t.hour % 12 || 12
  const ampm = t.hour < 12 ? 'AM' : 'PM'
  const min = t.minute.toString().padStart(2, '0')
  return h + ':' + min + ' ' + ampm
}

function dateKey(iso: string) {
  const t = parseLocalTime(iso)
  return t.year + '-' + t.month + '-' + t.day
}

export default function VotePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const pollId = params.id as string
  const token = searchParams.get('token')

  const [poll, setPoll] = useState<Poll | null>(null)
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [responses, setResponses] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = createBrowserSupabase()

  useEffect(() => {
    async function load() {
      if (!pollId || !token) {
        setError('Invalid voting link. Please check the URL from your email.')
        setLoading(false)
        return
      }

      try {
        const { data: pData, error: pErr } = await supabase
          .from('poll_participants')
          .select('*')
          .eq('token', token)
          .single()

        if (pErr || !pData) {
          setError('Invalid or expired voting link.')
          setLoading(false)
          return
        }

        setParticipant(pData)

        if (pData.has_responded) {
          setSubmitted(true)
        }

        const { data: pollData, error: pollErr } = await supabase
          .from('scheduling_polls')
          .select('*')
          .eq('id', pollId)
          .single()

        if (pollErr || !pollData) {
          setError('Poll not found.')
          setLoading(false)
          return
        }

        setPoll(pollData)

        const { data: slotData } = await supabase
          .from('poll_time_slots')
          .select('*')
          .eq('poll_id', pollId)
          .order('start_time', { ascending: true })

        setSlots(slotData || [])

        const { data: respData } = await supabase
          .from('scheduling_responses')
          .select('slot_id, is_available')
          .eq('participant_id', pData.id)

        if (respData && respData.length > 0) {
          const respMap: Record<string, boolean> = {}
          respData.forEach((r: Response) => {
            respMap[r.slot_id] = r.is_available
          })
          setResponses(respMap)
        }
      } catch (err) {
        setError('Something went wrong loading the poll.')
      }

      setLoading(false)
    }
    load()
  }, [pollId, token])

  const toggleSlot = useCallback((slotId: string) => {
    if (submitted || poll?.status === 'completed') return
    setResponses(prev => ({
      ...prev,
      [slotId]: !prev[slotId]
    }))
  }, [submitted, poll?.status])

  const handleSubmit = async () => {
    if (!participant || !poll) return
    setSubmitting(true)

    try {
      const upserts = slots.map(slot => ({
        poll_id: poll.id,
        participant_id: participant.id,
        slot_id: slot.id,
        is_available: responses[slot.id] || false,
      }))

      for (const upsert of upserts) {
        const { data: existing } = await supabase
          .from('scheduling_responses')
          .select('id')
          .eq('participant_id', upsert.participant_id)
          .eq('slot_id', upsert.slot_id)
          .single()

        if (existing) {
          await supabase
            .from('scheduling_responses')
            .update({ is_available: upsert.is_available })
            .eq('id', existing.id)
        } else {
          await supabase
            .from('scheduling_responses')
            .insert(upsert)
        }
      }

      setSubmitted(true)
    } catch (err) {
      setError('Failed to submit your responses. Please try again.')
    }

    setSubmitting(false)
  }

  // Group slots by date
  const groupedSlots = slots.reduce((acc, slot) => {
    const dk = dateKey(slot.start_time)
    if (!acc[dk]) acc[dk] = []
    acc[dk].push(slot)
    return acc
  }, {} as Record<string, TimeSlot[]>)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-np-blue/20 border-t-np-blue rounded-full animate-spin mx-auto" />
          <p className="text-np-gray mt-4">Loading poll...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-14 h-14 bg-np-terra/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E76F51" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-np-dark mb-2">Oops</h2>
          <p className="text-np-gray">{error}</p>
        </div>
      </div>
    )
  }

  if (poll?.status === 'completed') {
    const selectedSlot = slots.find(s => s.id === poll.selected_slot_id)
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-14 h-14 bg-np-sage/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#52B788" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-np-dark mb-2" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
            Meeting Scheduled!
          </h2>
          <p className="text-np-gray mb-6">{poll.title}</p>

          {selectedSlot && (
            <div className="bg-np-blue/5 rounded-xl p-4 mb-6">
              <p className="text-lg font-semibold text-np-blue">
                {formatDate(selectedSlot.start_time)}
              </p>
              <p className="text-np-dark font-medium">
                {formatTime(selectedSlot.start_time)} - {formatTime(selectedSlot.end_time)} ET
              </p>
            </div>
          )}

          {poll.zoom_join_url && (
            
              href={poll.zoom_join_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-[#2D8CFF] text-white px-6 py-3 rounded-xl font-medium
                         hover:bg-[#1a7ae8] transition-all"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-3l4 3V6l-4 3V5a2 2 0 00-2-2H4z" />
              </svg>
              Join Zoom Meeting
            </a>
          )}

          <p className="text-sm text-np-gray/60 mt-6">
            A calendar invite has been sent to all participants.
          </p>
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-14 h-14 bg-np-teal/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2A9D8F" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-np-dark mb-2" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
            Response Recorded!
          </h2>
          <p className="text-np-gray mb-2">Thanks, {participant?.name}.</p>
          <p className="text-sm text-np-gray/70">
            You'll receive an email once everyone has responded and the meeting is confirmed.
          </p>
        </div>
      </div>
    )
  }

  const availableCount = Object.values(responses).filter(Boolean).length

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-np-blue/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#476B8E" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-np-dark" style={{ fontFamily: 'Cormorant Garamond, serif' }}>
                {poll?.title}
              </h1>
              {poll?.description && (
                <p className="text-np-gray mt-1">{poll.description}</p>
              )}
              <p className="text-sm text-np-gray/70 mt-2">
                {poll?.duration_minutes} min meeting
              </p>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm text-np-gray">
              Hi <span className="font-medium text-np-dark">{participant?.name}</span>,
              tap the times you're available. Green = available.
            </p>
            <p className="text-xs text-np-gray/60 mt-1">All times shown in Eastern Time (ET)</p>
          </div>
        </div>

        {Object.entries(groupedSlots).map(([dk, dateSlots]) => (
          <div key={dk} className="mb-6">
            <h3 className="text-sm font-semibold text-np-gray uppercase tracking-wider mb-3 px-1">
              {formatDate(dateSlots[0].start_time)}
            </h3>
            <div className="space-y-2">
              {dateSlots.map(slot => {
                const isAvail = responses[slot.id] || false
                return (
                  <button
                    key={slot.id}
                    onClick={() => toggleSlot(slot.id)}
                    className={`
                      w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all
                      ${isAvail
                        ? 'bg-np-sage/10 border-np-sage text-np-dark shadow-sm'
                        : 'bg-white border-gray-200 text-np-gray hover:border-gray-300'
                      }
                    `}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`
                        w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
                        ${isAvail
                          ? 'bg-np-sage border-np-sage'
                          : 'border-gray-300'
                        }
                      `}>
                        {isAvail && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>

                      <div className="text-left">
                        <p className={`font-medium ${isAvail ? 'text-np-dark' : 'text-np-gray'}`}>
                          {formatTime(slot.start_time)} - {formatTime(slot.end_time)}
                        </p>
                      </div>
                    </div>

                    <span className={`text-sm font-medium px-3 py-1 rounded-full ${
                      isAvail
                        ? 'bg-np-sage/20 text-np-sage'
                        : 'bg-gray-100 text-gray-400'
                    }`}>
                      {isAvail ? 'Available' : 'Unavailable'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <div className="bg-white rounded-2xl shadow-lg p-6 sticky bottom-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-np-gray">
              <span className="font-semibold text-np-sage">{availableCount}</span> of{' '}
              <span className="font-medium">{slots.length}</span> slots marked available
            </p>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-np-blue text-white px-8 py-3 rounded-xl font-medium
                         hover:bg-np-blue-dark transition-all shadow-lg hover:shadow-xl
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting...
                </span>
              ) : 'Submit Availability'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
