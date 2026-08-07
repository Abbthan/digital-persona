# English/Chinese language system — design reference

How this project implements a two-language (EN/中文) toggle: the button, the
translation mechanism, and why it uses pre-written translations instead of a
live translation API. Written to be portable to another codebase — it
describes the pattern and includes the core logic, not just a description of
this repo's files.

## The core design decision

**Every UI string has a hand-written Chinese translation baked into source
code, in one central dictionary — nothing is machine-translated at request
time.** This is the opposite of calling a translation API on the fly.

Why this over live translation:
- **Quality and tone control.** A translation API doesn't know your brand
  voice, doesn't know that a product name should never be translated, and
  produces inconsistent terminology across strings translated independently.
  A human (or an LLM, reviewed once, at write-time) writes each string
  deliberately.
- **Zero runtime cost or latency.** No network call, no API bill, no
  failure mode where the translation service is down. Translation is a
  static lookup.
- **Predictable, diffable output.** The Chinese text is real, reviewable
  source code — you can read the dictionary and see exactly what a user
  sees in either language, and change one line to fix one string.

The tradeoff: every new string needs its Chinese counterpart added by hand.
That's treated as acceptable friction, not a bug — it's what buys the
quality and control above.

## The mechanism: translate the rendered DOM, not the component code

The other unusual choice: **components are written in plain English, always,
with zero i18n-specific code** — no `t("some.key")`, no wrapping every
string. Instead, a single global component walks the *rendered DOM* after
each paint and swaps text nodes (and a few attributes) based on the current
locale.

This is a real architectural tradeoff versus traditional i18n libraries
(`react-intl`, `next-intl`, etc.):

| | DOM-walk translation (this system) | Traditional `t("key")` i18n |
|---|---|---|
| Adding a new component | Write English text normally, add one dictionary entry | Must import `t`, wrap every string, manage keys |
| Refactoring/renaming a component | No i18n code to touch | Key namespacing often ties keys to file structure |
| Dynamic/parameterized strings | Regex fallback ladder (see below) — some manual work | First-class support (ICU message format, `t("key", {name})`) |
| Discoverability of what's translated | One file, one dictionary, grep-able | Scattered across every component |
| Correctness guarantee | Runtime DOM heuristic — can miss edge cases | Compile-time/type-checked in good setups |

This system was chosen because component code stays completely undistracted
by translation concerns — you write the product, not the i18n plumbing. It's
a good fit for a small-to-mid-size app with two locales and a small team. It
would need more rigor (e.g. an actual key-based system) at larger scale.

### The dictionary and translation function

```ts
// A flat English -> Chinese map. Central, single file, grep-able.
const zh: Record<string, string> = {
  "Home": "首页",
  "Pricing": "价格",
  "Get Started": "开始使用",
  // ... every static string in the product, by exact English text
};

// Leading/trailing whitespace is preserved around the translated core so
// this is safe to run on text nodes that include incidental JSX whitespace.
function translateEnglishToChinese(value: string): string {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.slice(leading.length, value.length - trailing.length);

  const direct = zh[core];
  if (direct) return `${leading}${direct}${trailing}`;

  // Dynamic/parameterized strings can't be exact dictionary keys — each
  // gets an explicit regex + template. This list grows one entry per
  // distinct dynamic string shape in the product.
  const recordingTimer = core.match(/^Recording — (\d+)s remaining$/);
  if (recordingTimer) return `${leading}正在录制 — 剩余 ${recordingTimer[1]} 秒${trailing}`;

  const deletePersona = core.match(/^Delete (.+)\?$/);
  if (deletePersona) return `${leading}删除 ${deletePersona[1]}？${trailing}`;

  // ... one match+template per dynamic string shape

  return value; // untranslated strings (user-generated content, unmapped
                // text) pass through unchanged — never garbled, just English.
}
```

Proper nouns (the product name) are simply never added to the dictionary, so
they pass through unchanged automatically — no special-casing needed.

### Walking the DOM and staying reversible

The actual translator walks the tree with `TreeWalker`, translating text
nodes and a fixed set of attributes (`placeholder`, `aria-label`, `title`).
The one subtlety that matters: **it must always translate from the true
original English, never from whatever is currently displayed** — otherwise
toggling zh→en→zh repeatedly, or a React re-render reusing the same DOM
node, would either double-translate or lose the original.

