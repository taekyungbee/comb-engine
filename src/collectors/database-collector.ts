import type { CollectorSource } from '@prisma/client';
import { BaseCollector } from './base-collector';
import type { CollectedItem, DatabaseConfig } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Database Collector — Oracle/PostgreSQL/MySQL 직접 연결하여 테이블/프로시저/뷰 메타데이터 수집
 *
 * config 예시:
 * {
 *   dbType: "oracle",
 *   connectionString: "oracle://user:pass@host:1521/SID",
 *   schemas: ["FIDU", "GIBU"],
 *   objectTypes: ["TABLE", "PROCEDURE", "FUNCTION", "VIEW"]
 * }
 */
export class DatabaseCollector extends BaseCollector {
  readonly type = 'DATABASE' as const;

  validate(config: unknown): boolean {
    const c = config as DatabaseConfig;
    return Boolean(c?.dbType && c?.connectionString);
  }

  protected async doCollect(source: CollectorSource): Promise<CollectedItem[]> {
    const config = source.config as unknown as DatabaseConfig;
    if (!config?.dbType || !config?.connectionString) {
      throw new Error('dbType과 connectionString이 필요합니다');
    }

    switch (config.dbType) {
      case 'oracle':
        return this.collectOracle(source.name, config);
      case 'postgresql':
        return this.collectPostgres(source.name, config);
      case 'mysql':
        return this.collectMySQL(source.name, config);
      default:
        throw new Error(`지원하지 않는 DB 타입: ${config.dbType}`);
    }
  }

  // ── Oracle ──

  private async collectOracle(sourceName: string, config: DatabaseConfig): Promise<CollectedItem[]> {
    // @ts-expect-error — oracledb는 옵셔널 의존성
    const oracledb = await import('oracledb').catch(() => {
      throw new Error('oracledb 패키지가 필요합니다: pnpm add oracledb');
    });

    const conn: any = await oracledb.default.getConnection({
      connectionString: config.connectionString,
      user: config.user,
      password: config.password,
    });

    const items: CollectedItem[] = [];
    const schemas = config.schemas ?? ['FIDU'];
    const objectTypes = config.objectTypes ?? ['TABLE', 'PROCEDURE', 'FUNCTION', 'VIEW'];

    try {
      for (const schema of schemas) {
        if (objectTypes.includes('TABLE')) {
          const tables = await conn.execute(
            `SELECT table_name FROM all_tables WHERE owner = :owner ORDER BY table_name`,
            [schema],
          );
          for (const [tableName] of tables.rows ?? []) {
            const item = await this.collectOracleTable(conn, schema, tableName as string);
            if (item) items.push(item);
          }
        }

        for (const objType of objectTypes.filter((t: string) => ['PROCEDURE', 'FUNCTION'].includes(t))) {
          const objects = await conn.execute(
            `SELECT object_name FROM all_objects WHERE owner = :owner AND object_type = :type ORDER BY object_name`,
            [schema, objType],
          );
          for (const [objName] of objects.rows ?? []) {
            const item = await this.collectOracleSource(conn, schema, objName as string, objType);
            if (item) items.push(item);
          }
        }

        if (objectTypes.includes('VIEW')) {
          const views = await conn.execute(
            `SELECT view_name, text FROM all_views WHERE owner = :owner ORDER BY view_name`,
            [schema],
          );
          for (const [viewName, text] of views.rows ?? []) {
            items.push({
              externalId: `${schema}.VIEW.${viewName}`,
              title: `[Oracle 뷰] ${schema}.${viewName}`,
              content: `[${viewName} | 스키마:${schema} | 유형:VIEW]\n${text || ''}`,
              metadata: { schema, objectType: 'VIEW', objectName: viewName as string },
              tags: ['oracle', 'view', schema.toLowerCase()],
            });
          }
        }
      }
    } finally {
      await conn.close();
    }

    console.log(`[DatabaseCollector] Oracle ${sourceName}: ${items.length}개 오브젝트 수집`);
    return items;
  }

