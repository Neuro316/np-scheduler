import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const logs: string[] = []
  const log = (msg: string) => { logs.push(msg); console.log('[TEST-CAL]', msg) }

  try {
    const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!)
    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const claim = Buffer.from(JSON.stringify({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now, exp: now + 3600,
    })).toString('base64url')
    const signInput = header + '.' + claim
    const pemContents = key.private_key.replace(/-----BEGIN PRIVATE KEY-----\n?/g, '').replace(/\n?-----END PRIVATE KEY-----\n?/g, '').replace(/\n/g, '')
    const binaryKey = Buffer.from(pemContents, 'base64')
    const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signInput))
    const sig = Buffer.from(signature).toString('base64url')
    const jwt = signInput + '.' + sig
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) })
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) { log('FAIL: ' + JSON.stringify(tokenData)); return NextResponse.json({ success: false, logs }) }
    const accessToken = tokenData.access_token
    log('OK: Got access token')

    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'cameron.s.allen@gmail.com'

    // Create a PERMANENT test event for tomorrow at 3pm ET - DO NOT DELETE
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const startISO = tomorrow.toISOString().split('T')[0] + 'T15:00:00'
    const endISO = tomorrow.toISOString().split('T')[0] + 'T15:30:00'

    const eventBody = {
      summary: 'VISIBLE TEST - NP Scheduler (delete me)',
      description: 'If you can see this event, calendar integration is working!',
      start: { dateTime: startISO, timeZone: 'America/New_York' },
      end: { dateTime: endISO, timeZone: 'America/New_York' },
      attendees: [{ email: 'cameron.s.allen@gmail.com' }, { email: 'cameron@neuroprogeny.com' }],
    }
    log('Creating PERMANENT event on: ' + calendarId)
    log('Event: tomorrow 3:00-3:30 PM ET')

    const calRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events?sendUpdates=all', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody),
    })

    const calBody = await calRes.text()
    log('Status: ' + calRes.status)
    log('Response: ' + calBody)

    if (calRes.ok) {
      const calData = JSON.parse(calBody)
      log('EVENT CREATED AND LEFT ON CALENDAR - check tomorrow 3pm ET')
      log('Event ID: ' + calData.id)
      log('HTML Link: ' + calData.htmlLink)
      return NextResponse.json({ success: true, logs, htmlLink: calData.htmlLink, message: 'Check your calendar for tomorrow 3pm ET' })
    } else {
      return NextResponse.json({ success: false, logs })
    }
  } catch (err: any) {
    log('FATAL: ' + err.message)
    return NextResponse.json({ success: false, logs })
  }
}
