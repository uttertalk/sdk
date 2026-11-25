"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AskResult, ConfirmResult, Turn } from "./types.ts";

// Hooks for a product's own screens. They talk to the product's own route
// (app/api/utter/[...path], from createUtter().handler), which signs the person in with the
// product's login and passes the request on to Utter. <Utter /> is built from these; use them
// directly for your own look.

const DEFAULT_BASE = "/api/utter";

// Sent on the page after Utter changed something, so the app can refresh what's on screen:
//   window.addEventListener("utter:changed", () => router.refresh())
export const CHANGED_EVENT = "utter:changed";

async function req<T>(base: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status}).`);
  return data;
}

/* ---- Is Utter switched on for this app? ---- */

export type UtterStatus = { live: boolean; app: string };

// null while loading, or when the person isn't signed in or Utter can't be reached.
export function useUtterStatus({ basePath = DEFAULT_BASE }: { basePath?: string } = {}) {
  const [status, setStatus] = useState<UtterStatus | null>(null);
  useEffect(() => {
    let alive = true;
    req<UtterStatus>(basePath, "/status").then(
      (s) => alive && setStatus(s),
      () => alive && setStatus(null),
    );
    return () => {
      alive = false;
    };
  }, [basePath]);
  return status;
}

/* ---- The conversation ---- */

export type UtterTurn = {
  id: number;
  role: "user" | "assistant";
  text: string;
  // Lines to show under an answer (names, numbers), or the failures after a confirm.
  list?: string[];
  // A plan waiting for a yes: the changes in plain words, and what to send back.
  confirm?: { steps: string[]; plan: string; sig: string; state: "waiting" | "confirmed" | "cancelled" };
  error?: boolean;
};

export type UtterState = "idle" | "thinking";

let nextId = 1;

export function useUtter({ basePath = DEFAULT_BASE }: { basePath?: string } = {}) {
  const [turns, setTurns] = useState<UtterTurn[]>([]);
  const [state, setState] = useState<UtterState>("idle");
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  const add = (t: Omit<UtterTurn, "id">) => {
    const turn = { ...t, id: nextId++ };
    setTurns((all) => [...all, turn]);
    return turn;
  };
  const setConfirmState = (id: number, s: "confirmed" | "cancelled") =>
    setTurns((all) => all.map((t) => (t.id === id && t.confirm ? { ...t, confirm: { ...t.confirm, state: s } } : t)));

  const pending = [...turns].reverse().find((t) => t.confirm?.state === "waiting") ?? null;

  const finish = useCallback((id: number, kind: "confirm" | "cancel") => {
    const t = turnsRef.current.find((x) => x.id === id);
    if (!t?.confirm || t.confirm.state !== "waiting") return null;
    setConfirmState(id, kind === "confirm" ? "confirmed" : "cancelled");
    return t.confirm;
  }, []);

  // Says no to the plan that's waiting, if any. Nothing changes.
  const cancel = useCallback(async (): Promise<UtterTurn | null> => {
    const waiting = [...turnsRef.current].reverse().find((t) => t.confirm?.state === "waiting");
    const c = waiting && finish(waiting.id, "cancel");
    if (!c) return null;
    try {
      const r = await req<ConfirmResult>(basePath, "/cancel", { plan: c.plan, sig: c.sig });
      return add({ role: "assistant", text: r.text });
    } catch {
      return add({ role: "assistant", text: "Okay, nothing changed." });
    }
  }, [basePath, finish]);

  // Sends what the person said or typed. A plan that was still waiting is dropped first.
  const send = useCallback(
    async (text: string): Promise<UtterTurn | null> => {
      const said = text.trim();
      if (!said) return null;
      const waiting = [...turnsRef.current].reverse().find((t) => t.confirm?.state === "waiting");
      if (waiting) {
        const c = finish(waiting.id, "cancel");
        if (c) req(basePath, "/cancel", { plan: c.plan, sig: c.sig }).catch(() => {});
      }
      const history: Turn[] = turnsRef.current
        .filter((t) => !t.error)
        .slice(-11)
        .map((t) => ({ role: t.role, text: t.text }));
      add({ role: "user", text: said });
      setState("thinking");
      try {
        const r = await req<AskResult>(basePath, "/ask", { conversation: [...history, { role: "user", text: said }] });
        if (r.kind === "confirm") {
          return add({ role: "assistant", text: r.text, confirm: { steps: r.steps, plan: r.plan, sig: r.sig, state: "waiting" } });
        }
        if (r.kind === "answer") return add({ role: "assistant", text: r.text, list: r.list?.length ? r.list : undefined });
        return add({ role: "assistant", text: r.text, error: r.kind === "error" });
      } catch (e) {
        return add({ role: "assistant", text: (e as Error).message || "Utter can't be reached right now.", error: true });
      } finally {
        setState("idle");
      }
    },
    [basePath, finish],
  );

  // Says yes to the plan that's waiting. Fires "utter:changed" when anything changed.
  const confirm = useCallback(async (): Promise<UtterTurn | null> => {
    const waiting = [...turnsRef.current].reverse().find((t) => t.confirm?.state === "waiting");
    const c = waiting && finish(waiting.id, "confirm");
    if (!c) return null;
    setState("thinking");
    try {
      const r = await req<ConfirmResult>(basePath, "/confirm", { plan: c.plan, sig: c.sig });
      if (r.kind === "answer" && (r.done ?? 0) > 0 && typeof window !== "undefined") window.dispatchEvent(new Event(CHANGED_EVENT));
      return add({
        role: "assistant",
        text: r.text,
        list: r.kind === "answer" && r.list?.length ? r.list : undefined,
        error: r.kind === "error" || (r.kind === "answer" && (r.failed ?? 0) > 0),
      });
    } catch (e) {
      return add({ role: "assistant", text: (e as Error).message || "Utter can't be reached right now.", error: true });
    } finally {
      setState("idle");
    }
  }, [basePath, finish]);

  const reset = useCallback(() => setTurns([]), []);

  return { turns, state, pending, send, confirm, cancel, reset };
}

/* ---- Listening and talking, with the browser's own speech ---- */

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// The most natural-sounding voice the browser has for the page's language.
function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0].toLowerCase();
  const same = voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  const pool = same.length ? same : voices;
  const score = (v: SpeechSynthesisVoice) =>
    (v.lang.toLowerCase() === lang.toLowerCase() ? 4 : 0) +
    (/natural|neural|online/i.test(v.name) ? 8 : 0) +
    (/google|samantha|ava|aria|jenny|daniel|karen|moira/i.test(v.name) ? 3 : 0) +
    (v.localService ? 0 : 1);
  return [...pool].sort((a, b) => score(b) - score(a))[0] ?? null;
}

export type VoiceState = "idle" | "listening" | "speaking";

export function useVoice({ lang }: { lang?: string } = {}) {
  const [canListen, setCanListen] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState("");
  const rec = useRef<Recognition | null>(null);
  const language = useRef("en-US");

  useEffect(() => {
    language.current = lang || document.documentElement.lang || navigator.language || "en-US";
    setCanListen(Boolean(recognitionClass()));
    setCanSpeak("speechSynthesis" in window);
    // Some browsers load their voices late; asking once starts that.
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices();
    return () => {
      rec.current?.abort();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [lang]);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setState((s) => (s === "speaking" ? "idle" : s));
  }, []);

  // Listens until the person stops talking. Resolves with what they said ("" for nothing).
  const listen = useCallback((): Promise<string> => {
    const R = recognitionClass();
    if (!R) return Promise.resolve("");
    stopSpeaking();
    rec.current?.abort();
    setError("");
    setInterim("");
    return new Promise((resolve) => {
      const r = new R();
      rec.current = r;
      r.lang = language.current;
      r.interimResults = true;
      r.continuous = false;
      r.maxAlternatives = 1;
      let finalText = "";
      r.onresult = (e) => {
        let live = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) finalText += res[0].transcript;
          else live += res[0].transcript;
        }
        setInterim((finalText + live).trim());
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("Allow the microphone to talk to Utter, or type instead.");
        else if (e.error !== "no-speech" && e.error !== "aborted") setError("Couldn't hear that. Try again, or type instead.");
      };
      r.onend = () => {
        if (rec.current === r) rec.current = null;
        setState((s) => (s === "listening" ? "idle" : s));
        setInterim("");
        resolve(finalText.trim());
      };
      setState("listening");
      try {
        r.start();
      } catch {
        setState("idle");
        resolve("");
      }
    });
  }, [stopSpeaking]);

  // Stops listening now; what was heard so far still comes back from listen().
  const stopListening = useCallback(() => rec.current?.stop(), []);

  // Says the text out loud. Resolves when it's done (or was stopped).
  const speak = useCallback((text: string): Promise<void> => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return Promise.resolve();
    window.speechSynthesis.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = language.current;
      const voice = pickVoice(language.current);
      if (voice) u.voice = voice;
      u.rate = 1.04;
      const done = () => {
        setState((s) => (s === "speaking" ? "idle" : s));
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      setState("speaking");
      window.speechSynthesis.speak(u);
    });
  }, []);

  return { canListen, canSpeak, state, interim, error, listen, stopListening, speak, stopSpeaking };
}

// Is a short reply a yes or a no to the plan that's waiting? null when it's something else.
export function yesOrNo(text: string): "yes" | "no" | null {
  const t = text.toLowerCase().replace(/[^a-z' ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t || t.split(" ").length > 5) return null;
  if (/^(no|nope|nah|cancel|stop|don't|do not|never mind|nevermind|wait|hold on)\b/.test(t)) return "no";
  if (/^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|confirm|please do|correct|sounds good|absolutely)\b/.test(t)) return "yes";
  return null;
}
