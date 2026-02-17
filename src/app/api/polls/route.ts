import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { title, description, duration_minutes, location, time_slots, participants, send_emails } = body
    if (!title || !time_slots?.length || !participants?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const supabase = createAdminSupabase()

    const { data: poll, error: pollErr } = await supabase
      .from('scheduling_polls')
      .insert({ title, description, duration_minutes: duration_minutes || 30, location: location || 'zoom', created_by: 'cameron@neuroprogeny.com', status: 'active' })
      .select()
      .single()

    if (pollErr) {
      console.error('Poll creation error:', pollErr)
      return NextResponse.json({ error: 'Failed to create poll' }, { status: 500 })
    }

    const slotInserts = time_slots.map((s: { start_time: string; end_time: string }) => ({
      poll_id: poll.id, start_time: s.start_time, end_time: s.end_time,
    }))
    const { error: slotErr } = await supabase.from('poll_time_slots').insert(slotInserts)
    if (slotErr) {
      console.error('Slot creation error:', slotErr)
      await supabase.from('scheduling_polls').delete().eq('id', poll.id)
      return NextResponse.json({ error: 'Failed to create time slots' }, { status: 500 })
    }

    const participantInserts = participants.map((p: { name: string; email: string }) => ({
      poll_id: poll.id, name: p.name, email: p.email,
    }))
    const { data: createdParticipants, error: partErr } = await supabase
      .from('poll_participants').insert(participantInserts).select()
    if (partErr) {
      console.error('Participant creation error:', partErr)
      return NextResponse.json({ error: 'Failed to create participants' }, { status: 500 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
    const votingLinks = createdParticipants?.map(p => ({
      name: p.name, email: p.email,
      voting_url: baseUrl + '/poll/' + poll.id + '?token=' + p.token,
    }))

    return NextResponse.json({
      poll_id: poll.id, status: 'active', voting_links: votingLinks,
      admin_url: baseUrl + '/admin',
      message: 'Poll created. Copy the voting links below to share manually.',
    })
  } catch (err) {
    console.error('Create poll error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const supabase = createAdminSupabase()

    // Fetch polls
    const { data: polls, error: pollsErr } = await supabase
      .from('scheduling_polls')
      .select('*')
      .order('created_at', { ascending: false })

    if (pollsErr) {
      console.error('Fetch polls error:', pollsErr)
      return NextResponse.json({ error: 'Failed to fetch polls' }, { status: 500 })
    }

    // Fetch related data separately to avoid 300 ambiguity
    const pollIds = (polls || []).map(p => p.id)

    const { data: allSlots } = await supabase
      .from('poll_time_slots')
      .select('*')
      .in('poll_id', pollIds)
      .order('start_time', { ascending: true })

    const { data: allParticipants } = await supabase
      .from('poll_participants')
      .select('*')
      .in('poll_id', pollIds)

    // Attach to polls
    const enriched = (polls || []).map(poll => ({
      ...poll,
      poll_time_slots: (allSlots || []).filter(s => s.poll_id === poll.id),
      poll_participants: (allParticipants || []).filter(p => p.poll_id === poll.id),
    }))

    return NextResponse.json({ polls: enriched })
  } catch (err) {
    console.error('List polls error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
