import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { token, poll_id, responses } = await req.json()
    if (!token || !poll_id || !responses) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    const supabase = createAdminSupabase()
    const { data: participant } = await supabase.from('poll_participants').select('*').eq('token', token).eq('poll_id', poll_id).single()
    if (!participant) return NextResponse.json({ error: 'Invalid participant' }, { status: 403 })
    const { data: slots } = await supabase.from('poll_time_slots').select('id').eq('poll_id', poll_id)
    if (!slots || !slots.length) return NextResponse.json({ error: 'No slots' }, { status: 400 })
    for (const slot of slots) {
      const isAvail = responses[slot.id] || false
      const { data: existing } = await supabase.from('scheduling_responses').select('id').eq('participant_id', participant.id).eq('slot_id', slot.id).single()
      if (existing) { await supabase.from('scheduling_responses').update({ is_available: isAvail }).eq('id', existing.id) }
      else { await supabase.from('scheduling_responses').insert({ poll_id, participant_id: participant.id, slot_id: slot.id, is_available: isAvail }) }
    }
    await supabase.from('poll_participants').update({ has_responded: true, responded_at: new Date().toISOString() }).eq('id', participant.id)
    for (const slot of slots) {
      const { count: ac } = await supabase.from('scheduling_responses').select('*', { count: 'exact', head: true }).eq('slot_id', slot.id).eq('is_available', true)
      const { count: tc } = await supabase.from('scheduling_responses').select('*', { count: 'exact', head: true }).eq('slot_id', slot.id)
      await supabase.from('poll_time_slots').update({ available_count: ac || 0, total_responses: tc || 0 }).eq('id', slot.id)
    }
    const { data: allP } = await supabase.from('poll_participants').select('has_responded').eq('poll_id', poll_id)
    const allDone = allP?.every(p => p.has_responded)
    if (allDone) {
      const { data: best } = await supabase.from('poll_time_slots').select('*').eq('poll_id', poll_id).order('available_count', { ascending: false }).limit(1).single()
      if (best) await supabase.from('scheduling_polls').update({ status: 'completed', selected_slot_id: best.id }).eq('id', poll_id)
    }
    return NextResponse.json({ success: true, all_responded: allDone })
  } catch (err) { console.error('Submit error:', err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}
