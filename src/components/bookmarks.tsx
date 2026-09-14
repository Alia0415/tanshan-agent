"use client";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bookmark, ArrowRight, Folder, ChevronRight, Link2, ArrowUpRight, ArrowLeft } from "lucide-react";
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
export function BookmarkButton({ post, corner = false }: { post: BookmarkPost; corner?: boolean }) {
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
    <button className={`${styles.button} ${corner ? styles.corner : ""}`} type="button" aria-label={saved ? "管理帖子收藏" : "收藏帖子"} aria-haspopup="dialog" onClick={() => { dialog.current?.showModal(); if (!state.ready) void state.refresh(); }}>{saved ? "★ 已收藏" : "☆ 收藏"}</button>
    <dialog ref={dialog} className={styles.dialog} aria-label="收藏到收藏夹">
      <div className={styles.heading}><h2>收藏到收藏夹</h2><button type="button" className={styles.button} onClick={() => dialog.current?.close()}>关闭</button></div>
      {(error || state.error) && <p role="alert">{error || state.error} <button type="button" onClick={() => void state.refresh()}>重试加载</button></p>}
      {!state.ready && !state.error && <p role="status">正在加载收藏夹…</p>}
      {state.folders.map(folder => { const checked = folder.posts.some(p => p.url === url); return <label className={styles.folder} key={folder.id}><input type="checkbox" checked={checked} disabled={busy} onChange={() => void act(checked ? { action: "remove", id: folder.id, url } : { action: "save", id: folder.id, post })} /><span>{folder.name}</span><small>{folder.posts.length} 篇</small></label>; })}
      <form className={styles.form} onSubmit={e => { e.preventDefault(); void act({ action: "create", name, post }); }}><input aria-label="新收藏夹名称" placeholder="新收藏夹名称" maxLength={40} value={name} onChange={e => setName(e.target.value)} /><button className={styles.button} disabled={busy || !state.ready || !name.trim()}>新建收藏夹</button></form>
    </dialog>
  </>;
}
export function BookmarkManager() {
  const state = useBookmarks();
  const [selected, setSelected] = useState<string | null>(null);
  const folder = state.folders.find(item => item.id === selected);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(selected);
  useEffect(() => {
    if (previous.current !== selected) heading.current?.focus();
    previous.current = selected;
  }, [selected]);
  return <section className={styles.page}>
    {folder && <button className={styles.back} type="button" onClick={() => setSelected(null)}><ArrowLeft size={15} aria-hidden="true" />返回收藏夹</button>}
    <h1 ref={heading} tabIndex={-1}>{folder ? folder.name : "我的收藏"}</h1>
    {state.error && <p role="alert">{state.error} <button type="button" onClick={() => void state.refresh()}>重试</button></p>}
    {!state.ready && !state.error && <p role="status">正在加载…</p>}
    {state.ready && !folder && <>
      {state.folders.length === 0 && <p className={styles.muted}>暂无收藏夹</p>}
      <ul className={styles.folderList} aria-label="收藏夹">
        {state.folders.map(item => <li key={item.id}>
          <button type="button" className={styles.folderName} onClick={() => setSelected(item.id)}><Folder size={19} className={styles.folderIcon} aria-hidden="true" /><span>{item.name}</span><ChevronRight size={16} className={styles.rowArrow} aria-hidden="true" /></button>
        </li>)}
      </ul>
    </>}
    {folder && <>
      {folder.posts.length === 0 && <p className={styles.muted}>暂无收藏帖子</p>}
      <ul className={styles.linkList} aria-label="收藏的帖子">
        {folder.posts.map(post => <li key={post.url}>
          <a href={post.url} target="_blank" rel="noopener noreferrer">
            <span className={styles.linkTitle}>{post.title}<ArrowUpRight size={15} aria-hidden="true" /></span>
            <span className={styles.linkUrl}><Link2 size={13} aria-hidden="true" /><span>{post.url}</span></span>
          </a>
        </li>)}
      </ul>
    </>}
  </section>;
}
const subscribeMounted = () => () => {};
export function BookmarkLibraryButton() {
  const mounted = useSyncExternalStore(subscribeMounted, () => true, () => false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const open = () => dialog.current?.showModal();
    if (new URLSearchParams(window.location.search).get("bookmarks") === "1") open();
    window.addEventListener("wenshan:open-bookmarks", open);
    return () => window.removeEventListener("wenshan:open-bookmarks", open);
  }, [mounted]);
  return <>
    <button type="button" className="side-user" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
      <Bookmark size={20} aria-hidden="true" style={{ marginLeft: 0, color: "#056de8" }} />
      <span className="side-user-name">我的收藏</span><ArrowRight size={15} aria-hidden="true" />
    </button>
    {mounted && createPortal(<dialog ref={dialog} className={styles.library} aria-label="我的收藏" onClose={() => {
      const url = new URL(window.location.href);
      if (url.searchParams.has("bookmarks")) { url.searchParams.delete("bookmarks"); window.history.replaceState(null, "", url); }
    }}>
      <button type="button" className={`${styles.button} ${styles.close}`} onClick={() => dialog.current?.close()}>关闭</button>
      <BookmarkManager />
    </dialog>, document.body)}
  </>;
}
