import { NextRequest, NextResponse } from 'next/server'

// This webhook is called by Supabase Database Webhooks
// when scheduling_polls.status changes to 'completed'
//
// Setup in Supabase Dashboard:
// Database → Webhooks → Create → 
//   Table: scheduling_polls
//   Events: UPDATE
//   URL: https://your-domain.vercel.app/api/webhook
//   Headers: { "x-webhook-secret": "your-secret" }

export async function POST(req: NextRequest) {
  // Verify webhook secret
  const secret = req.headers.get('x-webhook-secret')
  if (secret !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = await req.json()

    // Supabase sends: { type, table, record, old_record, schema }
    const { record, old_record } = payload

    // Only trigger when status changes to 'completed'
    if (
      record?.status === 'completed' &&
      old_record?.status !== 'completed'
    ) {
      // Call our completion endpoint
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
      const res = await fetch(`${baseUrl}/api/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ poll_id: record.id }),
      })

      const result = await res.json()
      return NextResponse.json({ processed: true, result })
    }

    return NextResponse.json({ processed: false, reason: 'Not a completion event' })

  } catch (err) {
    console.error('Webhook error:', err)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 })
  }
}
