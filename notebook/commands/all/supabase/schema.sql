-- Supabase schema for the Notebook sync system
-- Table: day_files — stores daily notebook markdown files for mobile sync

create table if not exists day_files (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  file_date  date not null,
  started    timestamptz,
  file_path  text not null,
  content    text not null,
  content_hash text not null,
  updated_at timestamptz not null default now(),
  synced_from text not null,

  constraint day_files_user_date_unique unique (user_id, file_date)
);

create index if not exists day_files_user_id_idx on day_files (user_id);
create index if not exists day_files_file_date_idx on day_files (file_date);
