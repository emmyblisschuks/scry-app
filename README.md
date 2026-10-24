# Scry

Upload your study material and your questions, get answers pulled strictly
from your own notes, no outside knowledge, no guessing.

## Stack

- Next.js (App Router, TypeScript, Tailwind v4)
- Supabase (Postgres + pgvector, Auth via Google OAuth, Storage, Edge Functions)
- Tesseract.js for client-side OCR + blur detection on question screenshots
- Gemini API (`text-embedding-004` for embeddings, `gemini-2.0-flash` for answer generation)

## Local setup

1. Copy `.env.example` to `.env.local` and fill in your Supabase project URL
   and anon key (from Supabase dashboard → Project Settings → API).
2. `npm install`
3. `npm run dev`

## Supabase setup (run once, outside this repo)

The database schema (tables, RLS policies, storage buckets, and the
`match_material_chunks` vector-search function) is provided separately and
run directly in the Supabase SQL editor — it isn't tracked in this repo on
purpose, since it touches production data shape and should be reviewed by
hand before running.

You'll also need to enable Google as an auth provider under
Authentication → Providers in the Supabase dashboard, and add this app's
redirect URL (`<your-domain>/auth/callback`) to the allowed redirect list.

## Edge Functions

Two functions live in `supabase/functions/`:

- `process-material` — extracts text from an uploaded PDF/DOCX, chunks it,
  embeds each chunk with Gemini, stores it in `material_chunks`.
- `generate-answers` — for each question in a question set, retrieves the
  most relevant chunks via pgvector similarity and asks Gemini to answer
  using only that context.

Deploy with:

```
supabase functions deploy process-material
supabase functions deploy generate-answers
```

Secrets these functions need (set via `supabase secrets set KEY=value`):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`

## Project structure

```
src/
  app/
    page.tsx                     landing + Google sign-in
    auth/callback/route.ts       OAuth callback handler
    dashboard/page.tsx           workspace grid
    workspace/[id]/page.tsx      upload material + questions
    workspace/[id]/generating/   progress screen, polls question_set status
    workspace/[id]/results/      numbered answer list
  components/                    shared UI pieces
  lib/
    supabase/                    browser + server Supabase clients
    gemini/                      Gemini REST client (reference copy; Edge
                                  Functions use their own Deno-native copy)
    blurDetection.ts             Laplacian-variance blur check, runs client-side
    ocr.ts                       Tesseract.js wrapper
supabase/functions/              Edge Functions (Deno)
```

## Notes on accuracy

The whole point of this app is that answers come from the uploaded material,
not the model's own training data. The Gemini prompt in
`supabase/functions/_shared/gemini.ts` is deliberately strict: no supporting
chunk → `UNSURE`, partial support → flagged `low` confidence. If you change
the prompt, keep that behavior, a wrong confident answer is worse than no
answer.
