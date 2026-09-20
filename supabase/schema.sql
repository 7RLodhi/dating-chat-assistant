-- Chat Assist v0 — Supabase schema
--
-- Run this once in the Supabase SQL editor (or `supabase db push` if you use
-- the CLI) after creating a new project.
--
-- Access model: all writes happen server-side via API routes using the
-- service role key (see lib/supabase.ts), which bypasses RLS. RLS is
-- enabled on every table with NO policies defined, so anon/browser clients
-- have zero direct read/write access. Do not add a public policy unless you
-- specifically need client-side access to this data.

create extension if not exists pgcrypto;

-- One row per /api/suggest call. This is the eval dataset referenced in
-- v0_Prompt_Templates.md #9 — every generation is tagged with the tone/goal
-- that produced it, plus the mood read and the raw suggestions returned.
create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  mode text not null check (mode in ('reply', 'opener')),
  tone text not null,
  goal text not null,
  input_text text not null,
  extra_context text,
  conversation_read jsonb,
  suggestions jsonb not null,
  model text not null,
  style_applied boolean not null default false,
  via_screenshot boolean not null default false
);

-- One row per thumbs up/down. Linked back to the generation that produced
-- the suggestion whenever the frontend has the generation id available.
create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  generation_id uuid references generations(id) on delete set null,
  suggestion_text text not null,
  tone text not null,
  approach text,
  vote text not null check (vote in ('up', 'down'))
);

-- Fake-paywall email capture.
create table if not exists waitlist (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null unique
);

-- If you already ran an earlier version of this schema, add the new columns
-- instead of dropping the table:
--   alter table generations add column if not exists style_applied boolean not null default false;
--   alter table generations add column if not exists via_screenshot boolean not null default false;

alter table generations enable row level security;
alter table feedback enable row level security;
alter table waitlist enable row level security;

-- Helpful indexes for the analysis queries you'll actually run.
create index if not exists idx_feedback_generation_id on feedback (generation_id);
create index if not exists idx_generations_tone_goal on generations (tone, goal);
create index if not exists idx_generations_created_at on generations (created_at);

-- Convenience view: joins each feedback vote back to the tone/goal/mood
-- that produced it, so "which tone+goal combos get thumbs up" is a simple
-- group-by instead of a manual join every time.
create or replace view feedback_with_context as
select
  f.id as feedback_id,
  f.created_at,
  f.vote,
  f.suggestion_text,
  f.tone as suggestion_tone,
  f.approach,
  g.mode,
  g.tone as requested_tone,
  g.goal,
  g.conversation_read ->> 'mood_label' as mood_label,
  g.style_applied,
  g.via_screenshot
from feedback f
left join generations g on g.id = f.generation_id;
