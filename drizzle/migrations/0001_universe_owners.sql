ALTER TABLE public.cosmic_universes ADD COLUMN owner_id uuid;
ALTER TABLE public.cosmic_universes ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX cosmic_universes_owner_idx ON public.cosmic_universes(owner_id);
GRANT UPDATE, DELETE ON public.cosmic_universes TO authenticated;
DROP POLICY "Anyone can save universes" ON public.cosmic_universes;
CREATE POLICY "Guests save unowned universes" ON public.cosmic_universes FOR INSERT TO anon WITH CHECK (owner_id IS NULL AND pg_column_size(universe_state) < 500000);
CREATE POLICY "Users save own universes" ON public.cosmic_universes FOR INSERT TO authenticated WITH CHECK ((owner_id IS NULL OR owner_id = auth.uid()) AND pg_column_size(universe_state) < 500000);
CREATE POLICY "Owners update universes" ON public.cosmic_universes FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid() AND pg_column_size(universe_state) < 500000);
CREATE POLICY "Owners delete universes" ON public.cosmic_universes FOR DELETE TO authenticated USING (owner_id = auth.uid());