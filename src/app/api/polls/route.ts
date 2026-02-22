import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

async function sendInviteEmail(
  to: string,
  participantName: string,
  pollTitle: string,
  pollDescription: string | null,
  votingUrl: string,
  timeSlots: { start_time: string; end_time: string }[]
) {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) return { sent: false, reason: 'No SendGrid API key' }

  const slotList = timeSlots.map(s => {
    const start = new Date(s.start_time)
    const end = new Date(s.end_time)
    const dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    const startStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const endStr = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    return '<li style="margin-bottom:8px;color:#333;">' + dateStr + ' - ' + startStr + ' to ' + endStr + '</li>'
  }).join('')

  const html = '<div style="font-family:Helvetica,Arial,sans-serif;background:#f0f4f8;padding:40px 20px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);"><div style="background:#476B8E;padding:28px 32px;"><h1 style="margin:0;color:#fff;font-size:22px;">Neuro Progeny</h1></div><div style="padding:32px;"><p style="color:#333;font-size:16px;margin:0 0 8px;">Hi ' + participantName + ',</p><p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 20px;">You have been invited to find a time for <strong>' + pollTitle + '</strong>.' + (pollDescription ? ' ' + pollDescription : '') + '</p><p style="color:#555;font-size:14px;margin:0 0 12px;font-weight:600;">Available time options:</p><ul style="padding-left:20px;margin:0 0 24px;">' + slotList + '</ul><div style="text-align:center;margin:28px 0;"><a href="' + votingUrl + '" style="display:inline-block;background:#476B8E;color:#fff;text-decoration:none;padding:14px 36px;border-radius:12px;font-size:16px;font-weight:600;">Vote on Availability</a></div><p style="color:#999;font-size:12px;text-align:center;">Click the button above to mark which times work for you.</p></div></div></div>'

  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to, name: participantName }] }],
      from: { email: 'shane@neuroprogeny.com', name: 'Shane Granau' },
      subject: 'When are you available? - ' + pollTitle,
      content: [{ type: 'text/html', value: html }],
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('SendGrid error for ' + to + ':', res.status, err)
    return { sent: false, reason: err }
  }
  return { sent: true }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { title, description, duration_minutes, location, time_slots, participants } = body
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
    const votingLinks = []
    const emailResults = []

    for (const p of (createdParticipants || [])) {
      const votingUrl = baseUrl + '/poll/' + poll.id + '?token=' + p.token
      votingLinks.push({ name: p.name, email: p.email, voting_url: votingUrl })

      const emailResult = await sendInviteEmail(p.email, p.name, title, description, votingUrl, time_slots)
      emailResults.push({ email: p.email, ...emailResult })

      if (emailResult.sent) {
        await supabase.from('poll_email_log').insert({
          poll_id: poll.id, participant_id: p.id, email_type: 'invite',
          to_email: p.email, subject: 'When are you available? - ' + title, status: 'sent',
        })
      }
    }

    return NextResponse.json({
      poll_id: poll.id, status: 'active', voting_links: votingLinks,
      emails: emailResults, admin_url: baseUrl + '/admin',
    })
  } catch (err) {
    console.error('Create poll error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const supabase = createAdminSupabase()
    const { data: polls, error: pollsErr } = await supabase
      .from('scheduling_polls').select('*').order('created_at', { ascending: false })

    if (pollsErr) {
      console.error('Fetch polls error:', pollsErr)
      return NextResponse.json({ error: 'Failed to fetch polls' }, { status: 500 })
    }

    const pollIds = (polls || []).map(p => p.id)
    const { data: allSlots } = await supabase
      .from('poll_time_slots').select('*').in('poll_id', pollIds).order('start_time', { ascending: true })
    const { data: allParticipants } = await supabase
      .from('poll_participants').select('*').in('poll_id', pollIds)

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
