'use client'

import { useState, useEffect } from 'react'

interface TimeSlotInput {
  date: string
  startTime: string
  endTime: string
}

interface ParticipantInput {
  name: string
  email: string
}

export default function CreatePollPage() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState(30)
  const [location, setLocation] = useState('zoom')

  const [slots, setSlots] = useState<TimeSlotInput[]>([])
  const [loadingSlots, setLoadingSlots] = useState(true)
  const [calendarSource, setCalendarSource] = useState('')

  const [participants, setParticipants] = useState<ParticipantInput[]>([
    { name: '', email: '' }
  ])

  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(false)
  const [pollUrl, setPollUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { fetchAvailableSlots(duration) }, [])

  async function fetchAvailableSlots(dur: number) {
    setLoadingSlots(true)
    try {
      const res = await fetch('/api/availability?duration=' + dur + '&count=3')
      const data = await res.json()
      if (data.slots && data.slots.length > 0) {
        const formatted = data.slots.map((s: { start_time: string; end_time: string }) => {
          const start = new Date(s.start_time)
          const end = new Date(s.end_time)
          return {
            date: start.toISOString().split('T')[0],
            startTime: start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
            endTime: end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
          }
        })
        setSlots(formatted)
        setCalendarSource(data.source === 'google_calendar' ? 'From your Google Calendar' : 'Suggested times (connect Google Calendar for real availability)')
      } else {
        setSlots([{ date: '', startTime: '09:00', endTime: '09:30' }])
      }
    } catch {
      setSlots([{ date: '', startTime: '09:00', endTime: '09:30' }])
    }
    setLoadingSlots(false)
  }

  const addSlot = () => {
    const lastSlot = slots[slots.length - 1]
    setSlots([...slots, { date: lastSlot?.date || '', startTime: '09:00', endTime: '09:30' }])
  }
  const removeSlot = (i: number) => setSlots(slots.filter((_, idx) => idx !== i))
  const updateSlot = (i: number, field: keyof TimeSlotInput, val: string) => {
    const updated = [...slots]
    updated[i] = { ...updated[i], [field]: val }
    if (field === 'startTime') {
      const [h, m] = val.split(':').map(Number)
      const endMin = h * 60 + m + duration
      const eH = Math.floor(endMin / 60).toString().padStart(2, '0')
      const eM = (endMin % 60).toString().padStart(2, '0')
      updated[i].endTime = eH + ':' + eM
    }
    setSlots(updated)
  }

  const addParticipant = () => setParticipants([...participants, { name: '', email: '' }])
  const removeParticipant = (i: number) => setParticipants(participants.filter((_, idx) => idx !== i))
  const updateParticipant = (i: number, field: keyof ParticipantInput, val: string) => {
    const updated = [...participants]
    updated[i] = { ...updated[i], [field]: val }
    setParticipants(updated)
  }

  const handleCreate = async () => {
    if (!title.trim()) { setError('Please add a title.'); return }
    const validSlots = slots.filter(s => s.date && s.startTime && s.endTime)
    if (validSlots.length === 0) { setError('Add at least one time slot.'); return }
    const validParticipants = participants.filter(p => p.name.trim() && p.email.trim())
    if (validParticipants.length === 0) { setError('Add at least one participant.'); return }

    setCreating(true)
    setError('')
    try {
      const res = await fetch('/api/polls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          duration_minutes: duration,
          location,
          time_slots: validSlots.map(s => ({
            start_time: s.date + 'T' + s.startTime + ':00',
            end_time: s.date + 'T' + s.endTime + ':00',
          })),
          participants: validParticipants,
          send_emails: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed to create poll'); setCreating(false); return }
      setCreated(true)
      setPollUrl(data.admin_url || '')
    } catch { setError('Network error. Please try again.') }
    setCreating(false)
  }

  if (created) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-14 h-14 bg-np-sage/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#52B788" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          </div>
          <h2 className="text-2xl font-bold text-np-dark mb-2" style={{ fontFamily: 'Cormorant Garamond, serif' }}>Poll Created!</h2>
          <p className="text-np-gray mb-6">Voting links have been emailed to all participants. You will be notified once everyone responds.</p>
          <div className="flex gap-3 justify-center">
            <a href="/create" onClick={() => window.location.reload()} className="px-6 py-2 border border-np-blue text-np-blue rounded-xl font-medium hover:bg-np-blue/5 transition-all">Create Another</a>
            <a href="/admin" className="px-6 py-2 bg-np-blue text-white rounded-xl font-medium hover:bg-np-blue-dark transition-all">View All Polls</a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <a href="/" className="text-sm text-np-gray hover:text-np-blue transition-colors">← Back</a>
          <h1 className="text-3xl font-bold text-np-dark mt-2" style={{ fontFamily: 'Cormorant Garamond, serif' }}>Create Scheduling Poll</h1>
          <p className="text-np-gray mt-1">Add time options and participants. Everyone gets a unique voting link.</p>
        </div>

        {error && (
          <div className="bg-np-terra/10 border border-np-terra/30 text-np-terra px-4 py-3 rounded-xl mb-6 text-sm">{error}</div>
        )}

        {/* Meeting Details */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="text-lg font-semibold text-np-dark mb-4">Meeting Details</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-np-dark mb-1">Title *</label>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Team Strategy Session" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30 focus:border-np-blue" />
            </div>
            <div>
              <label className="block text-sm font-medium text-np-dark mb-1">Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief context for participants..." rows={2} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30 focus:border-np-blue resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-np-dark mb-1">Duration</label>
                <select value={duration} onChange={e => { const d = Number(e.target.value); setDuration(d); fetchAvailableSlots(d); }} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30 focus:border-np-blue">
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={45}>45 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hours</option>
                  <option value={120}>2 hours</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-np-dark mb-1">Location</label>
                <select value={location} onChange={e => setLocation(e.target.value)} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30 focus:border-np-blue">
                  <option value="zoom">Zoom (auto-generate link)</option>
                  <option value="in_person">In Person</option>
                  <option value="phone">Phone Call</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Time Slots */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-np-dark">Time Options</h2>
              {calendarSource && <p className="text-xs text-np-teal mt-0.5">{calendarSource}</p>}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => fetchAvailableSlots(duration)} disabled={loadingSlots} className="text-sm text-np-teal hover:text-np-teal/80 font-medium flex items-center gap-1">
                {loadingSlots ? (<><div className="w-3 h-3 border-2 border-np-teal/30 border-t-np-teal rounded-full animate-spin" /> Checking...</>) : (<>Refresh</>)}
              </button>
              <button onClick={addSlot} className="text-sm text-np-blue hover:text-np-blue-dark font-medium flex items-center gap-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Add Slot
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {loadingSlots ? (
              [1,2,3].map(i => (
                <div key={i} className="flex items-center gap-3 animate-pulse">
                  <div className="flex-1 h-10 bg-gray-100 rounded-lg" />
                  <div className="w-28 h-10 bg-gray-100 rounded-lg" />
                  <span className="text-np-gray text-sm">to</span>
                  <div className="w-28 h-10 bg-gray-100 rounded-lg" />
                </div>
              ))
            ) : (
              slots.map((slot, i) => (
                <div key={i} className="flex items-center gap-3">
                  <input type="date" value={slot.date} onChange={e => updateSlot(i, 'date', e.target.value)} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
                  <input type="time" value={slot.startTime} onChange={e => updateSlot(i, 'startTime', e.target.value)} className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
                  <span className="text-np-gray text-sm">to</span>
                  <input type="time" value={slot.endTime} onChange={e => updateSlot(i, 'endTime', e.target.value)} className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
                  {slots.length > 1 && (
                    <button onClick={() => removeSlot(i)} className="text-gray-400 hover:text-np-terra transition-colors p-1">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Participants */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-np-dark">Participants</h2>
            <button onClick={addParticipant} className="text-sm text-np-blue hover:text-np-blue-dark font-medium flex items-center gap-1">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Add Person
            </button>
          </div>
          <div className="space-y-3">
            {participants.map((p, i) => (
              <div key={i} className="flex items-center gap-3">
                <input type="text" value={p.name} onChange={e => updateParticipant(i, 'name', e.target.value)} placeholder="Name" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
                <input type="email" value={p.email} onChange={e => updateParticipant(i, 'email', e.target.value)} placeholder="email@example.com" className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
                {participants.length > 1 && (
                  <button onClick={() => removeParticipant(i)} className="text-gray-400 hover:text-np-terra transition-colors p-1">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        <button onClick={handleCreate} disabled={creating} className="w-full bg-np-blue text-white py-4 rounded-xl font-medium text-lg hover:bg-np-blue-dark transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed">
          {creating ? (
            <span className="flex items-center justify-center gap-2">
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Creating Poll & Sending Invites...
            </span>
          ) : 'Create Poll & Send Invites'}
        </button>
      </div>
    </div>
  )
}
