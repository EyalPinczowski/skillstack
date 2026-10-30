-- Skillstack – catalog + RAG schema (PostgreSQL / Supabase, free plan)
-- Run once per schema: SET search_path TO rnd;  (then repeat with prod)
-- Requires the pgvector extension (available on Supabase free plan).

create extension if not exists vector;

-- ---------- Taxonomy ----------
create table if not exists skills (
  id          text primary key,
  name        text not null,
  category    text not null,
  keywords    text[] not null default '{}'
);

create table if not exists roles (
  id           text primary key,
  title        text not null,
  aliases      text[] not null default '{}',
  summary      text not null,
  jd_keywords  text[] not null default '{}',
  suggested_path jsonb not null default '{}'
);

create table if not exists role_skills (
  role_id   text references roles(id) on delete cascade,
  skill_id  text references skills(id) on delete cascade,
  weight    smallint not null check (weight between 1 and 5),
  primary key (role_id, skill_id)
);

-- ---------- Catalog ----------
create table if not exists catalog_items (
  id                   text primary key,
  user_id              uuid,                -- null = shared seed item; set = "Added by me"
  title                text not null,
  provider             text,
  url                  text,
  type                 text not null check (type in ('course','cert_exam','practice')),
  cost_type            text not null check (cost_type in ('free','free_audit','one_time','subscription')),
  price                numeric,
  currency             text default 'USD',
  subscription_period  text,
  certificate_price    numeric,
  certificate_type     text not null default 'none'
                       check (certificate_type in ('none','completion','skills_test','official_exam')),
  recognition          text not null default 'low' check (recognition in ('low','medium','high')),
  est_hours            numeric not null,
  level                text default 'beginner',
  format               text[] default '{}',
  language             text default 'en',
  notes                text default '',
  added_by             text not null default 'seed' check (added_by in ('seed','me')),
  url_verified         boolean not null default false,
  price_verified       boolean not null default false,
  source               text,
  last_link_check      timestamptz,
  link_ok              boolean,
  created_at           timestamptz not null default now(),
  -- keyword search (hybrid retrieval)
  search_tsv           tsvector generated always as (
                         to_tsvector('english', coalesce(title,'') || ' ' || coalesce(provider,'') || ' ' || coalesce(notes,''))
                       ) stored
);
create index if not exists catalog_items_tsv_idx on catalog_items using gin (search_tsv);

create table if not exists item_skills (
  item_id   text references catalog_items(id) on delete cascade,
  skill_id  text references skills(id) on delete cascade,
  primary key (item_id, skill_id)
);

create table if not exists item_roles (
  item_id   text references catalog_items(id) on delete cascade,
  role_id   text,              -- '*' = relevant to every role
  primary key (item_id, role_id)
);

create table if not exists item_links (
  item_id     text references catalog_items(id) on delete cascade,
  related_id  text references catalog_items(id) on delete cascade,
  kind        text not null check (kind in ('prerequisite','free_alternative')),
  primary key (item_id, related_id, kind)
);

-- ---------- RAG documents ----------
-- One row per entry in documents.jsonl. Embeddings: 384 dimensions, produced by a free
-- open model run locally (e.g. all-MiniLM-L6-v2 or gte-small via transformers.js) –
-- no paid embedding API. If the model changes, re-embed everything and update the dimension.
create table if not exists rag_documents (
  id          text primary key,           -- e.g. 'item:psm-1', 'role:data-analyst', 'skill:sql'
  kind        text not null check (kind in ('catalog_item','role','skill','user_note')),
  ref_id      text not null,
  content     text not null,
  metadata    jsonb not null default '{}',
  embedding   vector(384),
  embedded_at timestamptz,
  model       text
);
create index if not exists rag_documents_embedding_idx
  on rag_documents using hnsw (embedding vector_cosine_ops);
create index if not exists rag_documents_kind_idx on rag_documents (kind);

-- Semantic search with filters the plan builder needs (budget, certificates, kind).
create or replace function match_catalog(
  query_embedding vector(384),
  match_count     int     default 20,
  max_price       numeric default null,     -- null = no limit
  free_only       boolean default false,
  min_recognition text    default null      -- 'medium' or 'high'
)
returns table (ref_id text, content text, metadata jsonb, similarity float)
language sql stable as $$
  select d.ref_id, d.content, d.metadata, 1 - (d.embedding <=> query_embedding) as similarity
  from rag_documents d
  join catalog_items c on c.id = d.ref_id
  where d.kind = 'catalog_item'
    and d.embedding is not null
    and (not free_only or c.cost_type in ('free','free_audit'))
    and (max_price is null or c.cost_type in ('free','free_audit') or coalesce(c.price,0) <= max_price)
    and (min_recognition is null
         or (min_recognition = 'medium' and c.recognition in ('medium','high'))
         or (min_recognition = 'high'   and c.recognition = 'high'))
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
