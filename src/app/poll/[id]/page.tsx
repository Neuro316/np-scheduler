'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { createBrowserSupabase } from '@/lib/supabase'

interface Poll { id: string; title: string; description: string | null; duration_minutes: number; status: string; selected_slot_id: string | null; zoom_join_url: string | null }
interface TimeSlot { id: string; start_time: string; end_time: string }
interface Participant { id: string; name: string; email: string; has_responded: boolean }

function formatDate(iso: string) { return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/New_York' }) }
function formatTime(iso: string) { return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) }
function dateKey(iso: string) { return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) }

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
      if (!pollId || !token) { setError('Invalid voting link.'); setLoading(false); return }
      try {
        const { data: pData } = await supabase.from('poll_participants').select('*').eq('token', token).single()
        if (!pData) { setError('Invalid or expired voting link.'); setLoading(false); return }
        setParticipant(pData)
        if (pData.has_responded) setSubmitted(true)
        const { data: pollData } = await supabase.from('scheduling_polls').select('*').eq('id', pollId).single()
        if (!pollData) { setError('Poll not found.'); setLoading(false); return }
        setPoll(pollData)
        const { data: slotData } = await supabase.from('poll_time_slots').select('*').eq('poll_id', pollId).order('start_time', { ascending: true })
        setSlots(slotData || [])
        const { data: respData } = await supabase.from('scheduling_responses').select('slot_id, is_available').eq('participant_id', pData.id)
        if (respData && respData.length > 0) {
          const m: Record<string, boolean> = {}
          respData.forEach((r: { slot_id: string; is_available: boolean }) => { m[r.slot_id] = r.is_available })
          setResponses(m)
        }
      } catch { setError('Something went wrong.') }
      setLoading(false)
    }
    load()
  }, [pollId, token])

  const toggleSlot = useCallback((slotId: string) => {
    if (submitted || poll?.status === 'completed') return
    setResponses(prev => ({ ...prev, [slotId]: !prev[slotId] }))
  }, [submitted, poll?.status])

  const handleSubmit = async () => {
    if (!participant || !poll || !token) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, poll_id: poll.id, responses }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to submit.') } else { setSubmitted(true) }
    } catch { setError('Network error. Please try again.') }
    setSubmitting(false)
  }

  const groupedSlots = slots.reduce((acc, slot) => { const dk = dateKey(slot.start_time); if (!acc[dk]) acc[dk] = []; acc[dk].push(slot); return acc }, {} as Record<string, TimeSlot[]>)

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-12 h-12 border-4 border-np-blue/20 border-t-np-blue rounded-full animate-spin mx-auto" /></div>
  if (error) return <div className="min-h-screen flex items-center justify-center p-4"><div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center"><h2 className="text-xl font-semibold text-np-dark mb-2">Oops</h2><p className="text-np-gray">{error}</p></div></div>

  if (poll?.status === 'completed') {
    const selectedSlot = slots.find(s => s.id === poll.selected_slot_id)
    return (<div className="min-h-screen flex items-center justify-center p-4"><div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
      <div className="w-14 h-14 bg-np-sage/20 rounded-full flex items-center justify-center mx-auto mb-4"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#52B788" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg></div>
      <h2 className="text-2xl font-bold text-np-dark mb-2" style={{ fontFamily: 'Cormorant Garamond, serif' }}>Meeting Scheduled!</h2>
      <p className="text-np-gray mb-6">{poll.title}</p>
      {selectedSlot && <div className="bg-np-blue/5 rounded-xl p-4 mb-6"><p className="text-lg font-semibold text-np-blue">{formatDate(selectedSlot.start_time)}</p><p className="text-np-dark font-medium">{formatTime(selectedSlot.start_time)} - {formatTime(selectedSlot.end_time)} ET</p></div>}
      {poll.zoom_join_url && <a href={poll.zoom_join_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 bg-[#2D8CFF] text-white px-6 py-3 rounded-xl font-medium">Join Zoom Meeting</a>}
    </div></div>)
  }

  if (submitted) return (<div className="min-h-screen flex items-center justify-center p-4"><div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
    <div className="w-14 h-14 bg-np-teal/10 rounded-full flex items-center justify-center mx-auto mb-4"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2A9D8F" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg></div>
    <h2 className="text-2xl font-bold text-np-dark mb-2" style={{ fontFamily: 'Cormorant Garamond, serif' }}>Response Recorded!</h2>
    <p className="text-np-gray mb-2">Thanks, {participant?.name}.</p>
    <p className="text-sm text-np-gray/70">You will receive an email once the meeting is confirmed.</p>
  </div></div>)

  const availableCount = Object.values(responses).filter(Boolean).length
  return (
    <div className="min-h-screen py-8 px-4"><div className="max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-np-blue/10 rounded-xl flex items-center justify-center flex-shrink-0"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#476B8E" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></div>
          <div>
            <h1 className="text-2xl font-bold text-np-dark" style={{ fontFamily: 'Cormorant Garamond, serif' }}>{poll?.title}</h1>
            {poll?.description && <p className="text-np-gray mt-1">{poll.description}</p>}
            <p className="text-sm text-np-gray/70 mt-2">{poll?.duration_minutes} min meeting</p>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-sm text-np-gray">Hi <span className="font-medium text-np-dark">{participant?.name}</span>, tap the times you are available. Green = available.</p>
          <p className="text-xs text-np-gray/60 mt-1">All times shown in Eastern Time (ET)</p>
        </div>
      </div>
      {Object.entries(groupedSlots).map(([dk, dateSlots]) => (
        <div key={dk} className="mb-6">
          <h3 className="text-sm font-semibold text-np-gray uppercase tracking-wider mb-3 px-1">{formatDate(dateSlots[0].start_time)}</h3>
          <div className="space-y-2">
            {dateSlots.map(slot => {
              const isAvail = responses[slot.id] || false
              return (<button key={slot.id} onClick={() => toggleSlot(slot.id)} className={`w-full flex items-center justify-between p-4 rounded-xl border-2 transition-all ${isAvail ? 'bg-np-sage/10 border-np-sage text-np-dark shadow-sm' : 'bg-white border-gray-200 text-np-gray hover:border-gray-300'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${isAvail ? 'bg-np-sage border-np-sage' : 'border-gray-300'}`}>{isAvail && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}</div>
                  <p className={`font-medium ${isAvail ? 'text-np-dark' : 'text-np-gray'}`}>{formatTime(slot.start_time)} - {formatTime(slot.end_time)}</p>
                </div>
                <span className={`text-sm font-medium px-3 py-1 rounded-full ${isAvail ? 'bg-np-sage/20 text-np-sage' : 'bg-gray-100 text-gray-400'}`}>{isAvail ? 'Available' : 'Unavailable'}</span>
              </button>)
            })}
          </div>
        </div>
      ))}
      <div className="bg-white rounded-2xl shadow-lg p-6 sticky bottom-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-np-gray"><span className="font-semibold text-np-sage">{availableCount}</span> of <span className="font-medium">{slots.length}</span> slots marked available</p>
          <button onClick={handleSubmit} disabled={submitting} className="bg-np-blue text-white px-8 py-3 rounded-xl font-medium hover:bg-np-blue-dark transition-all shadow-lg disabled:opacity-50">
            {submitting ? <span className="flex items-center gap-2"><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Submitting...</span> : 'Submit Availability'}
          </button>
        </div>
      </div>
    </div></div>
  )
}
