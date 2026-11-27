// A person's own look, in the browser: the outline of the page Utter's AI writes it from, putting
// it on the page, and checking it didn't hide the Utter button. Styling only: it never touches data.

const STYLE_ID = "utter-look";
const CACHE_KEY = "utter:look";
const MAX_OUTLINE = 8000;
const MAX_LINES = 400;

// Elements whose own words are sent: headings, labels, buttons and column headers. Links only in menus
// and tabs. Never what's in table cells or form fields, so the people and records in the app stay out.
const TEXT_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "TH", "LABEL", "LEGEND", "CAPTION", "SUMMARY", "BUTTON"]);
const MENU = "nav, header, aside, [role=navigation], [role=tablist], [role=menu], [role=menubar]";
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "BR", "WBR", "SOURCE", "TRACK"]);
const LEAF = new Set(["SVG", "IMG", "VIDEO", "CANVAS", "IFRAME", "PICTURE", "INPUT", "TEXTAREA", "SELECT"]);

function ownText(el: Element): string {
  const tag = el.tagName.toUpperCase();
  const words = TEXT_TAGS.has(tag) || (tag === "A" && el.closest(MENU)) || el.getAttribute("role") === "tab";
  if (!words || el.closest("td")) return "";
  const t = (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
  return t ? ` "${t.slice(0, 40)}"` : "";
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id && el.id.length <= 40 ? `#${el.id}` : "";
  const classes = Array.from(el.classList)
    .filter((c) => c.length <= 32)
    .slice(0, 5)
    .map((c) => `.${c}`)
    .join("");
  const role = el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : "";
  const nth = tag === "th" || tag === "td" ? `:nth-child(${Array.from(el.parentElement?.children ?? []).indexOf(el) + 1})` : "";
  return `${tag}${id}${classes}${role}${nth}${ownText(el)}`;
}

const signature = (el: Element) => `${el.tagName}.${Array.from(el.classList).sort().join(".")}`;

// What's on screen, for Utter's AI to write CSS selectors against. Repeated items (rows, cards) are
// shown three times, then counted; labelled ones (menu links, column headers) are all shown. Utter's own button is left out.
export function pageOutline(): string {
  if (typeof document === "undefined") return "";
  const lines: string[] = [];
  let size = 0;
  const push = (depth: number, line: string) => {
    if (lines.length >= MAX_LINES || size >= MAX_OUTLINE) return;
    const l = `${"  ".repeat(Math.min(depth, 20))}${line}`;
    lines.push(l);
    size += l.length + 1;
  };
  const walk = (el: Element, depth: number) => {
    if (lines.length >= MAX_LINES || size >= MAX_OUTLINE) return;
    const kids = Array.from(el.children).filter(
      (k) => !SKIP.has(k.tagName.toUpperCase()) && !k.classList.contains("utter") && k.id !== STYLE_ID && k.getClientRects().length > 0,
    );
    // Labelled items (menu links, column headers, buttons) are always kept; only the rest is counted.
    const sigs = new Map(kids.map((k, i) => [k, ownText(k) ? `${signature(k)}|${i}` : signature(k)]));
    const totals = new Map<string, number>();
    for (const k of kids) totals.set(sigs.get(k)!, (totals.get(sigs.get(k)!) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const k of kids) {
      const sig = sigs.get(k)!;
      const n = (seen.get(sig) ?? 0) + 1;
      seen.set(sig, n);
      if (n > 3) continue;
      push(depth, describe(k));
      if (!LEAF.has(k.tagName.toUpperCase())) walk(k, depth + 1);
      const total = totals.get(sig) ?? 0;
      if (n === 3 && total > 3) push(depth, `(${total - 3} more like this)`);
    }
  };
  push(0, describe(document.documentElement));
  push(1, describe(document.body));
  walk(document.body, 2);
  return lines.join("\n");
}

// Puts a look on the page (or takes it off, for ""). It goes last in <head>, so it wins over the app's styles.
export function applyLook(css: string) {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
  } else {
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
    }
    el.textContent = css;
    document.head.appendChild(el);
  }
  keepUtterLook();
}

// A dark look turns the whole page around with a filter. The same filter on Utter's button turns it
// back, so the button keeps its own colours.
export function keepUtterLook() {
  if (typeof document === "undefined") return;
  const f = getComputedStyle(document.documentElement).filter;
  for (const u of Array.from(document.querySelectorAll<HTMLElement>(".utter"))) u.style.filter = /invert/.test(f) ? f : "";
}

// Whether the Utter button can still be seen and pressed, so a look can never lock someone out of
// "reset my look".
export function utterStillUsable(): boolean {
  if (typeof document === "undefined") return true;
  const b = document.querySelector<HTMLElement>(".utter-launcher");
  if (!b) return true;
  const r = b.getBoundingClientRect();
  if (r.width < 20 || r.height < 20) return false;
  if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) return false;
  for (let e: HTMLElement | null = b; e; e = e.parentElement) {
    const s = getComputedStyle(e);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) < 0.3) return false;
  }
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return Boolean(hit?.closest(".utter"));
}

// Waits until the browser has laid out the page with the new look.
export const afterPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// The last look, kept in the browser so it's there right away on the next page, before Utter answers.
export function cachedLook(): string {
  try {
    return localStorage.getItem(CACHE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function cacheLook(css: string) {
  try {
    if (css) localStorage.setItem(CACHE_KEY, css);
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // Storage blocked: the look still comes from Utter, just a moment later.
  }
}
