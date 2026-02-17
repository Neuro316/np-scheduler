import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const duration = parseInt(req.nextUrl.searchParams.get('duration') || '30')
  const count = parseInt(req.nextUrl.searchParams.get('count') || '3')
  const slots = generateSmartDefaults(duration, count)
  return NextResponse.json({ slots, source: 'defaults' })
}

function generateSmartDefaults(durationMinutes: number, count: number) {
  const slots: { start_time: string; end_time: string }[] = []
  const now = new Date()
  const preferredHours = [10, 14, 11]

  const checkDate = new Date(now)
  checkDate.setDate(checkDate.getDate() + 1)

  let hourIndex = 0
  while (slots.length < count) {
    const dayOfWeek = checkDate.getDay()
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      checkDate.setDate(checkDate.getDate() + 1)
      continue
    }
    const hour = preferredHours[hourIndex % preferredHours.length]

    // Build date string as YYYY-MM-DD without timezone conversion
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
