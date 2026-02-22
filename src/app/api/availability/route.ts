import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const duration = parseInt(req.nextUrl.searchParams.get('duration') || '30')
  const count = parseInt(req.nextUrl.searchParams.get('count') || '3')
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'cameron.s.allen@gmail.com'

  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    try {
      const slots = await getGoogleCalendarSlots(calendarId, duration, count)
      return NextResponse.json({ slots, source: 'google_calendar' })
    } catch (err) {
      console.error('Google Calendar error:', err)
    }
  }

  const slots = generateSmartDefaults(duration, count)
  return NextResponse.json({ slots, source: 'defaults' })
}

// Eastern Time: UTC-5 (EST, Nov-Mar) or UTC-4 (EDT, Mar-Nov)
const ET_OFFSET = 5

async function getGoogleCalendarSlots(calendarId: string, durationMinutes: number, count: number) {
  const accessToken = await getCalendarAccessToken()
  const now = new Date()
  const timeMax = new Date(now)
  timeMax.setDate(timeMax.getDate() + 14)

  const freebusyRes = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: now.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: 'America/New_York',
      items: [{ id: calendarId }],
    }),
  })

  if (!freebusyRes.ok) {
    const err = await freebusyRes.text()
    throw new Error('FreeBusy API error: ' + freebusyRes.status + ' ' + err)
  }

  const freebusyData = await freebusyRes.json()
  const busyTimes: { start: Date; end: Date }[] = (
    freebusyData.calendars?.[calendarId]?.busy || []
  ).map((b: { start: string; end: string }) => ({
    start: new Date(b.start),
    end: new Date(b.end),
  }))

  console.log('Busy times found:', busyTimes.length)

  const slots: { start_time: string; end_time: string }[] = []
  const usedDays = new Set<string>()

  for (let dayOffset = 1; dayOffset <= 14 && slots.length < count; dayOffset++) {
    // Build date in ET
    const dayUTC = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000)
    const etDate = new Date(dayUTC.getTime() - ET_OFFSET * 60 * 60 * 1000)
    const year = etDate.getUTCFullYear()
    const month = etDate.getUTCMonth()
    const day = etDate.getUTCDate()
    const dow = etDate.getUTCDay()

    // Skip weekends
    if (dow === 0 || dow === 6) continue

    const dayKey = year + '-' + month + '-' + day
    if (usedDays.has(dayKey)) continue

    // Only 9am - 2pm ET
    let foundSlot = false
    for (let etHour = 9; etHour < 14 && !foundSlot; etHour++) {
      for (let min = 0; min < 60 && !foundSlot; min += 30) {
        const slotStartUTC = new Date(Date.UTC(year, month, day, etHour + ET_OFFSET, min, 0))
        const slotEndUTC = new Date(slotStartUTC.getTime() + durationMinutes * 60 * 1000)

        // Don't go past 2pm ET
        const cutoffUTC = new Date(Date.UTC(year, month, day, 14 + ET_OFFSET, 0, 0))
        if (slotEndUTC > cutoffUTC) continue
        if (slotStartUTC < now) continue

        const isConflict = busyTimes.some(busy => slotStartUTC < busy.end && slotEndUTC > busy.start)

        if (!isConflict) {
          const sH = String(etHour).padStart(2, '0')
          const sM = String(min).padStart(2, '0')
          const totalEndMin = etHour * 60 + min + durationMinutes
          const eH = String(Math.floor(totalEndMin / 60)).padStart(2, '0')
          const eM = String(totalEndMin % 60).padStart(2, '0')
          const yr = String(year)
          const mo = String(month + 1).padStart(2, '0')
          const dy = String(day).padStart(2, '0')

          slots.push({
            start_time: yr + '-' + mo + '-' + dy + 'T' + sH + ':' + sM + ':00',
            end_time: yr + '-' + mo + '-' + dy + 'T' + eH + ':' + eM + ':00',
          })
          usedDays.add(dayKey)
          foundSlot = true
        }
      }
    }
  }
  return slots
}

async function getCalendarAccessToken(): Promise<string> {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!)
  const now = Math.floor(Date.now() / 1000)

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const claim = btoa(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const signInput = header + '.' + claim

  const pemContents = key.private_key
    .replace(/-----BEGIN PRIVATE KEY-----\n?/, '')
    .replace(/\n?-----END PRIVATE KEY-----\n?/, '')
    .replace(/\n/g, '')
  const binaryKey = Uint8Array.from(atob(pemContents), (c: string) => c.charCodeAt(0))

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  )

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signInput)
  )

  const sigArray = new Uint8Array(signature)
  let sigStr = ''
  for (let i = 0; i < sigArray.length; i++) {
    sigStr += String.fromCharCode(sigArray[i])
  }
  const sig = btoa(sigStr).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const jwt = header + '.' + claim + '.' + sig

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) throw new Error('Failed to get token: ' + JSON.stringify(tokenData))
  return tokenData.access_token
}

function generateSmartDefaults(durationMinutes: number, count: number) {
  const slots: { start_time: string; end_time: string }[] = []
  const now = new Date()
  const preferredHours = [9, 10, 11]
  const checkDate = new Date(now)
  checkDate.setDate(checkDate.getDate() + 1)
  let hourIndex = 0
  while (slots.length < count) {
    const dayOfWeek = checkDate.getDay()
    if (dayOfWeek === 0 || dayOfWeek === 6) { checkDate.setDate(checkDate.getDate() + 1); continue }
    const hour = preferredHours[hourIndex % preferredHours.length]
    const year = checkDate.getFullYear()
    const month = String(checkDate.getMonth() + 1).padStart(2, '0')
    const day = String(checkDate.getDate()).padStart(2, '0')
    const startH = String(hour).padStart(2, '0')
    const endMin = hour * 60 + durationMinutes
    const endH = String(Math.floor(endMin / 60)).padStart(2, '0')
    const endM = String(endMin % 60).padStart(2, '0')
    slots.push({
      start_time: year + '-' + month + '-' + day + 'T' + startH + ':00:00',
      end_time: year + '-' + month + '-' + day + 'T' + endH + ':' + endM + ':00',
    })
    hourIndex++
    checkDate.setDate(checkDate.getDate() + 1)
  }
  return slots
}
