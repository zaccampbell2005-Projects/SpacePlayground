import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import type { UniverseState } from "./scenarios";

export interface UniverseRow {
  id: string;
  name: string;
  created_at: string;
  owner_id: string | null;
  universe_state: UniverseState;
}

const COLS = "id,name,created_at,owner_id,universe_state";
const clean = (n: string) => n.trim().slice(0, 80) || "Untitled universe";

export async function saveUniverse(name: string, state: UniverseState, ownerId: string | null) {
  const { data, error } = await supabase
    .from("cosmic_universes")
    .insert({ name: clean(name), universe_state: state as unknown as Json, owner_id: ownerId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function updateUniverse(id: string, patch: { name?: string; state?: UniverseState }) {
  const row: { name?: string; universe_state?: Json; updated_at: string } = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = clean(patch.name);
  if (patch.state) row.universe_state = patch.state as unknown as Json;
  const { data, error } = await supabase.from("cosmic_universes").update(row).eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Not allowed");
}

export async function deleteUniverse(id: string) {
  const { data, error } = await supabase.from("cosmic_universes").delete().eq("id", id).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("Not allowed");
}

export async function listUniverses(ownerId?: string) {
  let q = supabase.from("cosmic_universes").select(COLS).order("created_at", { ascending: false }).limit(30);
  if (ownerId) q = q.eq("owner_id", ownerId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as UniverseRow[];
}

export async function getUniverse(id: string) {
  const { data, error } = await supabase.from("cosmic_universes").select(COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as UniverseRow | null;
}
