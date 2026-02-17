-- ============================================================================
-- NEURO PROGENY SCHEDULING POLL SYSTEM
-- Complete schema for email-embedded scheduling polls
--
-- Flow:
-- 1. Admin creates a poll with time slots
-- 2. System emails participants unique voting links
-- 3. Participants toggle available/not available per slot
-- 4. When all participants respond, system auto-detects best time
-- 5. Google Calendar event + Zoom link created, invites sent
-- ============================================================================

-- ── 1. scheduling_polls ──────────────────────────────────────
-- The parent poll record
CREATE TABLE IF NOT EXISTS scheduling_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  location TEXT,                          -- 'zoom', 'in_person', 'phone', or a URL
  created_by TEXT NOT NULL,               -- email of poll creator
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'completed', 'cancelled', 'expired')),
  
  -- Auto-completion settings
  auto_complete BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  
  -- Result
  selected_slot_id UUID,                  -- FK added after poll_time_slots created
  calendar_event_id TEXT,                 -- Google Calendar event ID
  zoom_join_url TEXT,                     -- Zoom meeting join URL
  zoom_meeting_id TEXT,                   -- Zoom meeting ID
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. poll_time_slots ───────────────────────────────────────
-- Available time slots for a poll
CREATE TABLE IF NOT EXISTS poll_time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES scheduling_polls(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  
  -- Scoring (auto-calculated by trigger)
  available_count INTEGER NOT NULL DEFAULT 0,
  total_responses INTEGER NOT NULL DEFAULT 0,
  score NUMERIC(5,2) NOT NULL DEFAULT 0,  -- percentage available
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

CREATE INDEX idx_slots_poll ON poll_time_slots(poll_id);

-- Now add the FK for selected_slot
ALTER TABLE scheduling_polls
  ADD CONSTRAINT fk_selected_slot
  FOREIGN KEY (selected_slot_id) REFERENCES poll_time_slots(id)
  ON DELETE SET NULL;

-- ── 3. poll_participants ─────────────────────────────────────
-- People invited to vote on the poll
CREATE TABLE IF NOT EXISTS poll_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES scheduling_polls(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  
  -- Status
  has_responded BOOLEAN NOT NULL DEFAULT false,
  responded_at TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(poll_id, email)
);

CREATE INDEX idx_participants_poll ON poll_participants(poll_id);
CREATE INDEX idx_participants_token ON poll_participants(token);

-- ── 4. scheduling_responses ──────────────────────────────────
-- Individual votes: one row per participant per time slot
CREATE TABLE IF NOT EXISTS scheduling_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES scheduling_polls(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES poll_participants(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES poll_time_slots(id) ON DELETE CASCADE,
  
  -- Binary: available or not
  is_available BOOLEAN NOT NULL DEFAULT false,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(participant_id, slot_id)
);

CREATE INDEX idx_responses_poll ON scheduling_responses(poll_id);
CREATE INDEX idx_responses_slot ON scheduling_responses(slot_id);
CREATE INDEX idx_responses_participant ON scheduling_responses(participant_id);

-- ── 5. poll_email_log ────────────────────────────────────────
-- Track all emails sent (invites, reminders, confirmations)
CREATE TABLE IF NOT EXISTS poll_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES scheduling_polls(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES poll_participants(id) ON DELETE SET NULL,
  email_type TEXT NOT NULL
    CHECK (email_type IN ('invite', 'reminder', 'confirmation', 'cancellation')),
  to_email TEXT NOT NULL,
  subject TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent', 'delivered', 'bounced', 'failed'))
);

CREATE INDEX idx_email_log_poll ON poll_email_log(poll_id);


-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- ── Update slot scores when a response is inserted/updated ───
CREATE OR REPLACE FUNCTION update_slot_scores()
RETURNS TRIGGER AS $$
BEGIN
  -- Recalculate counts for the affected slot
  UPDATE poll_time_slots SET
    available_count = (
      SELECT COUNT(*) FROM scheduling_responses
      WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id)
        AND is_available = true
    ),
    total_responses = (
      SELECT COUNT(*) FROM scheduling_responses
      WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id)
    ),
    score = CASE
      WHEN (SELECT COUNT(*) FROM scheduling_responses WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id)) = 0
      THEN 0
      ELSE ROUND(
        (SELECT COUNT(*) FROM scheduling_responses WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id) AND is_available = true)::numeric /
        (SELECT COUNT(*) FROM scheduling_responses WHERE slot_id = COALESCE(NEW.slot_id, OLD.slot_id))::numeric * 100,
        2
      )
    END
  WHERE id = COALESCE(NEW.slot_id, OLD.slot_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_slot_scores
  AFTER INSERT OR UPDATE OR DELETE ON scheduling_responses
  FOR EACH ROW EXECUTE FUNCTION update_slot_scores();


-- ── Mark participant as responded when all slots have votes ──
CREATE OR REPLACE FUNCTION check_participant_responded()
RETURNS TRIGGER AS $$
DECLARE
  total_slots INTEGER;
  responded_slots INTEGER;
  v_poll_id UUID;
BEGIN
  -- Get the poll_id from the participant
  SELECT poll_id INTO v_poll_id FROM poll_participants WHERE id = NEW.participant_id;

  -- Count total slots for this poll
  SELECT COUNT(*) INTO total_slots
  FROM poll_time_slots WHERE poll_id = v_poll_id;

  -- Count how many slots this participant has responded to
  SELECT COUNT(*) INTO responded_slots
  FROM scheduling_responses WHERE participant_id = NEW.participant_id;

  -- If all slots answered, mark participant as responded
  IF responded_slots >= total_slots THEN
    UPDATE poll_participants SET
      has_responded = true,
      responded_at = now()
    WHERE id = NEW.participant_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_participant_responded
  AFTER INSERT OR UPDATE ON scheduling_responses
  FOR EACH ROW EXECUTE FUNCTION check_participant_responded();


-- ── Auto-complete poll when all participants have responded ──
CREATE OR REPLACE FUNCTION check_poll_complete()
RETURNS TRIGGER AS $$
DECLARE
  total_participants INTEGER;
  responded_participants INTEGER;
  best_slot UUID;
  v_poll_auto_complete BOOLEAN;
BEGIN
  -- Only fire when has_responded changes to true
  IF NEW.has_responded = true AND (OLD.has_responded = false OR OLD.has_responded IS NULL) THEN

    -- Check if auto_complete is enabled
    SELECT auto_complete INTO v_poll_auto_complete
    FROM scheduling_polls WHERE id = NEW.poll_id;

    IF NOT v_poll_auto_complete THEN
      RETURN NEW;
    END IF;

    -- Count participants
    SELECT COUNT(*) INTO total_participants
    FROM poll_participants WHERE poll_id = NEW.poll_id;

    SELECT COUNT(*) INTO responded_participants
    FROM poll_participants WHERE poll_id = NEW.poll_id AND has_responded = true;

    -- If everyone has responded, find the best slot and complete the poll
    IF responded_participants >= total_participants THEN
      -- Find the slot with the highest score (most available), 
      -- break ties by earliest start_time
      SELECT pts.id INTO best_slot
      FROM poll_time_slots pts
      WHERE pts.poll_id = NEW.poll_id
      ORDER BY pts.available_count DESC, pts.start_time ASC
      LIMIT 1;

      -- Mark poll as completed with the winning slot
      UPDATE scheduling_polls SET
        status = 'completed',
        selected_slot_id = best_slot,
        updated_at = now()
      WHERE id = NEW.poll_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_poll_complete
  AFTER UPDATE ON poll_participants
  FOR EACH ROW EXECUTE FUNCTION check_poll_complete();


-- ── Auto-update updated_at timestamps ────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_polls_updated_at
  BEFORE UPDATE ON scheduling_polls
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_responses_updated_at
  BEFORE UPDATE ON scheduling_responses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- ROW LEVEL SECURITY
-- This is a public-facing tool (no auth required for voting),
-- so we use service_role for admin operations and anon for voting.
-- ============================================================================

ALTER TABLE scheduling_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduling_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_email_log ENABLE ROW LEVEL SECURITY;

-- Anon can read polls (needed for voting page)
CREATE POLICY "Anyone can view active polls" ON scheduling_polls
  FOR SELECT USING (status IN ('active', 'completed'));

-- Anon can read time slots for active polls
CREATE POLICY "Anyone can view poll time slots" ON poll_time_slots
  FOR SELECT USING (
    poll_id IN (SELECT id FROM scheduling_polls WHERE status IN ('active', 'completed'))
  );

-- Anon can read their own participant record (via token lookup in API)
CREATE POLICY "Anyone can view participants" ON poll_participants
  FOR SELECT USING (true);

-- Anon can read responses for polls they participate in
CREATE POLICY "Anyone can view responses" ON scheduling_responses
  FOR SELECT USING (true);

-- Anon can insert responses (voting)
CREATE POLICY "Anyone can submit responses" ON scheduling_responses
  FOR INSERT WITH CHECK (true);

-- Anon can update their own responses (change vote)
CREATE POLICY "Anyone can update responses" ON scheduling_responses
  FOR UPDATE USING (true);

-- Service role handles all admin operations (poll creation, email logging, etc.)
-- Service role bypasses RLS automatically

-- ============================================================================
-- DONE
-- ============================================================================
