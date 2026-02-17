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
  checkDate.setHours(0, 0, 0, 0)
  let hourIndex = 0
  while (slots.length < count) {
    const dayOfWeek = checkDate.getDay()
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      checkDate.setDate(checkDate.getDate() + 1)
      continue
    }
    const hour = preferredHours[hourIndex % preferredHours.length]
    const slotStart = new Date(checkDate)
    slotStart.setHours(hour, 0, 0, 0)
    const slotEnd = new Date(slotStart)
    slotEnd.setMinutes(slotEnd.getMinutes() + durationMinutes)
    slots.push({ start_time: slotStart.toISOString(), end_time: slotEnd.toISOString() })
    hourIndex++
    checkDate.setDate(checkDate.getDate() + 1)
  }
  return slots
}
