"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { canonicalPostUrl, type BookmarkFolder, type BookmarkPost } from "@/lib/domain/bookmarks";
import styles from "./bookmarks.module.css";
type State = { folders: BookmarkFolder[]; ready: boolean; error: string; refresh: () => Promise<void>; mutate: (action: unknown) => Promise<void> };
const Context = createContext<State | null>(null);
export function BookmarkProvider({ children }: { children: ReactNode }) {
  const [folders, setFolders] = useState<BookmarkFolder[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  async function request(action?: unknown) {
    const response = await fetch("/api/bookmarks", action ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) } : { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "收藏加载失败，请重试。");
    setFolders(result.folders); setReady(true); setError("");
  }
  async function refresh() { try { await request(); } catch (e) { setError(e instanceof Error ? e.message : "收藏加载失败"); } }
  useEffect(() => { fetch("/api/bookmarks", { cache: "no-store" }).then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || "收藏加载失败"); return result; }).then(result => { setFolders(result.folders); setReady(true); }).catch(e => setError(e.message)); }, []);
  return <Context.Provider value={{ folders, ready, error, refresh, mutate: request }}>{children}</Context.Provider>;
}
function useBookmarks() { const context = useContext(Context); if (!context) throw new Error("Missing BookmarkProvider"); return context; }
export function BookmarkButton({ post }: { post: BookmarkPost }) {
  const state = useBookmarks();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const url = canonicalPostUrl(post.url);
  const saved = state.folders.some(folder => folder.posts.some(p => p.url === url));
  async function act(action: unknown) {
    setBusy(true); setError("");
    try { await state.mutate(action); setName(""); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setBusy(false); }
  }
  return <>
    <button className={styles.button} type="button" aria-label={saved ? "管理帖子收藏" : "收藏帖子"} aria-haspopup="dialog" onClick={() => { dialog.current?.showModal(); if (!state.ready) void state.refresh(); }}>{saved ? "★ 已收藏" : "☆ 收藏"}</button>
    <dialog ref={dialog} className={styles.dialog} aria-label="收藏到收藏夹">
      <div className={styles.heading}><h2>收藏到收藏夹</h2><button type="button" className={styles.button} onClick={() => dialog.current?.close()}>关闭</button></div>
      <p className={styles.muted}>{post.title}</p>
      {(error || state.error) && <p role="alert">{error || state.error} <button type="button" onClick={() => void state.refresh()}>重试加载</button></p>}
      {!state.ready && !state.error && <p role="status">正在加载收藏夹…</p>}
      {state.ready && state.folders.length === 0 && <p>还没有收藏夹，创建一个来收好这篇帖子。</p>}
      {state.folders.map(folder => { const checked = folder.posts.some(p => p.url === url); return <label className={styles.folder} key={folder.id}><input type="checkbox" checked={checked} disabled={busy} onChange={() => void act(checked ? { action: "remove", id: folder.id, url } : { action: "save", id: folder.id, post })} /><span>{folder.name}</span><small>{folder.posts.length} 篇</small></label>; })}
      <form className={styles.form} onSubmit={e => { e.preventDefault(); void act({ action: "create", name, post }); }}><input aria-label="新收藏夹名称" placeholder="新收藏夹名称" maxLength={40} value={name} onChange={e => setName(e.target.value)} /><button className={styles.button} disabled={busy || !state.ready || !name.trim()}>新建并收藏</button></form>
      <p className={styles.muted}>可加入多个收藏夹，取消勾选即可移除。</p><Link href="/bookmarks" onClick={() => dialog.current?.close()}>管理我的收藏夹 →</Link>
    </dialog>
  </>;
}
export function BookmarkManager() {
  const state = useBookmarks();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [rename, setRename] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const folder = state.folders.find(f => f.id === selected) ?? state.folders[0];
  async function act(action: unknown) {
    setBusy(true); setError("");
    try { await state.mutate(action); setName(""); setRenaming(false); setDeleting(false); } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); } finally { setBusy(false); }
  }
  return <main className={styles.page}><h1>我的收藏</h1><p className={styles.muted}>按自己的主题整理知乎帖子。收藏保存在问山，通过当前浏览器识别；更换浏览器或清除 Cookie 后无法找回，不会同步到知乎账号。</p>
    {(state.error || error) && <p role="alert">{error || state.error} <button onClick={() => void state.refresh()}>重试加载</button></p>}
    {!state.ready && !state.error && <p role="status">正在加载收藏…</p>}
    <form className={styles.form} onSubmit={e => { e.preventDefault(); void act({ action: "create", name }); }}><input aria-label="新收藏夹名称" placeholder="给新收藏夹起个名字" maxLength={40} value={name} onChange={e => setName(e.target.value)} /><button className={styles.button} disabled={busy || !state.ready || !name.trim()}>新建收藏夹</button></form>
    <div className={styles.tabs}>{state.folders.map(f => <button className={styles.button} aria-pressed={folder?.id === f.id} key={f.id} onClick={() => { setSelected(f.id); setRenaming(false); setDeleting(false); }}>{f.name} · {f.posts.length}</button>)}</div>
    {state.ready && !folder && <p>还没有收藏夹。新建一个，或在帖子旁点击“收藏”。</p>}
    {folder && <section><div className={styles.heading}><h2>{folder.name}</h2><div><button className={styles.button} disabled={busy} onClick={() => { setRename(folder.name); setRenaming(true); setDeleting(false); }}>重命名</button><button className={styles.button} disabled={busy} onClick={() => { setDeleting(true); setRenaming(false); }}>删除收藏夹</button></div></div>
      {renaming && <form className={styles.form} onSubmit={e => { e.preventDefault(); void act({ action: "rename", id: folder.id, name: rename }); }}><input aria-label="收藏夹新名称" value={rename} maxLength={40} onChange={e => setRename(e.target.value)} /><button disabled={busy || !rename.trim()}>保存</button><button type="button" onClick={() => setRenaming(false)}>取消</button></form>}
      {deleting && <div role="alert"><p>删除“{folder.name}”及其中的 {folder.posts.length} 条收藏？其他收藏夹不受影响。</p><button disabled={busy} onClick={() => void act({ action: "delete", id: folder.id })}>确认删除</button> <button onClick={() => setDeleting(false)}>取消</button></div>}
      {!folder.posts.length && <p className={styles.muted}>收藏夹还是空的，去 <Link href="/reading">阅读帖子</Link> 或 <Link href="/">搜索帖子</Link>，把感兴趣的内容收藏进来。</p>}
      {folder.posts.map(post => <article className={styles.post} key={post.url}><a href={post.url} target="_blank" rel="noreferrer"><h3>{post.title}</h3></a>{post.author && <small>{post.author}</small>}<p>{post.excerpt}</p><BookmarkButton post={post} /><button className={styles.button} disabled={busy} onClick={() => void act({ action: "remove", id: folder.id, url: post.url })}>从此收藏夹移除</button></article>)}
    </section>}
  </main>;
}
