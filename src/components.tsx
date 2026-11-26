"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLook, useUtter, useUtterStatus, useVoice, yesOrNo, type UtterTurn } from "./hooks.tsx";
import { keepUtterLook } from "./look.ts";

// <Utter />: a floating mic button that opens a small panel. People press the mic (or type),
// Utter does it inside the app or answers, and says the reply out loud. Changes wait for a yes,
// by voice or the button. Hidden until the owner switches Utter on in the dashboard.
// People can also change how the app looks for themselves ("make it dark", "bigger text"), unless the
// company switched that off in the dashboard.
//
// Every element has a utter- class, and the colours come from CSS variables you can set on any parent
// (the defaults are fallbacks, so yours always win):
//   --utter-accent, --utter-accent-ink, --utter-bg, --utter-ink, --utter-muted, --utter-line, --utter-soft

export type UtterProps = {
  // Your app's name, shown at the top of the panel. Defaults to the name in your action list.
  app?: string;
  // Two or three things people could say, shown before the first message.
  examples?: string[];
  position?: "bottom-right" | "bottom-left";
  // false: never speak replies (they're still shown). People can also mute it in the panel.
  voice?: boolean;
  // Where your Utter route is, if not /api/utter.
  basePath?: string;
  // Language for listening and speaking, like "en-US". Defaults to the page's language.
  lang?: string;
};

const MUTE_KEY = "utter:muted";

