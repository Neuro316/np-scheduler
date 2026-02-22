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
      if (best) {
        await supabase.from('scheduling_polls').update({ status: 'completed', selected_slot_id: best.id }).eq('id', poll_id)

        // Load full poll and participants for Zoom + Calendar
        const { data: poll } = await supabase.from('scheduling_polls').select('*').eq('id', poll_id).single()
        const { data: parts } = await supabase.from('poll_participants').select('*').eq('poll_id', poll_id)
        const emails = (parts || []).map((p: any) => p.email)
        let zoomJoinUrl: string | null = null

        // Create Zoom meeting
        if (process.env.ZOOM_ACCOUNT_ID && poll?.location === 'zoom') {
          try {
            const zoomToken = await getZoomToken()
            const zoomRes = await fetch('https://api.zoom.us/v2/users/me/meetings', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + zoomToken, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                topic: poll.title,
                type: 2,
                start_time: best.start_time,
                duration: poll.duration_minutes,
                timezone: 'America/New_York',
                settings: { host_video: true, participant_video: true, join_before_host: true, waiting_room: false, meeting_invitees: emails.map((e: string) => ({ email: e })) },
              }),
            })
            if (zoomRes.ok) {
              const zoomData = await zoomRes.json()
              zoomJoinUrl = zoomData.join_url
              await supabase.from('scheduling_polls').update({ zoom_join_url: zoomData.join_url, zoom_meeting_id: String(zoomData.id) }).eq('id', poll_id)
            }
          } catch (e) { console.error('Zoom error:', e) }
        }

        // Create Google Calendar event
        if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
          try {
            const calToken = await getCalendarToken()
            const calendarId = process.env.GOOGLE_CALENDAR_ID || 'cameron.s.allen@gmail.com'
            const eventBody: any = {
              summary: poll?.title || 'Meeting',
              description: (poll?.description || '') + (zoomJoinUrl ? '\n\nZoom: ' + zoomJoinUrl : ''),
              start: { dateTime: best.start_time, timeZone: 'America/New_York' },
              end: { dateTime: best.end_time, timeZone: 'America/New_York' },
              attendees: emails.map((e: string) => ({ email: e })),
              reminders: { useDefault: true },
            }
            if (zoomJoinUrl) eventBody.location = zoomJoinUrl
            const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events?sendUpdates=all', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + calToken, 'Content-Type': 'application/json' },
              body: JSON.stringify(eventBody),
            })
            if (calRes.ok) {
              const calData = await calRes.json()
              await supabase.from('scheduling_polls').update({ calendar_event_id: calData.id }).eq('id', poll_id)
            }
          } catch (e) { console.error('Calendar error:', e) }
        }

        // Send confirmation emails
        if (process.env.SENDGRID_API_KEY && parts) {
          const startD = new Date(best.start_time)
          const endD = new Date(best.end_time)
          const dateStr = startD.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
          const timeStr = startD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' - ' + endD.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET'
          for (const p of parts) {
            try {
              const html = '<div style="font-family:Helvetica,Arial,sans-serif;background:#f0f4f8;padding:40px 20px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);"><div style="background:#476B8E;padding:28px 32px;"><h1 style="margin:0;color:#fff;font-size:22px;">Neuro Progeny</h1></div><div style="padding:32px;"><div style="text-align:center;margin-bottom:20px;"><div style="display:inline-block;width:48px;height:48px;background:#52B788;border-radius:50%;line-height:48px;"><span style="color:white;font-size:24px;">&#10003;</span></div></div><h2 style="text-align:center;color:#1E293B;margin:0 0 8px;">Meeting Confirmed</h2><p style="color:#333;">Hi ' + p.name + ',</p><p style="color:#555;">Everyone has responded and your meeting is locked in:</p><div style="background:#476B8E10;border-radius:12px;padding:16px;margin:20px 0;text-align:center;"><p style="font-size:18px;font-weight:600;color:#476B8E;margin:0;">' + dateStr + '</p><p style="font-size:16px;color:#1E293B;margin:4px 0 0;">' + timeStr + '</p></div>' + (zoomJoinUrl ? '<div style="text-align:center;margin:24px 0;"><a href="' + zoomJoinUrl + '" style="display:inline-block;background:#2D8CFF;color:white;padding:12px 32px;border-radius:12px;text-decoration:none;font-weight:600;">Join Zoom Meeting</a></div>' : '') + '<p style="color:#94A3B8;font-size:13px;text-align:center;">A calendar invite has also been sent.</p></div></div></div>'
              await fetch('https://api.sendgrid.com/v3/mail/send', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + process.env.SENDGRID_API_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  personalizations: [{ to: [{ email: p.email, name: p.name }] }],
                  from: { email: 'shane@neuroprogeny.com', name: 'Shane Granau' },
                  subject: 'Confirmed: ' + (poll?.title || 'Meeting'),
                  content: [{ type: 'text/html', value: html }],
                }),
              })
            } catch (e) { console.error('Email error:', e) }
          }
        }
      }
    }

    return NextResponse.json({ success: true, all_responded: allDone })
  } catch (err) { console.error('Submit error:', err); return NextResponse.json({ error: 'Server error' }, { status: 500 }) }
}

async function getZoomToken(): Promise<string> {
  const res = await fetch('https://zoom.us/oauth/token?grant_type=account_credentials&account_id=' + process.env.ZOOM_ACCOUNT_ID, {
    method: 'POST',
    headers: { 'Authorization': 'Basic ' + Buffer.from(process.env.ZOOM_CLIENT_ID + ':' + process.env.ZOOM_CLIENT_SECRET).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('Zoom token failed')
  return data.access_token
}

async function getCalendarToken(): Promise<string> {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!)
  const now = Math.floor(Date.now() / 1000)
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const claim = btoa(JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/calendar', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const signInput = header + '.' + claim
  const pemContents = key.private_key.replace(/-----BEGIN PRIVATE KEY-----\n?/, '').replace(/\n?-----END PRIVATE KEY-----\n?/, '').replace(/\n/g, '')
  const binaryKey = Uint8Array.from(atob(pemContents), (c: string) => c.charCodeAt(0))
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signInput))
  const sigArray = new Uint8Array(signature)
  let sigStr = ''
  for (let i = 0; i < sigArray.length; i++) sigStr += String.fromCharCode(sigArray[i])
  const sig = btoa(sigStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const jwt = header + '.' + claim + '.' + sig
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error('Calendar token failed: ' + JSON.stringify(tokenData))
  return tokenData.access_token
}
