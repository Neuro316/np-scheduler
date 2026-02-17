import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

// POST /api/complete - Finalize a completed poll:
// 1. Create Zoom meeting (if location = zoom)
// 2. Create Google Calendar event with all participants
// 3. Send confirmation emails
// 4. Update poll with meeting details

export async function POST(req: NextRequest) {
  try {
    const { poll_id } = await req.json()
    if (!poll_id) {
      return NextResponse.json({ error: 'poll_id required' }, { status: 400 })
    }

    const supabase = createAdminSupabase()

    // Load poll with selected slot and participants
    const { data: poll } = await supabase
      .from('scheduling_polls')
      .select('*, poll_time_slots(*), poll_participants(*)')
      .eq('id', poll_id)
      .single()

    if (!poll || poll.status !== 'completed') {
      return NextResponse.json({ error: 'Poll not found or not yet completed' }, { status: 400 })
    }

    const selectedSlot = poll.poll_time_slots?.find(
      (s: any) => s.id === poll.selected_slot_id
    )

    if (!selectedSlot) {
      return NextResponse.json({ error: 'No selected time slot' }, { status: 400 })
    }

    const participantEmails = poll.poll_participants?.map((p: any) => p.email) || []
    let zoomJoinUrl = null
    let zoomMeetingId = null

    // ── Step 1: Create Zoom Meeting ──
    if (poll.location === 'zoom' && process.env.ZOOM_ACCOUNT_ID) {
      try {
        const zoomResult = await createZoomMeeting({
          topic: poll.title,
          start_time: selectedSlot.start_time,
          duration: poll.duration_minutes,
          invitees: participantEmails,
        })
        zoomJoinUrl = zoomResult.join_url
        zoomMeetingId = zoomResult.id?.toString()
      } catch (err) {
        console.error('Zoom meeting creation failed:', err)
        // Continue without Zoom - don't block the calendar event
      }
    }

    // ── Step 2: Create Google Calendar Event ──
    let calendarEventId = null
    if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      try {
        calendarEventId = await createCalendarEvent({
          summary: poll.title,
          description: poll.description || '',
          start: selectedSlot.start_time,
          end: selectedSlot.end_time,
          attendees: participantEmails,
          zoomLink: zoomJoinUrl,
          calendarId: process.env.GOOGLE_CALENDAR_ID || 'cameron@neuroprogeny.com',
        })
      } catch (err) {
        console.error('Calendar event creation failed:', err)
      }
    }

    // ── Step 3: Update poll with meeting details ──
    await supabase
      .from('scheduling_polls')
      .update({
        zoom_join_url: zoomJoinUrl,
        zoom_meeting_id: zoomMeetingId,
        calendar_event_id: calendarEventId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', poll_id)

    // ── Step 4: Send confirmation emails ──
    if (process.env.SENDGRID_API_KEY) {
      for (const participant of (poll.poll_participants || [])) {
        try {
          await sendConfirmationEmail({
            to: participant.email,
            name: participant.name,
            pollTitle: poll.title,
            startTime: selectedSlot.start_time,
            endTime: selectedSlot.end_time,
            zoomUrl: zoomJoinUrl,
          })

          await supabase.from('poll_email_log').insert({
            poll_id,
            participant_id: participant.id,
            email_type: 'confirmation',
            to_email: participant.email,
            subject: `Confirmed: ${poll.title}`,
            status: 'sent',
          })
        } catch (err) {
          console.error(`Confirmation email failed for ${participant.email}:`, err)
        }
      }
    }

    return NextResponse.json({
      success: true,
      zoom_join_url: zoomJoinUrl,
      calendar_event_id: calendarEventId,
      selected_time: {
        start: selectedSlot.start_time,
        end: selectedSlot.end_time,
      },
    })

  } catch (err) {
    console.error('Complete poll error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}


// ─── Zoom Server-to-Server OAuth ────────────────────────────
async function getZoomAccessToken(): Promise<string> {
  const accountId = process.env.ZOOM_ACCOUNT_ID!
  const clientId = process.env.ZOOM_CLIENT_ID!
  const clientSecret = process.env.ZOOM_CLIENT_SECRET!

  const response = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${accountId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  )

  const data = await response.json()
  if (!data.access_token) throw new Error('Failed to get Zoom token')
  return data.access_token
}

async function createZoomMeeting(params: {
  topic: string
  start_time: string
  duration: number
  invitees: string[]
}) {
  const token = await getZoomAccessToken()

  const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      topic: params.topic,
      type: 2, // Scheduled meeting
      start_time: params.start_time,
      duration: params.duration,
      timezone: 'America/New_York',
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: true,
        waiting_room: false,
        meeting_invitees: params.invitees.map(email => ({ email })),
      },
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Zoom API error: ${response.status} ${err}`)
  }

  return response.json()
}


// ─── Google Calendar via Service Account ────────────────────
async function createCalendarEvent(params: {
  summary: string
  description: string
  start: string
  end: string
  attendees: string[]
  zoomLink: string | null
  calendarId: string
}): Promise<string | null> {
  // Get access token from service account
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!)
  const jwt = await createServiceAccountJWT(key)
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  const { access_token } = await tokenRes.json()

  const eventBody: any = {
    summary: params.summary,
    description: params.description + (params.zoomLink ? `\n\nZoom: ${params.zoomLink}` : ''),
    start: { dateTime: params.start, timeZone: 'America/New_York' },
    end: { dateTime: params.end, timeZone: 'America/New_York' },
    attendees: params.attendees.map(email => ({ email })),
    reminders: { useDefault: true },
  }

  if (params.zoomLink) {
    eventBody.location = params.zoomLink
    eventBody.conferenceData = {
      entryPoints: [{ entryPointType: 'video', uri: params.zoomLink }],
      conferenceSolution: { name: { entryPointType: 'video' }, key: { type: 'addOn' } },
    }
  }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(params.calendarId)}/events?sendUpdates=all`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    }
  )

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Calendar API error: ${response.status} ${err}`)
  }

  const event = await response.json()
  return event.id
}

// JWT creation for Google service account
async function createServiceAccountJWT(key: any): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const claim = btoa(JSON.stringify({
    iss: key.client_email,
    sub: process.env.GOOGLE_CALENDAR_ID || 'cameron@neuroprogeny.com',
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))

  const signInput = `${header}.${claim}`

  // Use Web Crypto API to sign with RSA
  const pemKey = key.private_key
  const pemContents = pemKey.replace(/-----BEGIN PRIVATE KEY-----\n?/, '').replace(/\n?-----END PRIVATE KEY-----\n?/, '').replace(/\n/g, '')
  const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signInput)
  )

  const sigArray = new Uint8Array(signature)
  let sigStr = ''
  for (let i = 0; i < sigArray.length; i++) {
    sigStr += String.fromCharCode(sigArray[i])
  }
  const sig = btoa(sigStr)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const headerB64 = header.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const claimB64 = claim.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return `${headerB64}.${claimB64}.${sig}`
}


// ─── Confirmation Email ─────────────────────────────────────
async function sendConfirmationEmail(params: {
  to: string
  name: string
  pollTitle: string
  startTime: string
  endTime: string
  zoomUrl: string | null
}) {
  const { to, name, pollTitle, startTime, endTime, zoomUrl } = params
  const start = new Date(startTime)
  const end = new Date(endTime)

  const dateStr = start.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const timeStr = `${start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`

  await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to, name }] }],
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'cameron@neuroprogeny.com',
        name: 'Neuro Progeny',
      },
      subject: `Confirmed: ${pollTitle}`,
      content: [{
        type: 'text/html',
        value: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#F8FAFB;font-family:'Helvetica Neue',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
    <div style="background:white;border-radius:16px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="display:inline-block;width:48px;height:48px;background:#52B788;border-radius:50%;line-height:48px;">
          <span style="color:white;font-size:24px;">&#10003;</span>
        </div>
      </div>
      <h1 style="font-family:Georgia,serif;font-size:24px;color:#1E293B;text-align:center;margin:0 0 8px;">
        Meeting Confirmed
      </h1>
      <p style="color:#1E293B;font-size:15px;">Hi ${name},</p>
      <p style="color:#1E293B;font-size:15px;">Everyone has responded and your meeting is locked in:</p>
      <div style="background:#476B8E10;border-radius:12px;padding:16px;margin:20px 0;text-align:center;">
        <p style="font-size:18px;font-weight:600;color:#476B8E;margin:0;">${dateStr}</p>
        <p style="font-size:16px;color:#1E293B;margin:4px 0 0;">${timeStr}</p>
      </div>
      ${zoomUrl ? `
      <div style="text-align:center;margin:24px 0;">
        <a href="${zoomUrl}" style="display:inline-block;background:#2D8CFF;color:white;padding:12px 32px;border-radius:12px;text-decoration:none;font-weight:600;">
          Join Zoom Meeting
        </a>
      </div>` : ''}
      <p style="color:#94A3B8;font-size:13px;text-align:center;">A calendar invite has also been sent.</p>
    </div>
  </div>
</body>
</html>`.trim()
      }]
    })
  })
}