export function Utter({ app, examples = [], position = "bottom-right", voice = true, basePath, lang }: UtterProps) {
  const status = useUtterStatus({ basePath });
  useLook({ basePath, enabled: status ? Boolean(status.live && status.looks) : undefined });
  const u = useUtter({ basePath, page: Boolean(status?.live && status.looks) });
  const v = useVoice({ lang });
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [muted, setMuted] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const spoken = useRef(0);

  useEffect(() => {
    try {
      setMuted(localStorage.getItem(MUTE_KEY) === "1");
    } catch {
      // Storage blocked: start unmuted.
    }
  }, []);

  // The button keeps its own colours under a dark look, also after it first shows up.
  useEffect(keepUtterLook, [status?.live, open]);

  // Keeps the newest message in view.
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [u.turns.length, u.state, v.interim]);

  // Says each new reply out loud, once.
  const last = u.turns[u.turns.length - 1];
  useEffect(() => {
    if (!last || last.role !== "assistant" || last.id === spoken.current) return;
    spoken.current = last.id;
    if (open && voice && !muted && v.canSpeak) void v.speak(last.text);
  }, [last, open, voice, muted, v]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!status?.live) return null;
  const name = app || status.app;
  const busy = u.state === "thinking";
  const orbState = v.state === "listening" ? "listening" : v.state === "speaking" ? "speaking" : busy ? "thinking" : "idle";

  function close() {
    v.stopSpeaking();
    v.stopListening();
    setOpen(false);
  }

  // A short "yes" or "no" answers the plan that's waiting; anything else is a new request.
  async function say(said: string) {
    const t = said.trim();
    if (!t || busy) return;
    const answer = u.pending ? yesOrNo(t) : null;
    if (answer === "yes") return void (await u.confirm());
    if (answer === "no") return void (await u.cancel());
    await u.send(t);
  }

  async function onMic() {
    if (v.state === "listening") return v.stopListening();
    const heard = await v.listen();
    if (heard) await say(heard);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const t = text;
    setText("");
    void say(t);
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    if (next) v.stopSpeaking();
    try {
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  }

  return (
    <div className={`utter utter-${position}`}>
      <style>{CSS}</style>
      {open && (
        <div className="utter-panel" role="dialog" aria-label={`Talk to ${name}`}>
          <div className="utter-head">
            <span className="utter-title">
              <Orb state={orbState} size={18} />
              {name}
            </span>
            <span className="utter-head-buttons">
              {voice && v.canSpeak && (
                <button type="button" className="utter-icon" onClick={toggleMute} aria-label={muted ? "Turn voice on" : "Mute voice"} title={muted ? "Turn voice on" : "Mute voice"}>
                  {muted ? <IconMuted /> : <IconSound />}
                </button>
              )}
              <button type="button" className="utter-icon" onClick={close} aria-label="Close" title="Close">
                <IconClose />
              </button>
            </span>
          </div>

          <div className="utter-list" ref={list} aria-live="polite">
            {u.turns.length === 0 && (
              <div className="utter-empty">
                <p className="utter-hello">{v.canListen ? "Press the mic and say what you need, or type it." : "Type what you need."}</p>
                {examples.length > 0 && (
                  <div className="utter-examples">
                    {examples.slice(0, 3).map((ex) => (
                      <button key={ex} type="button" className="utter-example" onClick={() => void say(ex)}>
                        {ex}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {u.turns.map((t) => (
              <Message key={t.id} turn={t} busy={busy} onYes={() => void u.confirm()} onNo={() => void u.cancel()} />
            ))}
            {v.interim && <div className="utter-msg utter-user utter-interim">{v.interim}</div>}
            {busy && (
              <div className="utter-msg utter-assistant utter-dots" aria-label="Working">
                <i />
                <i />
                <i />
              </div>
            )}
          </div>

          {v.error && <p className="utter-error-line">{v.error}</p>}
          <form className="utter-input" onSubmit={onSubmit}>
            {v.canListen && (
              <button
                type="button"
                className={`utter-mic${v.state === "listening" ? " utter-mic-on" : ""}`}
                onClick={() => void onMic()}
                disabled={busy}
                aria-label={v.state === "listening" ? "Stop listening" : "Talk"}
                title={v.state === "listening" ? "Stop listening" : "Talk"}
              >
                <IconMic />
              </button>
            )}
            <input
              ref={input}
              className="utter-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={v.state === "listening" ? "Listening…" : u.pending ? "Say yes or no, or ask something else" : "Type a request"}
              aria-label="Type a request"
              disabled={v.state === "listening"}
            />
            <button type="submit" className="utter-send" disabled={busy || !text.trim()} aria-label="Send" title="Send">
              <IconSend />
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        className="utter-launcher"
        onClick={() => (open ? close() : (setOpen(true), setTimeout(() => input.current?.focus(), 50)))}
        aria-label={open ? "Close Utter" : `Talk to ${name}`}
        aria-expanded={open}
        title={open ? "Close" : `Talk to ${name}`}
      >
        <Orb state={orbState} size={56} />
        <span className="utter-launcher-icon">{open ? <IconClose /> : <IconMic />}</span>
      </button>
    </div>
  );
}

function Message({ turn, busy, onYes, onNo }: { turn: UtterTurn; busy: boolean; onYes: () => void; onNo: () => void }) {
  const c = turn.confirm;
  return (
    <div className={`utter-msg utter-${turn.role}${turn.error ? " utter-msg-error" : ""}`}>
      <p>{turn.text}</p>
      {turn.list && (
        <ul className="utter-items">
          {turn.list.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
      {c && (
        <div className="utter-confirm">
          <ul className="utter-items">
            {c.steps.slice(0, 8).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
            {c.steps.length > 8 && <li className="utter-more">and {c.steps.length - 8} more</li>}
          </ul>
          {c.state === "waiting" ? (
            <div className="utter-confirm-buttons">
              <button type="button" className="utter-yes" onClick={onYes} disabled={busy}>
                Yes, do it
              </button>
              <button type="button" className="utter-no" onClick={onNo} disabled={busy}>
                No
              </button>
            </div>
          ) : (
            <p className="utter-confirm-state">{c.state === "confirmed" ? "Confirmed" : "Cancelled"}</p>
          )}
        </div>
      )}
    </div>
  );
}

function Orb({ state, size }: { state: string; size: number }) {
  return (
    <span className="utter-orb" data-state={state} style={{ width: size, height: size }} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

const svg = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const IconMic = () => (
  <svg {...svg}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
const IconSend = () => (
  <svg {...svg}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
const IconClose = () => (
  <svg {...svg}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
const IconSound = () => (
  <svg {...svg}>
    <path d="M4 10v4h4l5 4V6L8 10H4zM16.5 8.5a5 5 0 0 1 0 7" />
  </svg>
);
const IconMuted = () => (
  <svg {...svg}>
    <path d="M4 10v4h4l5 4V6L8 10H4zM17 9l5 6M22 9l-5 6" />
  </svg>
);

const CSS = `
.utter{position:fixed;bottom:20px;z-index:2147483000;font-family:inherit;color:var(--utter-ink,#0b0b12);display:flex;flex-direction:column;gap:12px}
.utter-bottom-right{right:20px;align-items:flex-end}.utter-bottom-left{left:20px;align-items:flex-start}
.utter *{box-sizing:border-box}
.utter button{font:inherit;cursor:pointer}
.utter button:disabled{cursor:default;opacity:.55}
.utter :focus-visible{outline:2px solid var(--utter-accent,#3341ff);outline-offset:2px}
.utter-launcher{position:relative;width:56px;height:56px;padding:0;border:0;border-radius:9999px;background:none;box-shadow:0 10px 30px -8px rgba(51,65,255,.55)}
.utter-launcher-icon{position:absolute;inset:0;display:grid;place-items:center;color:#fff}
.utter-orb{position:relative;display:block;flex-shrink:0;border-radius:9999px;overflow:hidden;isolation:isolate;background:var(--utter-accent,#3341ff);box-shadow:inset 0 -8px 20px rgba(0,0,0,.18),inset 0 8px 16px rgba(255,255,255,.45)}
.utter-orb>i{position:absolute;inset:-30%;border-radius:9999px;filter:blur(10px)}
.utter-orb>i:nth-child(1){background:radial-gradient(circle at 30% 35%,var(--utter-o1,#2b37e8),transparent 55%);animation:utter-a 9s linear infinite}
.utter-orb>i:nth-child(2){background:radial-gradient(circle at 70% 60%,var(--utter-o2,#c3c9ff),transparent 55%);animation:utter-b 11s linear infinite}
.utter-orb>i:nth-child(3){background:radial-gradient(circle at 45% 75%,var(--utter-o3,#5aa0ff),transparent 50%);animation:utter-a 7s linear infinite reverse}
.utter-orb[data-state=listening]{animation:utter-breathe .9s ease-in-out infinite}
.utter-orb[data-state=speaking]{animation:utter-talk .5s ease-in-out infinite}
.utter-orb[data-state=thinking]>i{animation-duration:2.5s}
@keyframes utter-a{to{transform:rotate(360deg)}}
@keyframes utter-b{from{transform:rotate(120deg) scale(1.1)}to{transform:rotate(-240deg) scale(1.1)}}
@keyframes utter-breathe{50%{transform:scale(1.08)}}
@keyframes utter-talk{25%{transform:scale(1.05)}60%{transform:scale(.97)}}
.utter-panel{width:min(380px,calc(100vw - 32px));height:min(540px,calc(100vh - 110px));display:flex;flex-direction:column;background:var(--utter-bg,#fff);border:1px solid var(--utter-line,#dfe2ff);border-radius:22px;box-shadow:0 24px 60px -18px rgba(11,20,82,.35);overflow:hidden}
.utter-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 12px 12px 16px;border-bottom:1px solid var(--utter-line,#dfe2ff)}
.utter-title{display:flex;align-items:center;gap:8px;font-size:15px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.utter-head-buttons{display:flex;gap:2px}
.utter-icon{display:grid;place-items:center;width:32px;height:32px;border:0;border-radius:9999px;background:none;color:var(--utter-muted,#5c5c6a)}
.utter-icon:hover{background:var(--utter-soft,#f4f4f6);color:var(--utter-ink,#0b0b12)}
.utter-list{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}
.utter-empty{margin:auto 0;display:flex;flex-direction:column;gap:12px}
.utter-hello{margin:0;font-size:14px;color:var(--utter-muted,#5c5c6a);line-height:1.5}
.utter-examples{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.utter-example{border:1px solid var(--utter-line,#dfe2ff);background:var(--utter-bg,#fff);color:var(--utter-ink,#0b0b12);border-radius:9999px;padding:7px 12px;font-size:13px;text-align:left}
.utter-example:hover{border-color:var(--utter-accent,#3341ff);color:var(--utter-accent,#3341ff)}
.utter-msg{max-width:88%;padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.45;word-wrap:break-word}
.utter-msg p{margin:0}
.utter-user{align-self:flex-end;background:var(--utter-accent,#3341ff);color:var(--utter-accent-ink,#fff);border-bottom-right-radius:6px}
.utter-assistant{align-self:flex-start;background:var(--utter-soft,#f4f4f6);border-bottom-left-radius:6px}
.utter-interim{opacity:.6}
.utter-msg-error{background:#fdeceb;color:#8a2416}
.utter-items{margin:8px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:3px;font-size:13px}
.utter-more{list-style:none;margin-left:-18px;color:var(--utter-muted,#5c5c6a)}
.utter-confirm{margin-top:6px}
.utter-confirm-buttons{display:flex;gap:6px;margin-top:10px}
.utter-yes,.utter-no{border-radius:9999px;padding:7px 14px;font-size:13px;font-weight:500}
.utter-yes{border:1px solid var(--utter-accent,#3341ff);background:var(--utter-accent,#3341ff);color:var(--utter-accent-ink,#fff)}
.utter-no{border:1px solid var(--utter-line,#dfe2ff);background:var(--utter-bg,#fff);color:var(--utter-ink,#0b0b12)}
.utter-confirm-state{margin-top:8px!important;font-size:12px;color:var(--utter-muted,#5c5c6a)}
.utter-dots{display:flex;gap:4px;padding:13px 14px}
.utter-dots i{width:6px;height:6px;border-radius:9999px;background:var(--utter-muted,#5c5c6a);animation:utter-dot 1s ease-in-out infinite}
.utter-dots i:nth-child(2){animation-delay:.15s}.utter-dots i:nth-child(3){animation-delay:.3s}
@keyframes utter-dot{0%,80%,100%{opacity:.25}40%{opacity:1}}
.utter-error-line{margin:0;padding:0 16px 8px;font-size:12px;color:#8a2416}
.utter-input{display:flex;align-items:center;gap:6px;padding:10px;border-top:1px solid var(--utter-line,#dfe2ff)}
.utter-mic,.utter-send{display:grid;place-items:center;flex-shrink:0;width:38px;height:38px;border-radius:9999px}
.utter-mic{border:1px solid var(--utter-line,#dfe2ff);background:var(--utter-bg,#fff);color:var(--utter-accent,#3341ff)}
.utter-mic:hover{border-color:var(--utter-accent,#3341ff)}
.utter-mic-on{background:var(--utter-accent,#3341ff);border-color:var(--utter-accent,#3341ff);color:var(--utter-accent-ink,#fff);animation:utter-breathe .9s ease-in-out infinite}
.utter-send{border:0;background:var(--utter-accent,#3341ff);color:var(--utter-accent-ink,#fff)}
.utter-text{flex:1;min-width:0;height:38px;padding:0 14px;border:1px solid var(--utter-line,#dfe2ff);border-radius:9999px;background:var(--utter-bg,#fff);color:var(--utter-ink,#0b0b12);font:inherit;font-size:14px}
.utter-text:focus{outline:none;border-color:var(--utter-accent,#3341ff)}
@media (prefers-reduced-motion:reduce){.utter-orb>i,.utter-orb[data-state],.utter-mic-on,.utter-dots i{animation:none}}
`;
