# NP Scheduler - Email-Integrated Scheduling Polls

Scheduling poll system for Neuro Progeny. Send polls via email, participants vote on availability, system auto-detects the best time, creates Google Calendar events, generates Zoom links, and sends invites.

## How It Works

1. **Create a poll** at `/create` - add time slots and participant emails
2. **Participants receive emails** with unique voting links
3. **Each person toggles** available/unavailable for each time slot
4. **When everyone responds**, the system automatically:
   - Selects the best time (highest availability, earliest tiebreak)
   - Creates a Zoom meeting
   - Creates a Google Calendar event with all attendees
   - Sends confirmation emails to everyone

## Tech Stack

- **Next.js 14** (App Router)
- **Supabase** (Postgres, RLS, database triggers)
- **Vercel** (hosting)
- **SendGrid** (email delivery)
- **Zoom Server-to-Server OAuth** (auto-create meetings)
- **Google Calendar API** (auto-create events via service account)

## Setup

### Step 1: Supabase

1. Go to your Supabase project dashboard
2. Open **SQL Editor** → New Query
3. Paste the entire contents of `supabase/migrations/001_scheduling_polls.sql`
4. Click **Run**

This creates 5 tables + triggers + RLS policies:
- `scheduling_polls` - parent poll records
- `poll_time_slots` - available time options
- `poll_participants` - people invited to vote (with unique tokens)
- `scheduling_responses` - individual votes per slot
- `poll_email_log` - tracks all emails sent

### Step 2: Deploy to Vercel

```bash
# Push to GitHub
git init
git add .
git commit -m "NP Scheduler"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/np-scheduler.git
git push -u origin main
```

Then in Vercel:
1. Import the repo
2. Add environment variables (see `.env.example`)
3. Deploy

### Step 3: Configure Integrations

#### SendGrid (Email)
1. Sign up at [sendgrid.com](https://sendgrid.com)
2. Settings → API Keys → Create API Key (with Mail Send permission)
3. Add `SENDGRID_API_KEY` to Vercel env vars
4. Verify your sender domain/email in SendGrid

#### Zoom (Auto-create meetings)
1. Go to [marketplace.zoom.us](https://marketplace.zoom.us)
2. Develop → Build App → Server-to-Server OAuth
3. Add scope: `meeting:write:admin`
4. Copy Account ID, Client ID, Client Secret to Vercel env vars

#### Google Calendar (Auto-create events)
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a Service Account → Create Key (JSON)
3. Enable Google Calendar API
4. Share your calendar with the service account email (give "Make changes to events" permission)
5. Add the JSON key contents as `GOOGLE_SERVICE_ACCOUNT_KEY` env var

### Step 4: Supabase Webhook (Optional - Auto-trigger)

To automatically create Zoom + Calendar when polls complete:

1. Supabase Dashboard → Database → Webhooks
2. Create webhook:
   - Table: `scheduling_polls`
   - Events: `UPDATE`
   - URL: `https://your-domain.vercel.app/api/webhook`
   - Headers: `{ "x-webhook-secret": "your-secret" }`

Without this webhook, you can manually trigger completion from the admin dashboard.

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Landing page |
| `/create` | Create a new scheduling poll |
| `/admin` | View all polls + responses |
| `/poll/[id]?token=xxx` | Participant voting page |

## API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/polls` | POST | Create a poll |
| `/api/polls` | GET | List all polls (admin) |
| `/api/complete` | POST | Trigger Zoom + Calendar creation |
| `/api/webhook` | POST | Supabase webhook handler |

## Without SendGrid

If you skip SendGrid setup, polls still work. The create endpoint returns voting URLs that you can manually copy and send via email, text, Slack, etc.

## Integration Estimated Setup Times

| Integration | Time | Required? |
|-------------|------|-----------|
| Supabase tables | 2 min | Yes |
| Vercel deploy | 5 min | Yes |
| SendGrid | 15 min | Recommended |
| Zoom | 20 min | Optional |
| Google Calendar | 25 min | Optional |
| Supabase webhook | 5 min | Optional |
