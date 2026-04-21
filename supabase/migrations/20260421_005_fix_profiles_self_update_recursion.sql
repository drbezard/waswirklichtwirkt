-- ============================================================================
-- Migration: 005 - Fix infinite recursion in profiles_self_update policy
-- ============================================================================
-- Problem: Die ursprüngliche Policy 'profiles_self_update' enthält im
-- WITH CHECK einen SELECT auf public.profiles. Dieser Sub-Query triggert
-- die Policy erneut → "infinite recursion detected in policy for relation
-- profiles". Folge: kein Arzt kann sein eigenes Profil speichern.
--
-- Fix: Eine SECURITY-DEFINER-Funktion get_own_role() umgeht RLS und liefert
-- die Rolle des aufrufenden Users. Die Policy nutzt diese Funktion statt
-- eines direkten Sub-Queries — keine Rekursion mehr, Rolle bleibt weiter
-- vor Self-Eskalation zum Admin geschützt.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_own_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_own_role() TO authenticated;

DROP POLICY IF EXISTS "profiles_self_update" ON public.profiles;

CREATE POLICY "profiles_self_update" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = public.get_own_role());
