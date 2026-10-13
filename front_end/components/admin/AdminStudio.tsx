"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useLocale } from "@/front_end/state/locale-context";
import { WEBSITE_TEXT_CATALOG } from "@/front_end/components/providers/LocaleTextTranslator";
import { parseSiteContent, type SiteContent } from "@/shared/site-content";
import {
  GitHubEditor,
  CONTENT_PATH,
  REPOSITORY,
  toBase64,
  imagePath,
  type RepositoryFile,
  type LoadedFile,
  type Commit,
  type BuildCheck,
} from "./github";
import styles from "./studio.module.css";

type View = "text" | "images" | "source";
const mimeFor = (path: string) =>
  /\.png$/.test(path)
    ? "image/png"
    : /\.webp$/.test(path)
      ? "image/webp"
      : "image/jpeg";
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "Request failed. Please try again.";

export function AdminStudio() {
  const { locale, toggleLocale } = useLocale();
  const t = (en: string, zh: string) => (locale === "zh" ? zh : en);
  const editor = useRef<GitHubEditor | null>(null);
  const [key, setKey] = useState("");
  const [user, setUser] = useState("");
  const [view, setView] = useState<View>("text");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<RepositoryFile[]>([]);
  const [content, setContent] = useState<SiteContent>({ version: 1, text: {} });
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [source, setSource] = useState("Frequently asked questions.");
  const [search, setSearch] = useState("");
  const [path, setPath] = useState("front_end/pages/FaqPage.tsx");
  const [code, setCode] = useState<LoadedFile | null>(null);
  const [draft, setDraft] = useState("");
  const [picturePath, setPicturePath] = useState(
    "public/images/ethan-ma-founder.png",
  );
  const [picture, setPicture] = useState<{
    sha: string;
    base64: string;
  } | null>(null);
  const [replacement, setReplacement] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState("");
  const [commit, setCommit] = useState<Commit | null>(null);
  const [checks, setChecks] = useState<BuildCheck[]>([]);
  const [checkError, setCheckError] = useState("");
  const [published, setPublished] = useState("");
  const contentDirty =
    !!loaded &&
    JSON.stringify(content) !==
      JSON.stringify(parseSiteContent(JSON.parse(loaded.text)));
  const codeDirty = !!code && code.text !== draft;
  const dirty = contentDirty || codeDirty || replacement !== null;
  const currentDirty =
    view === "text"
      ? contentDirty
      : view === "source"
        ? codeDirty
        : replacement !== null;
  const values = content.text[source] ?? {
    en: source,
    zh: WEBSITE_TEXT_CATALOG[source] ?? source,
  };
  const sources = [
    ...new Set([
      ...Object.keys(WEBSITE_TEXT_CATALOG),
      ...Object.keys(content.text),
    ]),
  ];

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => () => editor.current?.clear(), []);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const next = new GitHubEditor(key);
    try {
      const login = await next.connect();
      const [tree, text] = await Promise.all([
        next.listFiles(),
        next.loadText(CONTENT_PATH),
      ]);
      const parsed = parseSiteContent(JSON.parse(text.text));
      editor.current?.clear();
      editor.current = next;
      setUser(login);
      setKey("");
      setFiles(tree);
      setLoaded(text);
      setContent(parsed);
    } catch (caught) {
      next.clear();
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }

  async function loadSource(nextPath: string) {
    if (!editor.current || busy) return;
    if (
      codeDirty &&
      !window.confirm(
        t("Discard the current source draft?", "放弃当前代码草稿？"),
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const file = await editor.current.loadText(nextPath);
      setPath(nextPath);
      setCode(file);
      setDraft(file.text);
      setReview(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  async function loadPicture(nextPath: string) {
    if (!editor.current || busy) return;
    if (
      replacement &&
      !window.confirm(
        t("Discard the selected replacement?", "放弃当前替换图片？"),
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const file = await editor.current.loadImage(nextPath);
      setPicturePath(nextPath);
      setPicture(file);
      setReplacement(null);
      setReview(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  function switchView(next: View) {
    setView(next);
    setReview(false);
    setError("");
    if (next === "source" && !code) void loadSource(path);
    if (next === "images" && !picture) void loadPicture(picturePath);
  }
  function changeText(language: "en" | "zh", value: string) {
    setContent((current) => ({
      ...current,
      text: { ...current.text, [source]: { ...values, [language]: value } },
    }));
    setReview(false);
  }
  async function choosePicture(file?: File) {
    if (!file || !picture || busy) return;
    setBusy(true);
    setError("");
    setReplacement(null);
    try {
      if (file.type !== mimeFor(picturePath) || file.size > 5 * 1024 * 1024)
        throw new Error(
          t(
            "Use the same image format, up to 5 MB.",
            "请使用相同图片格式，最大 5 MB。",
          ),
        );
      const originalBlob = await (
        await fetch(`data:${mimeFor(picturePath)};base64,${picture.base64}`)
      ).blob();
      const original = await createImageBitmap(originalBlob);
      try {
        const next = await createImageBitmap(file);
        try {
          if (original.width !== next.width || original.height !== next.height)
            throw new Error(
              t(
                `Keep the original canvas: ${original.width} × ${original.height}.`,
                `请保持原始尺寸：${original.width} × ${original.height}。`,
              ),
            );
        } finally {
          next.close();
        }
      } finally {
        original.close();
      }
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === "string"
            ? resolve(reader.result.split(",")[1])
            : reject(new Error("Unable to read image."));
        reader.onerror = () => reject(new Error("Unable to read image."));
        reader.readAsDataURL(file);
      });
      setReplacement(base64);
      setReview(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  async function refreshChecks(nextCommit = commit) {
    if (!editor.current || !nextCommit) return;
    setCheckError("");
    try {
      setChecks(await editor.current.checks(nextCommit.sha));
    } catch (caught) {
      setCheckError(errorText(caught));
    }
  }
  async function publish() {
    if (!editor.current || !currentDirty || busy || !message.trim()) return;
    setBusy(true);
    setError("");
    try {
      const filePath =
        view === "text" ? CONTENT_PATH : view === "source" ? path : picturePath;
      const body =
        view === "text"
          ? JSON.stringify(parseSiteContent(content), null, 2) + "\n"
          : draft;
      // Reloading after committing could fail. Confirm the commit first, then
      // keep that result visible and stop edits until the file has reloaded.
      const result = await editor.current.publish(
        filePath,
        view === "images" ? replacement! : toBase64(body),
        view === "text"
          ? loaded!.sha
          : view === "source"
            ? code!.sha
            : picture!.sha,
        message,
      );
      setCommit(result);
      setPublished(filePath);
      setChecks([]);
      setReview(false);
      if (view === "text") {
        setLoaded(null);
        setLoaded(await editor.current.loadText(CONTENT_PATH));
      } else if (view === "source") {
        setCode(null);
        const file = await editor.current.loadText(path);
        setCode(file);
        setDraft(file.text);
      } else {
        setReplacement(null);
        setPicture(null);
        setPicture(await editor.current.loadImage(picturePath));
      }
      await refreshChecks(result);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  function disconnect() {
    if (
      dirty &&
      !window.confirm(
        t("Discard unsaved drafts and disconnect?", "放弃未保存的草稿并退出？"),
      )
    )
      return;
    editor.current?.clear();
    editor.current = null;
    setUser("");
    setKey("");
    setLoaded(null);
    setCode(null);
    setDraft("");
    setPicture(null);
    setReplacement(null);
    setCommit(null);
    setReview(false);
    setError("");
    setFiles([]);
  }
  const names = {
    text: t("Website text", "网站文字"),
    images: t("Public images", "公共图片"),
    source: t("Page source", "页面代码"),
  };
  return (
    <main className={styles.studio} data-no-translate>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          ECHO <span>WEBSITE STUDIO / 网站后台</span>
        </Link>
        <div>
          <button onClick={toggleLocale}>
            {locale === "zh" ? "English" : "中文"}
          </button>
          <Link href="/" target="_blank" rel="noreferrer">
            {t("View website ↗", "查看网站 ↗")}
          </Link>
        </div>
      </header>
      {!user ? (
        <div className={styles.login}>
          <section>
            <p className={styles.eyebrow}>WORDS. IMAGES. EVERY REVISION.</p>
            <h1>
              {t("A space to shape", "让每次修改")}
              <br />
              <em>{t("the next ECHO.", "都有回响。")}</em>
            </h1>
            <p>
              {t(
                "Edit your website in one place. Publish to GitHub, follow the build, and see your changes on the domain.",
                "在此修改网站内容。发布到 GitHub，查看构建进度，并在域名上看到更新。",
              )}
            </p>
            <div className={styles.flow}>
              GitHub commit <span>→</span> Cloudflare build <span>→</span>{" "}
              echodigitalpersona.com
            </div>
          </section>
          <form className={styles.loginCard} onSubmit={connect}>
            <p className={styles.eyebrow}>{t("EDITOR ACCESS", "编辑权限")}</p>
            <h2>{t("Connect GitHub", "连接 GitHub")}</h2>
            <p>
              {t(
                "Use a dedicated key with write access to Abbthan/digital-persona.",
                "使用有 Abbthan/digital-persona 编辑权限的专用密钥。",
              )}
            </p>
            <label htmlFor="editor-key">
              {t("GitHub access key", "GitHub 访问密钥")}
            </label>
            <input
              id="editor-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
            />
            <button className={styles.primary} disabled={busy || !key.trim()}>
              {busy
                ? t("Connecting…", "正在连接…")
                : t("Open studio →", "进入后台 →")}
            </button>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <details>
              <summary>{t("How to get access", "如何获得编辑权限")}</summary>
              <p>
                {t(
                  "Create a fine-grained token for this repository with Contents: Read and write, and Checks: Read. Your account must have repository write access.",
                  "创建仅限此仓库的细粒度 token，设置 Contents：读写，Checks：读取。您的账号必须有仓库编辑权限。",
                )}
              </p>
              <a
                href="https://github.com/settings/personal-access-tokens"
                target="_blank"
                rel="noreferrer"
              >
                GitHub token settings ↗
              </a>
            </details>
            <p className={styles.note}>
              {t(
                "Your key is held only in this tab’s memory and sent only to GitHub. Closing or refreshing the tab requires reconnecting.",
                "密钥仅保存在当前页面内存中，仅发送至 GitHub。关闭或刷新后需要重新连接。",
              )}
            </p>
          </form>
        </div>
      ) : (
        <div className={styles.workspace}>
          <aside className={styles.sidebar}>
            <p className={styles.eyebrow}>EDIT & PUBLISH</p>
            <nav>
              {(["text", "images", "source"] as View[]).map((item, i) => (
                <button
                  key={item}
                  aria-pressed={view === item}
                  disabled={busy}
                  onClick={() => switchView(item)}
                >
                  <small>0{i + 1}</small>
                  {names[item]}
                </button>
              ))}
            </nav>
            <div className={styles.account}>
              <strong>{user}</strong>
              <small>{REPOSITORY} · main</small>
              <button onClick={disconnect} disabled={busy}>
                {t("Disconnect", "退出连接")}
              </button>
            </div>
          </aside>
          <section className={styles.editor}>
            <div className={styles.toolbar}>
              <div>
                <p className={styles.eyebrow}>EVERY CHANGE HAS A HISTORY</p>
                <h1>{names[view]}</h1>
              </div>
              <button
                className={styles.primary}
                disabled={busy || !currentDirty}
                onClick={() => {
                  setReview(true);
                  setMessage(
                    `Update ${view === "text" ? "website text" : view === "source" ? path : picturePath} from ECHO studio`,
                  );
                }}
              >
                {t("Review & publish →", "检查并发布 →")}
              </button>
            </div>
            {commit && (
              <div className={styles.status} role="status">
                <strong>
                  {t(
                    "Committed to GitHub; deployment is separate.",
                    "已提交至 GitHub；部署状态请单独确认。",
                  )}
                </strong>
                <p>
                  {published} ·{" "}
                  <a href={commit.url} target="_blank" rel="noreferrer">
                    {commit.sha.slice(0, 7)} ↗
                  </a>
                </p>
                {checks.length ? (
                  checks.map((check, i) => (
                    <p key={i}>
                      {check.name}: {check.conclusion ?? check.status}{" "}
                      {check.url && (
                        <a href={check.url} target="_blank" rel="noreferrer">
                          ↗
                        </a>
                      )}
                    </p>
                  ))
                ) : (
                  <p>
                    {t("No build check is visible yet.", "暂未显示构建状态。")}
                  </p>
                )}
                {checkError && <p>{checkError}</p>}
                <button onClick={() => void refreshChecks()} disabled={busy}>
                  {t("Refresh build status", "刷新构建状态")}
                </button>
              </div>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            {view === "text" && (
              <div className={styles.textEditor}>
                <div className={styles.textList}>
                  <label htmlFor="text-search">
                    {t("Find text", "搜索文字")}
                  </label>
                  <input
                    id="text-search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    type="search"
                  />
                  <div>
                    {sources
                      .filter((item) =>
                        `${item} ${WEBSITE_TEXT_CATALOG[item] ?? ""}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      )
                      .map((item) => (
                        <button
                          key={item}
                          title={item}
                          aria-pressed={source === item}
                          onClick={() => {
                            setSource(item);
                            setReview(false);
                          }}
                        >
                          {item}
                        </button>
                      ))}
                  </div>
                </div>
                <div>
                  <h2>{t("English & Chinese", "英文与中文")}</h2>
                  <p className={styles.note}>
                    {t(
                      "These overrides apply to public website copy. User conversations and uploads stay separate.",
                      "以下文案仅用于公共网站，不影响用户对话与上传内容。",
                    )}
                  </p>
                  <label htmlFor="text-en">English</label>
                  <textarea
                    id="text-en"
                    disabled={busy || !loaded}
                    rows={6}
                    value={values.en}
                    onChange={(e) => changeText("en", e.target.value)}
                  />
                  <label htmlFor="text-zh">中文</label>
                  <textarea
                    id="text-zh"
                    disabled={busy || !loaded}
                    rows={6}
                    value={values.zh}
                    onChange={(e) => changeText("zh", e.target.value)}
                  />
                  <button
                    disabled={busy || !Object.hasOwn(content.text, source)}
                    onClick={() => {
                      setContent((current) => {
                        const text = { ...current.text };
                        delete text[source];
                        return { ...current, text };
                      });
                      setReview(false);
                    }}
                  >
                    {t("Restore original text", "还原原始文字")}
                  </button>
                </div>
              </div>
            )}
            {view === "source" && (
              <div>
                <label htmlFor="source-file">
                  {t("Existing public page file", "公共页面文件")}
                </label>
                <select
                  id="source-file"
                  value={path}
                  disabled={busy}
                  onChange={(e) => void loadSource(e.target.value)}
                >
                  {files
                    .filter(
                      (file) =>
                        !imagePath(file.path) && file.path !== CONTENT_PATH,
                    )
                    .map((file) => (
                      <option key={file.path}>{file.path}</option>
                    ))}
                </select>
                <p className={styles.note}>
                  {t(
                    "Source edits must pass the Cloudflare build. Authentication, private data, GPU services and deployment credentials are outside this editor.",
                    "代码修改必须通过 Cloudflare 构建。此编辑器无法修改身份验证、私人数据、GPU 服务或部署凭据。",
                  )}
                </p>
                <textarea
                  aria-label={t("Source code", "源代码")}
                  className={styles.code}
                  rows={22}
                  value={draft}
                  disabled={!code || busy}
                  spellCheck={false}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setReview(false);
                  }}
                />
                <button disabled={busy} onClick={() => void loadSource(path)}>
                  {t("Reload file", "重新加载文件")}
                </button>
              </div>
            )}
            {view === "images" && (
              <div>
                <label htmlFor="image-file">
                  {t("Existing public image", "公共图片文件")}
                </label>
                <select
                  id="image-file"
                  value={picturePath}
                  disabled={busy}
                  onChange={(e) => void loadPicture(e.target.value)}
                >
                  {files
                    .filter((file) => imagePath(file.path))
                    .map((file) => (
                      <option key={file.path}>{file.path}</option>
                    ))}
                </select>
                <div className={styles.images}>
                  {[picture?.base64, replacement].map((base64, i) => (
                    <figure key={i}>
                      <figcaption>
                        {i === 0
                          ? t("Current repository image", "仓库现有图片")
                          : t("Replacement draft", "替换草稿")}
                      </figcaption>
                      <div>
                        {base64 ? (
                          <Image
                            src={`data:${mimeFor(picturePath)};base64,${base64}`}
                            width={1200}
                            height={1200}
                            unoptimized
                            style={{ width: 'auto', height: 'auto' }}
                            alt={
                              i === 0
                                ? "Current public artwork"
                                : "Replacement preview"
                            }
                          />
                        ) : (
                          <span>{t("No image loaded", "尚未加载图片")}</span>
                        )}
                      </div>
                    </figure>
                  ))}
                </div>
                <label htmlFor="replacement-image">
                  {t("Choose replacement", "选择替换图片")}
                </label>
                <input
                  id="replacement-image"
                  type="file"
                  accept={mimeFor(picturePath)}
                  disabled={!picture || busy}
                  onChange={(e) => void choosePicture(e.target.files?.[0])}
                />
                <p className={styles.note}>
                  {t(
                    "Keep the original format and dimensions. Maximum 5 MB. Private persona media is not listed here.",
                    "保持原始格式与尺寸，最大 5 MB。此处不会列出私人数字人素材。",
                  )}
                </p>
                <button
                  disabled={busy}
                  onClick={() => void loadPicture(picturePath)}
                >
                  {t("Reload image", "重新加载图片")}
                </button>
              </div>
            )}
            {review && (
              <section className={styles.review}>
                <p className={styles.eyebrow}>REVIEW YOUR CHANGE</p>
                <h2>{t("Publish this revision?", "发布此次修改？")}</h2>
                <p>
                  {view === "text"
                    ? CONTENT_PATH
                    : view === "source"
                      ? path
                      : picturePath}
                </p>
                <p>
                  {t(
                    "One commit goes to main. The connected Cloudflare build must succeed before the live website changes. Concurrent edits are rejected rather than overwritten.",
                    "本次将向 main 提交一个版本。Cloudflare 构建成功后网站才会更新。并发修改将被拒绝，不会被覆盖。",
                  )}
                </p>
                <label htmlFor="commit-message">
                  {t("Change description", "更新说明")}
                </label>
                <input
                  id="commit-message"
                  maxLength={200}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
                <div>
                  <button disabled={busy} onClick={() => setReview(false)}>
                    {t("Cancel", "取消")}
                  </button>
                  <button
                    className={styles.primary}
                    disabled={busy || !message.trim() || !currentDirty}
                    onClick={() => void publish()}
                  >
                    {busy
                      ? t("Publishing…", "正在发布…")
                      : t("Confirm publish →", "确认发布 →")}
                  </button>
                </div>
              </section>
            )}
          </section>
        </div>
      )}
      <footer className={styles.footer}>
        ECHO 回响{" "}
        <span>
          {t(
            "Repository access · Version history · Build verification",
            "仓库权限 · 版本记录 · 构建验证",
          )}
        </span>
      </footer>
    </main>
  );
}
