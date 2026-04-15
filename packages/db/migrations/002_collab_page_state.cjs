exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    create table collab_page_snapshots (
      page_id uuid primary key references pages(id) on delete cascade,
      snapshot_update bytea not null,
      state_vector bytea not null,
      update_count integer not null default 0,
      last_compacted_seq bigint not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table collab_page_updates (
      id bigserial primary key,
      page_id uuid not null references pages(id) on delete cascade,
      seq bigint not null,
      update bytea not null,
      created_at timestamptz not null default now(),
      unique (page_id, seq)
    );

    create index collab_page_updates_page_id_seq_idx
      on collab_page_updates (page_id, seq);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop table if exists collab_page_updates;
    drop table if exists collab_page_snapshots;
  `);
};
