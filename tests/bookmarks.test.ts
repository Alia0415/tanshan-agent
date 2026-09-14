import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.WENSHAN_DB_PATH = join(mkdtempSync(join(tmpdir(), "tanshan-bookmarks-")), "test.sqlite");
import { changeBookmarks, listBookmarks } from "../src/lib/server/bookmarks";
import { bookmarkActionSchema } from "../src/lib/domain/bookmarks";
const post = { title: "测试帖子", url: "https://www.zhihu.com/question/12/answer/34?utm_source=test", author: "作者", excerpt: "摘要" };
test("folder lifecycle, deduplication, persistence and owner isolation", () => {
  let folders = changeBookmarks("alice", { action: "create", name: " 学习 ", post });
  const id = folders[0].id;
  assert.equal(folders[0].name, "学习");
  assert.equal(folders[0].posts[0].url, "https://www.zhihu.com/answer/34");
  folders = changeBookmarks("alice", { action: "save", id, post: { ...post, url: "https://www.zhihu.com/answer/34" } });
  assert.equal(folders[0].posts.length, 1);
  assert.deepEqual(listBookmarks("bob"), []);
  for (const action of [{ action: "delete", id }, { action: "rename", id, name: "盗用" }, { action: "save", id, post }, { action: "remove", id, url: post.url }]) {
    assert.throws(() => changeBookmarks("bob", action as Parameters<typeof changeBookmarks>[1]));
  }
  assert.throws(() => changeBookmarks("alice", { action: "create", name: "学习" }));
  folders = changeBookmarks("alice", { action: "create", name: "稍后阅读", post });
  const other = folders[1].id;
  changeBookmarks("alice", { action: "rename", id, name: "知识" });
  assert.equal(listBookmarks("alice")[0].name, "知识");
  changeBookmarks("alice", { action: "remove", id, url: post.url });
  assert.equal(listBookmarks("alice")[0].posts.length, 0);
  changeBookmarks("alice", { action: "delete", id });
  assert.equal(listBookmarks("alice")[0].posts.length, 1);
  changeBookmarks("alice", { action: "delete", id: other });
  assert.deepEqual(listBookmarks("alice"), []);
});
test("reject empty names and unsafe URLs", () => {
  assert.equal(bookmarkActionSchema.safeParse({ action: "create", name: "  " }).success, false);
  for (const url of ["javascript:alert(1)", "https://evil.com/answer/34", "https://www.zhihu.com/people/test"]) {
    assert.equal(bookmarkActionSchema.safeParse({ action: "create", name: "收藏", post: { ...post, url } }).success, false);
  }
});
