import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const logs: string[] = []
  const log = (msg: string) => { logs.push(msg); console.log('[TEST-CAL]', msg) }

  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      log('FAIL: GOOGLE_SERVICE_ACCOUNT_KEY env var is missing')
      return NextResponse.json({ success: false, logs })
    }
    log('OK: GOOGLE_SERVICE_ACCOUNT_KEY exists')

    let key: any
    try {
      key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
      log('OK: JSON parsed. client_email=' + key.client_email)
      log('OK: private_key length: ' + key.private_key?.length)
    } catch (e: any) {
      log('FAIL: Could not parse JSON: ' + e.message)
      return NextResponse.json({ success: false, logs })
    }

    const now = Math.floor(Date.now() / 1000)
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
    const claim = Buffer.from(JSON.stringify({
      iss: key.client_email,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })).toString('base64url')
    const signInput = header + '.' + claim
    log('OK: JWT header+claim built')

    let cryptoKey: CryptoKey
    try {
      const pemContents = key.private_key
        .replace(/-----BEGIN PRIVATE KEY-----\n?/g, '')
        .replace(/\n?-----END PRIVATE KEY-----\n?/g, '')
        .replace(/\n/g, '')
      const binaryKey = Buffer.from(pemContents, 'base64')
      log('OK: PEM decoded, binary key length=' + binaryKey.length)
      cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
      log('OK: Crypto key imported')
    } catch (e: any) {
      log('FAIL: Key import error: ' + e.message)
      return NextResponse.json({ success: false, logs })
    }

    let jwt: string
    try {
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signInput))
      const sig = Buffer.from(signature).toString('base64url')
      jwt = signInput + '.' + sig
      log('OK: JWT signed')
    } catch (e: any) {
      log('FAIL: Signing error: ' + e.message)
      return NextResponse.json({ success: false, logs })
    }

    let accessToken: string
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
      })
      const tokenData = await tokenRes.json()
      if (!tokenData.access_token) {
        log('FAIL: Token exchange failed: ' + JSON.stringify(tokenData))
        return NextResponse.json({ success: false, logs })
      }
      accessToken = tokenData.access_token
      log('OK: Got access token')
    } catch (e: any) {
      log('FAIL: Token exchange error: ' + e.message)
      return NextResponse.json({ success: false, logs })
    }

    const calendarId = process.env.GOOGLE_CALENDAR_ID || 'cameron.s.allen@gmail.com'
    log('Using calendarId: ' + calendarId)

    const testStart = new Date()
    testStart.setDate(testStart.getDate() + 7)
    testStart.setHours(15, 0, 0, 0)
    const testEnd = new Date(testStart)
    testEnd.setMinutes(testEnd.getMinutes() + 30)

    const eventBody = {
      summary: 'NP Scheduler Test Event (DELETE ME)',
      description: 'Test event to verify calendar integration works.',
      start: { dateTime: testStart.toISOString(), timeZone: 'America/New_York' },
      end: { dateTime: testEnd.toISOString(), timeZone: 'America/New_York' },
    }
    log('Creating test event: ' + JSON.stringify(eventBody))

    const calUrl = 'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events'
    const calRes = await fetch(calUrl, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(eventBody),
    })

    const calBody = await calRes.text()
    log('Calendar API status: ' + calRes.status)
    log('Calendar API response: ' + calBody)

    if (calRes.ok) {
      const calData = JSON.parse(calBody)
      log('SUCCESS! Event created: id=' + calData.id)
      await fetch(calUrl + '/' + calData.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + accessToken } })
      log('Test event deleted')
      return NextResponse.json({ success: true, logs })
    } else {
      log('FAIL: Calendar API returned ' + calRes.status)
      return NextResponse.json({ success: false, logs })
    }
  } catch (err: any) {
    log('FATAL: ' + err.message)
    return NextResponse.json({ success: false, logs })
  }
}
