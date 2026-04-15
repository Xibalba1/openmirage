import * as Y from "yjs";

interface QueryResult<T> {
  rows: T[];
}

interface Queryable {
  query<T>(sql: string, values?: unknown[]): Promise<QueryResult<T>>;
}

interface QueryableClient extends Queryable {
  release(): void;
}

interface Connectable extends Queryable {
  connect(): Promise<QueryableClient>;
}

export interface CollabPersistenceSnapshotRow {
  last_compacted_seq: string | number;
  page_id: string;
  snapshot_update: Buffer;
  state_vector: Buffer;
  update_count: number;
}

export interface CollabPersistenceUpdateRow {
  seq: string | number;
  update: Buffer;
}

export interface PageDocumentState {
  document: Y.Doc;
  lastSequence: number;
}

export interface PgCollabPersistenceOptions {
  compactionThreshold?: number;
}

export class PgCollabPersistence {
  private readonly compactionThreshold: number;

  constructor(
    private readonly pool: Queryable | Connectable | QueryableClient,
    options: PgCollabPersistenceOptions = {}
  ) {
    this.compactionThreshold = options.compactionThreshold ?? 20;
  }

  async loadPageDocument(pageId: string): Promise<PageDocumentState> {
    const document = new Y.Doc();
    const snapshot = await this.pool.query<CollabPersistenceSnapshotRow>(
      `
        select
          last_compacted_seq,
          page_id,
          snapshot_update,
          state_vector,
          update_count
        from collab_page_snapshots
        where page_id = $1
        limit 1
      `,
      [pageId]
    );
    const snapshotRow = snapshot.rows[0];
    const lastCompactedSeq = Number(snapshotRow?.last_compacted_seq ?? 0);

    if (snapshotRow) {
      Y.applyUpdate(document, new Uint8Array(snapshotRow.snapshot_update));
    }

    const updates = await this.pool.query<CollabPersistenceUpdateRow>(
      `
        select seq, update
        from collab_page_updates
        where page_id = $1
          and seq > $2
        order by seq asc
      `,
      [pageId, lastCompactedSeq]
    );

    for (const row of updates.rows) {
      Y.applyUpdate(document, new Uint8Array(row.update));
    }

    const lastSequence =
      updates.rows.length > 0
        ? Number(updates.rows[updates.rows.length - 1]?.seq ?? lastCompactedSeq)
        : lastCompactedSeq;

    return {
      document,
      lastSequence
    };
  }

  async appendUpdate(pageId: string, update: Uint8Array): Promise<number> {
    const client = await this.connect();

    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [pageId]);
      const result = await client.query<{ seq: string | number }>(
        `
          insert into collab_page_updates (page_id, seq, update)
          values (
            $1,
            (
              select coalesce(max(seq), 0) + 1
              from collab_page_updates
              where page_id = $1
            ),
            $2
          )
          returning seq
        `,
        [pageId, Buffer.from(update)]
      );
      await client.query("commit");

      return Number(result.rows[0]?.seq ?? 0);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      this.release(client);
    }
  }

  async compactPageDocument(pageId: string, document: Y.Doc): Promise<boolean> {
    const client = await this.connect();

    try {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [pageId]);
      const snapshotResult = await client.query<CollabPersistenceSnapshotRow>(
        `
          select
            last_compacted_seq,
            page_id,
            snapshot_update,
            state_vector,
            update_count
          from collab_page_snapshots
          where page_id = $1
          for update
        `,
        [pageId]
      );
      const snapshotRow = snapshotResult.rows[0];
      const lastCompactedSeq = Number(snapshotRow?.last_compacted_seq ?? 0);
      const updatesResult = await client.query<CollabPersistenceUpdateRow>(
        `
          select seq, update
          from collab_page_updates
          where page_id = $1
            and seq > $2
          order by seq asc
          for update
        `,
        [pageId, lastCompactedSeq]
      );

      if (updatesResult.rows.length < this.compactionThreshold) {
        await client.query("rollback");
        return false;
      }

      const lastSequence = Number(
        updatesResult.rows[updatesResult.rows.length - 1]?.seq ?? lastCompactedSeq
      );
      const mergedUpdate = Buffer.from(Y.encodeStateAsUpdate(document));
      const stateVector = Buffer.from(Y.encodeStateVector(document));

      await client.query(
        `
          insert into collab_page_snapshots (
            page_id,
            snapshot_update,
            state_vector,
            update_count,
            last_compacted_seq,
            created_at,
            updated_at
          )
          values ($1, $2, $3, $4, $5, now(), now())
          on conflict (page_id) do update
            set snapshot_update = excluded.snapshot_update,
                state_vector = excluded.state_vector,
                update_count = excluded.update_count,
                last_compacted_seq = excluded.last_compacted_seq,
                updated_at = now()
        `,
        [
          pageId,
          mergedUpdate,
          stateVector,
          lastSequence,
          lastSequence
        ]
      );

      await client.query(
        `
          delete from collab_page_updates
          where page_id = $1
            and seq <= $2
        `,
        [pageId, lastSequence]
      );
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      this.release(client);
    }
  }

  async getPageUpdateCount(pageId: string): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      `
        select count(*)::text as count
        from collab_page_updates
        where page_id = $1
      `,
      [pageId]
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  private async connect(): Promise<QueryableClient> {
    if ("release" in this.pool) {
      return this.pool;
    }

    if ("connect" in this.pool) {
      return this.pool.connect();
    }

    throw new Error("Collab persistence requires a connectable database client");
  }

  private release(client: QueryableClient): void {
    if (!("release" in this.pool)) {
      client.release();
    }
  }
}
