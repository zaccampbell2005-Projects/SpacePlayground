CREATE TABLE public.cosmic_universes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  universe_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.cosmic_universes TO anon, authenticated;
GRANT ALL ON public.cosmic_universes TO service_role;
ALTER TABLE public.cosmic_universes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view universes" ON public.cosmic_universes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can save universes" ON public.cosmic_universes FOR INSERT TO anon, authenticated WITH CHECK (pg_column_size(universe_state) < 500000);