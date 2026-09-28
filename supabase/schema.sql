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
  via_screenshot boolean not null default false,
  language text not null default 'auto' check (language in ('auto', 'english', 'hindi', 'hinglish'))
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

-- "Did they reply?" outcomes: one row per answered nudge. This is the
-- reply-rate dataset — the strongest validation signal for the product.
create table if not exists outcomes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  generation_id uuid references generations(id) on delete set null,
  match_name text,
  suggestion_text text not null,
  replied boolean not null
);

-- Community name-pun directory: one row per submitted pun, with worked /
-- not-worked vote counters. Served by /api/puns and /api/puns/vote.
create table if not exists name_puns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  pun text not null,
  worked integer not null default 0,
  not_worked integer not null default 0
);

-- If you already ran an earlier version of this schema, add the new columns
-- instead of dropping the table:
--   alter table generations add column if not exists style_applied boolean not null default false;
--   alter table generations add column if not exists via_screenshot boolean not null default false;
--   alter table generations add column if not exists language text not null default 'auto';

-- Requested-but-missing name puns: demand signal for which names to add next.
create table if not exists pun_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null
);

alter table generations enable row level security;
alter table feedback enable row level security;
alter table waitlist enable row level security;
alter table name_puns enable row level security;
alter table outcomes enable row level security;
alter table pun_requests enable row level security;

-- Helpful indexes for the analysis queries you'll actually run.
create index if not exists idx_feedback_generation_id on feedback (generation_id);
create index if not exists idx_generations_tone_goal on generations (tone, goal);
create index if not exists idx_generations_created_at on generations (created_at);
create index if not exists idx_name_puns_name on name_puns (name);
create index if not exists idx_name_puns_worked on name_puns (worked desc);
-- Added: the dashboard's "per match" feature groups exclusively by
-- match_name, and resolveSuggestion() joins outcomes back to generations —
-- neither had a supporting index before, meaning a full table scan (or
-- full sort, for created_at) on every /api/stats hit.
create index if not exists idx_outcomes_match_name on outcomes (match_name);
create index if not exists idx_outcomes_generation_id on outcomes (generation_id);
create index if not exists idx_outcomes_created_at on outcomes (created_at);
create index if not exists idx_feedback_created_at on feedback (created_at);

-- Atomic vote increment for name_puns. Replaces a client-side
-- select-then-update (lib/store.ts voteNamePun): that pattern is two round
-- trips AND a lost-update race — two concurrent votes on the same pun can
-- both read worked=5, both write worked=6, silently dropping one vote.
-- This function does the increment and read-back in one statement.
create or replace function increment_pun_vote(pun_id uuid, worked_vote boolean)
returns table (
  id uuid,
  name text,
  pun text,
  worked integer,
  not_worked integer,
  created_at timestamptz
)
language plpgsql
as $$
begin
  if worked_vote then
    return query
      update name_puns set worked = name_puns.worked + 1
      where name_puns.id = pun_id
      returning name_puns.id, name_puns.name, name_puns.pun,
                name_puns.worked, name_puns.not_worked, name_puns.created_at;
  else
    return query
      update name_puns set not_worked = name_puns.not_worked + 1
      where name_puns.id = pun_id
      returning name_puns.id, name_puns.name, name_puns.pun,
                name_puns.worked, name_puns.not_worked, name_puns.created_at;
  end if;
end;
$$;

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
  g.via_screenshot,
  g.language
from feedback f
left join generations g on g.id = f.generation_id;
