import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
async function load(path) {
  const output = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
}
const { GitHubEditor, editablePath, toBase64, fromBase64 } = await load(
  "front_end/components/admin/github.ts",
);
const { parseSiteContent, websiteText } = await load("shared/site-content.ts");
test("editor excludes credentials, backend services, workflows and traversal", () => {
  for (const path of [
    ".env",
    ".dev.vars",
    ".github/workflows/deploy.yml",
    "back_end/services/auth.ts",
    "gpu_services/cosyvoice_service/app.py",
    "front_end/pages/../secret.tsx",
    "front_end/pages/.hidden.tsx",
    "public/images/../../.env",
    "front_end\\pages\\Home.tsx",
    "package.json",
    "shared/pricing.ts",
    "prisma/schema.prisma",
  ])
    assert.equal(editablePath(path), false, path);
  for (const path of [
    "front_end/pages/HomePage.tsx",
    "front_end/components/marketing/home/Hero.tsx",
    "public/images/ethan-ma-founder.png",
    "shared/site-content.json",
    "ADMIN.md",
  ])
    assert.equal(editablePath(path), true, path);
});
test("UTF-8 text round-trips English, Chinese, dialect and emoji", () => {
  const text = "ECHO 回响 — 侬好 🌱\nEnglish\n中文";
  assert.equal(fromBase64(toBase64(text)), text);
});
test("original translations remain and edits support both languages and intentional blanks", () => {
  const empty = parseSiteContent({ version: 1, text: {} });
  assert.equal(
    websiteText(" Home ", "en", empty, () => " 首页 "),
    " Home ",
  );
  assert.equal(
    websiteText(" Home ", "zh", empty, () => " 首页 "),
    " 首页 ",
  );
  const content = parseSiteContent({
    version: 1,
    text: {
      Home: { en: "Our home", zh: "我们的家" },
      Hide: { en: "", zh: "" },
    },
  });
  assert.equal(
    websiteText(" Home ", "en", content, () => ""),
    " Our home ",
  );
  assert.equal(
    websiteText("Home", "zh", content, () => ""),
    "我们的家",
  );
  assert.equal(
    websiteText("Hide", "en", content, () => ""),
    "",
  );
  assert.equal(
    websiteText("constructor", "en", empty, () => ""),
    "constructor",
  );
});
test("malformed content is rejected before publishing", () => {
  for (const content of [
    null,
    { version: 2, text: {} },
    { version: 1, text: [] },
    { version: 1, text: { a: { en: 3, zh: "a" } } },
    { version: 1, text: { a: { en: "a".repeat(20001), zh: "" } } },
  ])
    assert.throws(() => parseSiteContent(content));
});
test("GitHub login requires repository write permission and sends credentials only to GitHub", async () => {
  const calls = [];
  const editor = new GitHubEditor("test-key", async function (url, options) {
    assert.equal(this, globalThis);
    calls.push({ url, options });
    return Response.json(
      url.endsWith("/user")
        ? { login: "editor" }
        : { full_name: "Abbthan/digital-persona", permissions: { push: true } },
    );
  });
  assert.equal(await editor.connect(), "editor");
  for (const { url, options } of calls) {
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, "Bearer test-key");
  }
  editor.clear();
  await assert.rejects(editor.connect(), /Connect/);
  const viewer = new GitHubEditor("key", async (url) =>
    Response.json(
      url.endsWith("/user")
        ? { login: "viewer" }
        : {
            full_name: "Abbthan/digital-persona",
            permissions: { push: false },
          },
    ),
  );
  await assert.rejects(viewer.connect(), /write access/);
});
test("publish targets main with the original file SHA for optimistic concurrency", async () => {
  const editor = new GitHubEditor("key", async (url, options) => {
    assert.equal(
      url,
      "https://api.github.com/repos/Abbthan/digital-persona/contents/shared/site-content.json",
    );
    assert.equal(options.method, "PUT");
    assert.deepEqual(JSON.parse(options.body), {
      content: toBase64("draft"),
      sha: "old-file-sha",
      branch: "main",
      message: "Update copy",
    });
    return Response.json({
      commit: {
        sha: "a".repeat(40),
        html_url:
          "https://github.com/Abbthan/digital-persona/commit/" + "a".repeat(40),
      },
    });
  });
  assert.equal(
    (
      await editor.publish(
        "shared/site-content.json",
        toBase64("draft"),
        "old-file-sha",
        "Update copy",
      )
    ).sha,
    "a".repeat(40),
  );
});
test("stale edits, expired keys and protected branches do not report publication success", async () => {
  for (const status of [401, 403, 404, 409, 422, 500]) {
    const editor = new GitHubEditor(
      "key",
      async () => new Response("", { status }),
    );
    await assert.rejects(
      editor.publish(
        "shared/site-content.json",
        toBase64("draft"),
        "old",
        "Update",
      ),
    );
  }
});
test("build check cannot invent a deployment or return unsafe links", async () => {
  const editor = new GitHubEditor("key", async () =>
    Response.json({
      check_runs: [
        {
          name: "Cloudflare",
          status: "completed",
          conclusion: "failure",
          details_url: "https://evil.example/",
        },
      ],
    }),
  );
  assert.deepEqual(await editor.checks("a".repeat(40)), [
    {
      name: "Cloudflare",
      status: "completed",
      conclusion: "failure",
      url: null,
    },
  ]);
  await assert.rejects(editor.checks("not-a-commit"));
});
test("truncated repository trees and oversized source files are rejected", async () => {
  await assert.rejects(
    new GitHubEditor("key", async () =>
      Response.json({ tree: [], truncated: true }),
    ).listFiles(),
  );
  await assert.rejects(
    new GitHubEditor("key", async () =>
      Response.json({
        type: "file",
        encoding: "base64",
        size: 900000,
        content: "",
        sha: "old",
      }),
    ).loadText("front_end/pages/HomePage.tsx"),
  );
});
