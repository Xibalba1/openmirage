exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    alter table export_jobs
      add column started_at timestamptz,
      add column completed_at timestamptz;

    alter table files
      add column thumbnail_asset_id uuid references assets(id) on delete set null;

    alter table pages
      add column thumbnail_asset_id uuid references assets(id) on delete set null;

    create index files_thumbnail_asset_id_idx
      on files (thumbnail_asset_id)
      where thumbnail_asset_id is not null;

    create index pages_thumbnail_asset_id_idx
      on pages (thumbnail_asset_id)
      where thumbnail_asset_id is not null;

    create index export_jobs_status_created_at_idx
      on export_jobs (status, created_at);

    create index export_jobs_running_started_at_idx
      on export_jobs (started_at)
      where status = 'running';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    drop index if exists export_jobs_running_started_at_idx;
    drop index if exists export_jobs_status_created_at_idx;
    drop index if exists pages_thumbnail_asset_id_idx;
    drop index if exists files_thumbnail_asset_id_idx;

    alter table pages
      drop column if exists thumbnail_asset_id;

    alter table files
      drop column if exists thumbnail_asset_id;

    alter table export_jobs
      drop column if exists completed_at,
      drop column if exists started_at;
  `);
};
