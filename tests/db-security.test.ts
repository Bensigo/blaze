import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { APPLICATION_TABLES, applyMigrations } from "../src/lib/migrations";

it("protects application tables from Supabase roles while preserving owner and unrelated-table access", async () => {
  const db = new PGlite("memory://");
  try {
    await db.exec("CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE TABLE public.unrelated(id integer); GRANT SELECT ON public.unrelated TO anon;");
    await db.transaction(async tx => { await applyMigrations(tx); });
    // Simulate an upgrade from v2 with permissive grants already present.
    await db.exec(`DELETE FROM public.schema_migrations WHERE version=3;
      GRANT ALL ON ${APPLICATION_TABLES.map(t => `public.${t}`).join(", ")} TO anon, authenticated, PUBLIC;
      INSERT INTO public.records(workspace_id,kind,id,body) VALUES('w','game','secret','{}');`);
    await db.transaction(async tx => { await applyMigrations(tx); });
    const relations = await db.query<{relname:string;relrowsecurity:boolean;relforcerowsecurity:boolean}>(
      `SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[]) ORDER BY c.relname`,[APPLICATION_TABLES],
    );
    expect(relations.rows).toHaveLength(APPLICATION_TABLES.length);
    expect(relations.rows.every(r=>r.relrowsecurity && !r.relforcerowsecurity)).toBe(true);
    const policies=await db.query("SELECT * FROM pg_policies WHERE schemaname='public' AND tablename=ANY($1::text[])",[APPLICATION_TABLES]);
    expect(policies.rows).toHaveLength(0);
    const privileges=await db.query<{role_name:string;table_name:string;allowed:boolean}>(`SELECT r.role_name,t.table_name,has_table_privilege(r.role_name,format('public.%I',t.table_name),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') allowed FROM unnest(ARRAY['anon','authenticated']) r(role_name) CROSS JOIN unnest($1::text[]) t(table_name)`,[APPLICATION_TABLES]);
    expect(privileges.rows).toHaveLength(APPLICATION_TABLES.length*2);
    expect(privileges.rows.every(r=>!r.allowed)).toBe(true);
    expect((await db.query("SELECT body FROM public.records WHERE id='secret'")).rows).toHaveLength(1);
    expect((await db.query<{allowed:boolean}>("SELECT has_table_privilege('anon','public.unrelated','SELECT') AS allowed")).rows[0].allowed).toBe(true);
    await db.exec("SET ROLE anon");
    await expect(db.query("SELECT * FROM public.records")).rejects.toThrow(/permission denied/i);
    await db.exec("RESET ROLE; GRANT SELECT ON public.records TO anon; SET ROLE anon");
    expect((await db.query("SELECT * FROM public.records")).rows).toEqual([]);
    await db.exec("RESET ROLE; REVOKE SELECT ON public.records FROM anon");
    await db.transaction(async tx=>{ await applyMigrations(tx); });
    expect((await db.query("SELECT version FROM public.schema_migrations ORDER BY version")).rows).toEqual([{version:1},{version:2},{version:3},{version:4}]);
  } finally { await db.close(); }
});

it("rejects pre-existing app table policies rather than silently exposing data", async () => {
  const db=new PGlite("memory://");
  try {
    await db.transaction(async tx=>{await applyMigrations(tx);});
    await db.exec("DELETE FROM public.schema_migrations WHERE version=3; CREATE POLICY insecure ON public.records FOR SELECT USING (true)");
    await expect(db.transaction(async tx=>{await applyMigrations(tx);})).rejects.toThrow(/existing row security policies/);
    expect((await db.query("SELECT version FROM public.schema_migrations WHERE version=3")).rows).toEqual([]);
  } finally {await db.close();}
});
