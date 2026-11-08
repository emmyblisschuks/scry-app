import type { SupabaseClient } from "@supabase/supabase-js";

// Storage's list() only returns one level at a time, and a "folder" shows up
// as an entry with no id/metadata (it's just an inferred common prefix, not
// a real object) — so cleaning up a workspace's files means walking down
// into every folder and collecting the real files as we go.
async function removeStorageTree(
  supabase: SupabaseClient,
  bucket: string,
  prefix: string
): Promise<void> {
  const { data: entries } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  if (!entries || entries.length === 0) return;

  const files: string[] = [];
  const folders: string[] = [];
  for (const entry of entries) {
    const path = `${prefix}/${entry.name}`;
    // A real file has an id/metadata; a folder placeholder has neither.
    if (entry.id) files.push(path);
    else folders.push(path);
  }

  await Promise.all(folders.map((f) => removeStorageTree(supabase, bucket, f)));
  if (files.length > 0) await supabase.storage.from(bucket).remove(files);
}

// Deletes everything that belongs to one workspace. Every DB table that
// hangs off a workspace (materials, question_sets, questions, answers,
// material_units, learn_progress, unit_quizzes, quiz_attempts, ...) cascades
// from either `workspaces` or `materials` via ON DELETE CASCADE, so the
// database side is handled by deleting the workspace row. Storage is not
// part of that cascade, so the uploaded files (course PDFs, question
// screenshots) have to be removed explicitly here, or they'd sit in Supabase
// Storage forever even after the workspace "disappears" from the app.
export async function deleteWorkspaceCompletely(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string
): Promise<{ error: string | null }> {
  await Promise.all([
    removeStorageTree(supabase, "materials", `${userId}/${workspaceId}`),
    removeStorageTree(supabase, "question-screenshots", `${userId}/${workspaceId}`),
  ]);

  const { error } = await supabase.from("workspaces").delete().eq("id", workspaceId);
  return { error: error?.message ?? null };
}