  private async collectOracleTable(conn: any, schema: string, tableName: string): Promise<CollectedItem | null> {
    const cols = await conn.execute(
      `SELECT column_name, data_type, data_length, nullable, data_default
       FROM all_tab_columns WHERE owner = :owner AND table_name = :table ORDER BY column_id`,
      [schema, tableName],
    );

    const columns = (cols.rows ?? []) as string[][];
    if (columns.length === 0) return null;

    // 컬럼 주석 조회 (RAG 품질 개선 — 컬럼 의미 파악)
    const colComments = await conn.execute(
      `SELECT column_name, comments FROM all_col_comments
       WHERE owner = :owner AND table_name = :table AND comments IS NOT NULL`,
      [schema, tableName],
    );
    const commentMap = new Map<string, string>(
      ((colComments.rows ?? []) as string[][]).map(([col, cmt]) => [col, cmt])
    );

    const columnList = columns
      .map(([name, type, len, nullable, def]) => {
        let col = `  ${name} ${type}`;
        if (['VARCHAR2', 'CHAR', 'NVARCHAR2'].includes(type)) col += `(${len})`;
        if (nullable === 'N') col += ' NOT NULL';
        if (def) col += ` DEFAULT ${def.trim()}`;
        const cmt = commentMap.get(name);
        if (cmt) col += ` -- ${cmt}`;
        return col;
      })
      .join('\n');

    const comments = await conn.execute(
      `SELECT comments FROM all_tab_comments WHERE owner = :owner AND table_name = :table`,
      [schema, tableName],
    );
    const tableComment = (comments.rows?.[0]?.[0] as string) || '';

    const content = [
      `[${tableName} | 스키마:${schema} | 유형:TABLE | 컬럼수:${columns.length}${tableComment ? ` | 설명:${tableComment}` : ''}]`,
      `[Oracle 테이블] ${schema}.${tableName}`,
      `컬럼 (${columns.length}개):`,
      columnList,
    ].join('\n');

    return {
      externalId: `${schema}.TABLE.${tableName}`,
      title: `[Oracle 테이블] ${schema}.${tableName}`,
      content,
      metadata: { schema, objectType: 'TABLE', objectName: tableName, columnCount: columns.length, comment: tableComment },
      tags: ['oracle', 'table', schema.toLowerCase()],
    };
  }

  private async collectOracleSource(conn: any, schema: string, objName: string, objType: string): Promise<CollectedItem | null> {
    const result = await conn.execute(
      `SELECT text FROM all_source WHERE owner = :owner AND name = :name AND type = :type ORDER BY line`,
      [schema, objName, objType],
    );

    const lines = ((result.rows ?? []) as string[][]).map(([line]) => line);
    if (lines.length === 0) return null;

    return {
      externalId: `${schema}.${objType}.${objName}`,
      title: `[Oracle ${objType.toLowerCase()}] ${schema}.${objName}`,
      content: `[${objName} | 스키마:${schema} | 유형:${objType}]\n${lines.join('')}`,
      metadata: { schema, objectType: objType, objectName: objName, lineCount: lines.length },
      tags: ['oracle', objType.toLowerCase(), schema.toLowerCase()],
    };
  }

  // ── PostgreSQL ──

