exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    create extension if not exists pgcrypto;

    create type membership_role as enum ('owner', 'editor', 'viewer');
    create type asset_kind as enum ('image', 'font', 'export', 'thumbnail');
    create type export_job_format as enum ('png', 'jpeg', 'svg', 'pdf');
    create type export_job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');

    create table users (
      id uuid primary key default gen_random_uuid(),
      email text not null,
      display_name text not null,
      avatar_url text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index users_email_lower_idx on users (lower(email));

    create table workspaces (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      slug text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );
    create unique index workspaces_slug_lower_idx on workspaces (lower(slug));

    create table projects (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      name text not null,
      description text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz,
      unique (id, workspace_id)
    );

    create table memberships (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      user_id uuid not null references users(id) on delete cascade,
      role membership_role not null,
      invited_by_user_id uuid references users(id) on delete set null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (workspace_id, user_id)
    );

    create table files (
      id uuid primary key default gen_random_uuid(),
      project_id uuid not null,
      workspace_id uuid not null,
      name text not null,
      description text,
      created_by_user_id uuid not null references users(id) on delete restrict,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz,
      constraint files_project_workspace_fk
        foreign key (project_id, workspace_id)
        references projects(id, workspace_id)
        on delete cascade,
      unique (id, workspace_id)
    );

    create table pages (
      id uuid primary key default gen_random_uuid(),
      file_id uuid not null references files(id) on delete cascade,
      name text not null,
      order_index integer not null,
      width integer,
      height integer,
      background text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique (file_id, order_index),
      unique (id, file_id)
    );

    create table sessions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      revoked_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table magic_link_tokens (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      token_hash text not null unique,
      expires_at timestamptz not null,
      consumed_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz not null default now()
    );

    create table assets (
      id uuid primary key default gen_random_uuid(),
      workspace_id uuid not null references workspaces(id) on delete cascade,
      file_id uuid references files(id) on delete cascade,
      uploaded_by_user_id uuid not null references users(id) on delete restrict,
      kind asset_kind not null,
      filename text not null,
      mime_type text not null,
      byte_size bigint not null,
      storage_key text not null unique,
      width integer,
      height integer,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );

    create table comments (
      id uuid primary key default gen_random_uuid(),
      file_id uuid not null references files(id) on delete cascade,
      page_id uuid,
      node_id text,
      author_user_id uuid not null references users(id) on delete restrict,
      body text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      resolved_at timestamptz,
      deleted_at timestamptz,
      constraint comments_page_file_fk
        foreign key (page_id, file_id)
        references pages(id, file_id)
        on delete cascade
    );

    create table share_links (
      id uuid primary key default gen_random_uuid(),
      file_id uuid not null references files(id) on delete cascade,
      token_hash text not null unique,
      created_by_user_id uuid not null references users(id) on delete restrict,
      expires_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz not null default now()
    );

    create table export_jobs (
      id uuid primary key default gen_random_uuid(),
      file_id uuid not null references files(id) on delete cascade,
      page_id uuid,
      requested_by_user_id uuid not null references users(id) on delete restrict,
      format export_job_format not null,
      status export_job_status not null,
      output_asset_id uuid references assets(id) on delete set null,
      error_message text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint export_jobs_page_file_fk
        foreign key (page_id, file_id)
        references pages(id, file_id)
        on delete cascade
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop table if exists export_jobs;
    drop table if exists share_links;
    drop table if exists comments;
    drop table if exists assets;
    drop table if exists magic_link_tokens;
    drop table if exists sessions;
    drop table if exists pages;
    drop table if exists files;
    drop table if exists memberships;
    drop table if exists projects;
    drop table if exists workspaces;
    drop table if exists users;

    drop type if exists export_job_status;
    drop type if exists export_job_format;
    drop type if exists asset_kind;
    drop type if exists membership_role;
  `);
};
