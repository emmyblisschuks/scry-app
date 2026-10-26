// supabase-js hides an edge function's response body inside error.context
// (a fetch Response). Pull the text out so failures are diagnosable.
export async function readFunctionError(err: unknown): Promise<string> {
  const ctx = (err as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.text === "function") {
    try {
      return await ctx.text();
    } catch {
      // fall through to the generic message
    }
  }
  return err instanceof Error ? err.message : String(err);
}