```ts
const translatedAttributes = new Set(["placeholder", "aria-label", "title"]);
const originalTextByNode = new WeakMap<Text, string>();
const originalAttributesByElement = new WeakMap<Element, Map<string, string>>();

function translateTree(root: Node, locale: "en" | "zh") {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent || ["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"].includes(parent.tagName)) continue;

    const stored = originalTextByNode.get(node);
    // React may reuse a text node when data changes. If it has re-rendered
    // a fresh source string, record that as the new original; if the node
    // just holds our own previous Chinese output, keep the remembered
    // English source instead of treating the Chinese text as "original".
    const original = !stored || (node.data !== stored && node.data !== translateEnglishToChinese(stored))
      ? node.data
      : stored;
    originalTextByNode.set(node, original);

    const next = locale === "zh" ? translateEnglishToChinese(original) : original;
    if (next !== node.data) node.data = next;
  }

  // Same original-preserving logic for the tracked attributes on every
  // element in the subtree (including the root itself).
  if (!(root instanceof Element)) return;
  const elements = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const element of elements) {
    for (const attribute of translatedAttributes) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      let originals = originalAttributesByElement.get(element);
      if (!originals) originalAttributesByElement.set(element, (originals = new Map()));
      const stored = originals.get(attribute);
      const original = !stored || (value !== stored && value !== translateEnglishToChinese(stored)) ? value : stored;
      originals.set(attribute, original);
      const next = locale === "zh" ? translateEnglishToChinese(original) : original;
      if (next !== value) element.setAttribute(attribute, next);
    }
  }
}
```

New content mounts constantly (modals, dashboard panels) after the initial
pass, so a `MutationObserver` re-applies translation to whatever changed —
guarded by a `translating` flag so the observer doesn't react to its own
writes and loop:

```tsx
export function LocaleTextTranslator() {
  const { locale } = useLocale();

  // useLayoutEffect, not useEffect: must commit in the same paint as the
  // toggle button's own re-render, or the flag and page content visibly
  // disagree for a frame right after a locale change.
  useLayoutEffect(() => {
    let translating = false;
    const apply = (root: Node) => {
      translating = true;
      translateTree(root, locale);
      translating = false;
    };
    apply(document.body);

    const observer = new MutationObserver((mutations) => {
      if (translating) return;
      for (const mutation of mutations) {
        if (mutation.type === "characterData") apply(mutation.target);
        else for (const node of mutation.addedNodes) apply(node);
      }
    });
    observer.observe(document.body, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: [...translatedAttributes],
    });
    return () => observer.disconnect();
  }, [locale]);

  return null; // pure side-effect component, rendered once near the app root
}
```

## Locale state, persistence, and avoiding a flash of the wrong language

Three layers, from fastest/dumbest to slowest/most-authoritative:

1. **A synchronous inline `<script>` in `<head>`**, before hydration, reads
   `localStorage` (falling back to `navigator.language`) and sets attributes
   directly on `<html>` — this is what the page looks like even before any
   framework code runs, avoiding a flash of the wrong language on load:

   ```html
   <script>
   (function(){
     try {
       var s = localStorage.getItem('language-preference');
       var l = (s === 'en' || s === 'zh') ? s
             : ((navigator.language || 'en').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en');
       document.documentElement.dataset.language = l;
       document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en';
     } catch (e) {}
   })();
   </script>
   ```

2. **React state starts hard-coded to `"en"`** on the client (matching what
   the server rendered, since SSR has no `localStorage`), then corrects
   itself to the real value inside a `useLayoutEffect` reading
   `document.documentElement.dataset.language` (set by the script above).
   Using `useLayoutEffect` instead of `useEffect` matters: it flushes before
   paint, so the correction happens invisibly instead of as a visible flash.
   The one-time expected hydration mismatch this causes on the toggle
   button is silenced with `suppressHydrationWarning` rather than avoided —
   avoiding it would mean the button is wrong until a slower effect fires.

3. **A logged-in account's saved preference wins once auth resolves** —
   compared during render (not in an effect, following React's
   "you might not need an effect" guidance) against the last-synced value,
   so it applies exactly once per distinct account value and correctly
   clears again on logout.

```ts
function detectClientLocale(): SupportedLocale {
  const prepaintLocale = document.documentElement.dataset.language;
  if (isSupportedLocale(prepaintLocale)) return prepaintLocale;
  const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return isSupportedLocale(stored) ? stored : localeFromSystemLanguage(navigator.language);
}

export function LocaleProvider({ children }) {
  const { status, user } = useAuth();
  const [locale, setLocaleState] = useState<SupportedLocale>(() => "en"); // matches SSR
  const saveQueue = useRef(Promise.resolve());

  useLayoutEffect(() => {
    const detected = detectClientLocale();
    if (detected !== locale) setLocaleState(detected);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    document.documentElement.dataset.language = locale;
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  }, [locale]);

  // Account preference overrides local guess once, per distinct value —
  // not a resync on every render.
  const accountPreference = status === "authenticated" && user ? user.languagePreference : null;
  const [syncedAccountPreference, setSyncedAccountPreference] = useState(null);
  if (accountPreference !== syncedAccountPreference) {
    if (accountPreference) setLocaleState(accountPreference);
    setSyncedAccountPreference(accountPreference);
  }

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(next);
    if (status !== "authenticated") return;
    // Serialized so rapid toggles can't race each other into the DB out of order.
    saveQueue.current = saveQueue.current.catch(() => undefined).then(() =>
      fetch("/api/account/language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ languagePreference: next }),
      })
    );
  }, [status]);

  const toggleLocale = useCallback(() => setLocale(locale === "zh" ? "en" : "zh"), [locale, setLocale]);

  return <LocaleContext.Provider value={{ locale, setLocale, toggleLocale }}>{children}</LocaleContext.Provider>;
}
```