  private async collectPostgres(sourceName: string, config: DatabaseConfig): Promise<CollectedItem[]> {
    // @ts-expect-error — pg는 옵셔널 의존성
    const pg: any = await import('pg').catch(() => {
      throw new Error('pg 패키지가 필요합니다: pnpm add pg');
    });

    const client = new pg.default.Client({ connectionString: config.connectionString });
    await client.connect();

    const items: CollectedItem[] = [];
    const schemas = config.schemas ?? ['public'];

    try {
      for (const schema of schemas) {
        const tables = await client.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
          [schema],
        );

        for (const row of tables.rows) {
          const tableName = row.table_name as string;
          const cols = await client.query(
            `SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
            [schema, tableName],
          );

          const columnList = cols.rows
            .map((c: any) => {
              let col = `  ${c.column_name} ${c.data_type}`;
              if (c.character_maximum_length) col += `(${c.character_maximum_length})`;
              if (c.is_nullable === 'NO') col += ' NOT NULL';
              if (c.column_default) col += ` DEFAULT ${c.column_default}`;
              return col;
            })
            .join('\n');

          items.push({
            externalId: `${schema}.${tableName}`,
            title: `[PostgreSQL 테이블] ${schema}.${tableName}`,
            content: `[${tableName} | 스키마:${schema} | 유형:TABLE | 컬럼수:${cols.rows.length}]\n컬럼:\n${columnList}`,
            metadata: { schema, objectType: 'TABLE', objectName: tableName, columnCount: cols.rows.length },
            tags: ['postgresql', 'table', schema],
          });
        }

        const funcs = await client.query(
          `SELECT routine_name, routine_definition
           FROM information_schema.routines
           WHERE routine_schema = $1 AND routine_type = 'FUNCTION' ORDER BY routine_name`,
          [schema],
        );

        for (const row of funcs.rows) {
          const funcName = row.routine_name as string;
          const def = (row.routine_definition as string) || '';
          items.push({
            externalId: `${schema}.FUNCTION.${funcName}`,
            title: `[PostgreSQL 함수] ${schema}.${funcName}`,
            content: `[${funcName} | 스키마:${schema} | 유형:FUNCTION]\n${def}`,
            metadata: { schema, objectType: 'FUNCTION', objectName: funcName },
            tags: ['postgresql', 'function', schema],
          });
        }
      }
    } finally {
      await client.end();
    }

    console.log(`[DatabaseCollector] PostgreSQL ${sourceName}: ${items.length}개 오브젝트 수집`);
    return items;
  }

  // ── MySQL ──

  private async collectMySQL(sourceName: string, config: DatabaseConfig): Promise<CollectedItem[]> {
    // @ts-expect-error — mysql2는 옵셔널 의존성
    const mysql: any = await import('mysql2/promise').catch(() => {
      throw new Error('mysql2 패키지가 필요합니다: pnpm add mysql2');
    });

    const conn = await mysql.default.createConnection(config.connectionString);
    const items: CollectedItem[] = [];
    const schemas = config.schemas ?? [];

    try {
      const targetSchemas = schemas.length > 0 ? schemas : [''];

      for (const schema of targetSchemas) {
        if (schema) await conn.query(`USE \`${schema}\``);

        const [tables] = await conn.query('SHOW TABLES');

        for (const row of tables as any[]) {
          const tableName = Object.values(row)[0] as string;
          const [cols] = await conn.query(`DESCRIBE \`${tableName}\``);

          const columnList = (cols as any[])
            .map((c: any) => `  ${c.Field} ${c.Type}${c.Null === 'NO' ? ' NOT NULL' : ''}${c.Default ? ` DEFAULT ${c.Default}` : ''}`)
            .join('\n');

          const schemaLabel = schema || 'default';
          items.push({
            externalId: `${schemaLabel}.${tableName}`,
            title: `[MySQL 테이블] ${schemaLabel}.${tableName}`,
            content: `[${tableName} | 스키마:${schemaLabel} | 유형:TABLE | 컬럼수:${(cols as any[]).length}]\n컬럼:\n${columnList}`,
            metadata: { schema: schemaLabel, objectType: 'TABLE', objectName: tableName, columnCount: (cols as any[]).length },
            tags: ['mysql', 'table', schemaLabel],
          });
        }
      }
    } finally {
      await conn.end();
    }

    console.log(`[DatabaseCollector] MySQL ${sourceName}: ${items.length}개 오브젝트 수집`);
    return items;
  }
}
