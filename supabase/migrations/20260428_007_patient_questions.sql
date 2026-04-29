-- Patient-Fragen-Feature
--
-- Patienten können öffentlich Fragen einreichen. Eine KI prüft sofort, ob
-- die Frage sinnvoll und medizinisch relevant ist und ob sie nicht schon
-- durch einen existierenden Artikel beantwortet wird. Akzeptierte Fragen
-- werden als Topic mit source='patient' in die Pipeline aufgenommen.

CREATE TABLE IF NOT EXISTS public.patient_questions (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  question          text          NOT NULL,
  email             text          NOT NULL,
  first_name        text,
  ip_address        inet,
  user_agent        text,

  status            text          NOT NULL DEFAULT 'submitted'
                                  CHECK (status IN (
                                    'submitted',    -- frisch eingereicht, KI noch nicht durch
                                    'accepted',     -- akzeptiert, Topic erstellt
                                    'rejected',     -- nicht sinnvoll/relevant
                                    'duplicate'     -- bereits durch existierenden Artikel beantwortet
                                  )),

  -- KI-Bewertung (Anthropic-Output als jsonb)
  ai_classification jsonb,
  ai_reasoning      text,

  -- Bei duplicate: Verweis auf existierenden Artikel
  duplicate_of_slug text,

  -- Bei rejected: Grund
  rejection_reason  text,

  -- Bei accepted: Verweis auf erstelltes Topic
  topic_id          uuid          REFERENCES public.topics(id) ON DELETE SET NULL,

  -- Newsletter-Opt-In (Phase 2 mit AWeber)
  newsletter_consent boolean      NOT NULL DEFAULT false,
  newsletter_synced_at timestamptz,

  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX patient_questions_status_idx ON public.patient_questions (status, created_at DESC);
CREATE INDEX patient_questions_email_idx  ON public.patient_questions (lower(email), created_at DESC);
CREATE INDEX patient_questions_ip_idx     ON public.patient_questions (ip_address, created_at DESC);
CREATE INDEX patient_questions_topic_idx  ON public.patient_questions (topic_id) WHERE topic_id IS NOT NULL;

CREATE TRIGGER patient_questions_set_updated_at
  BEFORE UPDATE ON public.patient_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- Rate-Limit-Funktion: prüft, ob ein Eintrag innerhalb 7 Tagen geblockt wäre
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_patient_question_rate_limit(
  p_email text,
  p_ip    inet,
  p_max   int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email_count int;
  v_ip_count    int;
BEGIN
  SELECT count(*) INTO v_email_count
  FROM public.patient_questions
  WHERE lower(email) = lower(p_email)
    AND created_at > now() - interval '7 days';

  SELECT count(*) INTO v_ip_count
  FROM public.patient_questions
  WHERE ip_address = p_ip
    AND created_at > now() - interval '7 days'
    AND p_ip IS NOT NULL;

  IF v_email_count >= p_max THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'email_limit',
      'email_count', v_email_count,
      'ip_count', v_ip_count
    );
  END IF;

  IF p_ip IS NOT NULL AND v_ip_count >= p_max THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'ip_limit',
      'email_count', v_email_count,
      'ip_count', v_ip_count
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed', true,
    'email_count', v_email_count,
    'ip_count', v_ip_count
  );
END;
$$;

-- ============================================================================
-- Akzeptier-Funktion: erstellt Topic in der Pipeline und verknüpft
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_patient_question(
  p_question_id uuid,
  p_actor_id    uuid,
  p_topic_title text,
  p_topic_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topic_id uuid;
  v_question public.patient_questions%ROWTYPE;
BEGIN
  SELECT * INTO v_question FROM public.patient_questions WHERE id = p_question_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'patient_question % nicht gefunden', p_question_id; END IF;
  IF v_question.status <> 'submitted' THEN
    RAISE EXCEPTION 'Frage hat Status %, kann nicht akzeptiert werden', v_question.status;
  END IF;

  INSERT INTO public.topics (title, description, source, type, status, notes)
  VALUES (
    p_topic_title,
    coalesce(p_topic_description, v_question.question),
    'patient',
    'new',
    'discovered',
    'Aus Patienten-Frage übernommen am ' || to_char(now(), 'YYYY-MM-DD HH24:MI')
  )
  RETURNING id INTO v_topic_id;

  UPDATE public.patient_questions
     SET status = 'accepted', topic_id = v_topic_id
   WHERE id = p_question_id;

  INSERT INTO public.audit_log (actor_id, action, entity_type, entity_id, payload)
  VALUES (p_actor_id, 'patient_question.accepted', 'patient_question', p_question_id::text,
          jsonb_build_object('topic_id', v_topic_id, 'topic_title', p_topic_title));

  RETURN v_topic_id;
END;
$$;

-- ============================================================================
-- RLS: Public darf nichts direkt — nur via Service-Role im API-Endpoint
-- Authentifizierte Admins dürfen lesen und Status ändern
-- ============================================================================

ALTER TABLE public.patient_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY patient_questions_admin_select ON public.patient_questions
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE POLICY patient_questions_admin_update ON public.patient_questions
  FOR UPDATE TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Insert/Delete laufen ausschließlich via Service-Role (API-Endpoint).

GRANT EXECUTE ON FUNCTION public.check_patient_question_rate_limit(text, inet, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_patient_question(uuid, uuid, text, text) TO authenticated;