Priority order, highest wins: **logged-in account's saved preference** →
**pre-paint script's detected value** (localStorage, then browser language)
→ **hardcoded English default**.

Persistence is two-tier: `localStorage` always (works for anonymous
visitors, instant), and for logged-in users *also* a small backend endpoint
that saves onto their account row — so the choice follows them to a new
browser/device, not just the one they set it on.

## The toggle button

A small pill button showing **both** flags at once, rather than a dropdown
or two separate buttons — the active language's flag is full opacity/color,
the inactive one is dimmed (35% opacity) and grayscaled, positioned in
opposite corners to read as a physical toggle/switch:

```tsx
export function LanguageToggle() {
  const { locale, toggleLocale } = useLocale();
  const englishSelected = locale === "en";

  return (
    <motion.button
      type="button"
      onClick={toggleLocale}
      aria-label={englishSelected ? "Switch language to Chinese" : "Switch language to English"}
      suppressHydrationWarning
      whileTap={{ scale: 0.86 }}
      animate={{ scale: 1 }}
      transition={{ type: "spring", stiffness: 460, damping: 21, mass: 0.45 }}
      className="relative flex h-9 w-11 items-center justify-center overflow-hidden rounded-full"
    >
      <span className={cn(
        "pointer-events-none absolute left-[7px] top-[4px] text-[16px] transition-all duration-200",
        englishSelected ? "opacity-100 grayscale-0" : "opacity-35 grayscale",
      )}>
        🇬🇧
      </span>
      <span className={cn(
        "pointer-events-none absolute bottom-[4px] right-[6px] text-[16px] transition-all duration-200",
        englishSelected ? "opacity-35 grayscale" : "opacity-100 grayscale-0",
      )}>
        🇨🇳
      </span>
    </motion.button>
  );
}
```

Design notes:
- Flag emoji, not text labels or a country-flag icon library — zero asset
  loading, renders natively, universally recognized for language switches
  despite the well-known imperfect flag↔language mapping (a pragmatic
  tradeoff, not a statement).
- One click toggles immediately (optimistic — the UI flips before any
  network persistence finishes), since there are only two locales. A
  dropdown/menu would be the right call for 3+ languages.
- Spring tap animation (`whileTap`) via Framer Motion gives physical
  press-feedback consistent with the rest of the product's interaction
  language, rather than a flat instant state change.

## Wiring it together

```tsx
// Somewhere near the app root, once:
<LocaleProvider>
  <LocaleTextTranslator />  {/* renders null; pure side effect */}
  {/* rest of the app, including <LanguageToggle /> wherever it belongs in the UI */}
</LocaleProvider>
```

```ts
// back_end/api/account/language/route.ts — persists a logged-in user's choice
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ ok: false, error: "Not logged in." }, { status: 401 });

  const { languagePreference } = await request.json();
  if (languagePreference !== "en" && languagePreference !== "zh") {
    return NextResponse.json({ ok: false, error: "Choose English or Chinese." }, { status: 400 });
  }

  await db.user.update({ where: { id: session.userId }, data: { languagePreference } });
  return NextResponse.json({ ok: true, languagePreference });
}
```

## Porting this to a new project — checklist

1. Define `SupportedLocale` (`"en" | "zh"`, or whatever pair/set) and a
   `localeFromSystemLanguage()` helper in one shared types file.
2. Add the pre-paint inline `<script>` to the root HTML `<head>`, matching
   the localStorage key you'll use everywhere else.
3. Build `LocaleProvider`/`useLocale`: SSR-safe default state, a
   `useLayoutEffect` correction pass, `localStorage` persistence, and
   (if there's an account system) a render-time sync from the logged-in
   user's saved preference.
4. Build `LocaleTextTranslator`: start the dictionary empty, add entries as
   you write each new string in the actual product (never pre-translate
   speculatively). Add regex fallback templates only for strings that
   actually turn out to have embedded dynamic values.
5. Build the toggle button using whatever visual language fits — the
   flag-pill pattern above is one option, not a requirement of the system.
6. If there's a backend/accounts system, add the persistence endpoint and
   the account-preference sync step; skip both for a purely client-side app.
7. As the product grows, budget real time for dictionary upkeep — every
   new string needs a hand-written translation before it'll actually
   appear translated. Nothing enforces this at compile time in this
   design; an untranslated string just silently stays in English, which
   is the deliberately safe failure mode.
