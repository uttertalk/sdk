// Types shared by the server and browser parts of utter-sdk. Safe to use anywhere.

// Who is using the product right now: their company (tenant) and themselves.
export type Viewer = { tenant: { id: string; name: string }; user: { id: string; name: string; title?: string | null } };

// One thing Utter may do in your product. Mark actions that change data with `writes: true`:
// Utter only runs those after the person said yes to a plan that lists every change.
export type ActionInfo = {
  name: string;
  description: string;
  // The arguments, like "()" or "(id: string, patch: { status?: Status })".
  args: string;
  // What it returns, like "Lead[]".
  returns: string;
  writes?: boolean;
};

// What your product tells Utter about itself: the action list.
export type Manifest = {
  app: string;
  description: string;
  // Your data as TypeScript types, so Utter understands what actions take and return.
  types: string;
  actions: ActionInfo[];
};

export type Turn = { role: "user" | "assistant"; text: string };

// What Utter answers when someone says or types something.
//   answer    done; `text` is said out loud, `list` holds a few lines to show on screen
//   question  Utter needs one more detail
//   confirm   these changes are ready; pass `plan` and `sig` back unchanged to confirm or cancel
//   error     something went wrong, in plain words
export type AskResult =
  | { kind: "answer"; text: string; list: string[] }
  | { kind: "question"; text: string }
  | { kind: "confirm"; text: string; steps: string[]; plan: string; sig: string }
  | { kind: "error"; text: string };

// After a plan was confirmed (or cancelled): what Utter says, and for a confirm how many changes
// worked and how many didn't.
export type ConfirmResult =
  | { kind: "answer"; text: string; list: string[]; done?: number; failed?: number }
  | { kind: "error"; text: string };

// One line of a company's activity log: something someone asked Utter and what came of it.
export type ActivityEntry = {
  id: string;
  at: string;
  tenant: { id: string; name: string };
  who: string;
  asked: string;
  kind: "answer" | "question" | "confirm" | "confirmed" | "cancelled" | "error";
  ok: boolean;
  reply: string | null;
  // Plain-language line, like "Made the changes, read leads.list, 3 changes made."
  summary: string;
  changes: string[];
  failed: string[];
  ms: number | null;
};
