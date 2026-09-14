import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, ownerHash } from "./store";
import { AppError } from "../domain/validation";
import { bookmarkActionSchema, type BookmarkFolder } from "../domain/bookmarks";

function connection() {
  const sql = db();
  sql.exec(`CREATE TABLE IF NOT EXISTS bookmark_folders (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(owner, name)
  ); CREATE TABLE IF NOT EXISTS bookmark_posts (
    folder TEXT NOT NULL REFERENCES bookmark_folders(id) ON DELETE CASCADE,
    url TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(folder, url)
  );`);
  return sql;
}
export function listBookmarks(token: string): BookmarkFolder[] {
  const sql = connection();
  const folders = sql.prepare("SELECT id, name FROM bookmark_folders WHERE owner = ? ORDER BY rowid").all(ownerHash(token)) as Array<{id: string; name: string}>;
  return folders.map(folder => ({ ...folder, posts: (sql.prepare("SELECT data FROM bookmark_posts WHERE folder = ? ORDER BY rowid DESC").all(folder.id) as Array<{data: string}>).map(row => JSON.parse(row.data)) }));
}
export function changeBookmarks(token: string, input: z.input<typeof bookmarkActionSchema>) {
  const action = bookmarkActionSchema.parse(input);
  const sql = connection();
  const owner = ownerHash(token);
  sql.exec("BEGIN IMMEDIATE");
  try {
    if (action.action === "create" || action.action === "rename") {
      const duplicate = sql.prepare("SELECT id FROM bookmark_folders WHERE owner = ? AND name = ?").get(owner, action.name) as {id: string} | undefined;
      if (duplicate && (action.action === "create" || duplicate.id !== action.id)) throw new AppError("DUPLICATE_FOLDER", "已有同名收藏夹，请换一个名称。");
    }
    if (action.action === "create") {
      const count = sql.prepare("SELECT COUNT(*) AS n FROM bookmark_folders WHERE owner = ?").get(owner) as {n: number};
      if (count.n >= 100) throw new AppError("FOLDER_LIMIT", "最多创建 100 个收藏夹。");
      const id = randomUUID();
      sql.prepare("INSERT INTO bookmark_folders VALUES (?, ?, ?)").run(id, owner, action.name);
      if (action.post) sql.prepare("INSERT INTO bookmark_posts VALUES (?, ?, ?)").run(id, action.post.url, JSON.stringify(action.post));
    } else {
      if (!sql.prepare("SELECT id FROM bookmark_folders WHERE id = ? AND owner = ?").get(action.id, owner)) throw new AppError("FOLDER_NOT_FOUND", "收藏夹不存在，请刷新后重试。", 404);
      if (action.action === "rename") sql.prepare("UPDATE bookmark_folders SET name = ? WHERE id = ?").run(action.name, action.id);
      if (action.action === "delete") sql.prepare("DELETE FROM bookmark_folders WHERE id = ?").run(action.id);
      if (action.action === "save") sql.prepare("INSERT INTO bookmark_posts VALUES (?, ?, ?) ON CONFLICT(folder, url) DO UPDATE SET data = excluded.data").run(action.id, action.post.url, JSON.stringify(action.post));
      if (action.action === "remove") sql.prepare("DELETE FROM bookmark_posts WHERE folder = ? AND url = ?").run(action.id, action.url);
    }
    sql.exec("COMMIT");
  } catch (error) { sql.exec("ROLLBACK"); throw error; }
  return listBookmarks(token);
}
