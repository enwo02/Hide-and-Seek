import { atom } from "nanostores";

import type { Question } from "@/maps/schema";

import {
    type Change,
    type Role,
    sharedFields,
    type SharedQuestion,
} from "./game-protocol";
import { questions, triggerLocalRefresh } from "./local-questions";

type Session = { code: string; role: Role; token: string; pin?: string };
type Pending = { change: Change; localCopy?: Question; publishKey?: number };

export const workerURL = (import.meta.env.PUBLIC_GAME_WORKER_URL || "").replace(
    /\/$/,
    "",
);
function tabState<T>(key: string, initial: T) {
    if (!workerURL) return atom(initial);
    let value = initial;
    try {
        const saved =
            typeof window !== "undefined" && window.sessionStorage.getItem(key);
        if (saved) value = JSON.parse(saved);
    } catch {
        // A restricted browser can still play until the page closes.
    }
    const state = atom(value);
    if (typeof window !== "undefined") {
        state.listen((next) => {
            try {
                window.sessionStorage.setItem(key, JSON.stringify(next));
            } catch {
                // Keep the active session in memory.
            }
        });
    }
    return state;
}

export const gameSession = tabState<Session | null>("gameSession", null);
export const pendingChanges = tabState<Pending[]>("gameOutbox", []);
export const sharedQuestions = atom<SharedQuestion[]>([]);
export const connection = atom<"connecting" | "online" | "offline" | "expired">(
    "offline",
);
export const gameError = atom("");

const baselines = new Map<string, string>();
const keys = new Map<string, number>();
let socket: WebSocket | undefined;
let reconnect: ReturnType<typeof setTimeout> | undefined;
let retry = 1000;

export async function enterGame(
    code?: string,
    role: Role = "seeker",
    pin?: string,
) {
    const response = await fetch(
        workerURL + (code === undefined ? "/games" : `/games/${code}/join`),
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role, pin }),
        },
    );
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not enter the game");
    gameSession.set({
        code: code || data.code,
        role,
        token: data.token,
        pin: code ? undefined : data.pin,
    });
    retry = 1000;
    connectGame();
}

export function leaveGame() {
    gameSession.set(null);
    clearTimeout(reconnect);
    socket?.close();
    socket = undefined;
    pendingChanges.set([]);
    sharedQuestions.set([]);
    baselines.clear();
    keys.clear();
    connection.set("offline");
    gameError.set("");
}

function applyRemote(record: SharedQuestion) {
    const current = sharedQuestions.get().find((item) => item.id === record.id);
    if (current?.version === record.version) return current;
    if (current && !isPending(current.question.key)) {
        try {
            if (fingerprint(current.question) !== baselines.get(record.id)) {
                gameError.set(
                    "Another seeker changed this question. Review the latest version and try again.",
                );
            }
        } catch {
            gameError.set(
                "A shared question changed while you were editing it.",
            );
        }
    }
    const question = structuredClone(record.question);
    let key = keys.get(record.id);
    if (key === undefined) {
        const publishKey = pendingChanges
            .get()
            .find(({ change }) => change.id === record.id)?.publishKey;
        key = publishKey ?? Math.random();
        keys.set(record.id, key);
    }
    question.key = key;
    question.data.hidden = current?.question.data.hidden ?? false;
    question.data.collapsed = current?.question.data.collapsed ?? false;
    baselines.set(record.id, fingerprint(question));
    return { ...record, question };
}

// Card keys identify local map controls. The protocol identifies questions by UUID.
function fingerprint(question: Question) {
    return JSON.stringify(wireQuestion(question));
}

function wireQuestion(question: Question) {
    return sharedFields({ ...question, key: 0 });
}

export function watchGameConnection() {
    const offline = () => {
        socket?.close();
        socket = undefined;
        clearTimeout(reconnect);
        if (connection.get() !== "expired") connection.set("offline");
    };
    const online = () => {
        if (connection.get() === "expired") return;
        clearTimeout(reconnect);
        connectGame();
    };
    connectGame();
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
        window.removeEventListener("offline", offline);
        window.removeEventListener("online", online);
    };
}

function connectGame() {
    const session = gameSession.get();
    if (!workerURL || !session || socket || !navigator.onLine) return;
    connection.set("connecting");
    const url = new URL(`${workerURL}/games/${session.code}/live`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const live = new WebSocket(url, session.token);
    socket = live;
    live.onmessage = ({ data }) => {
        if (socket !== live) return;
        const message = JSON.parse(data);
        if (message.type === "state") {
            sharedQuestions.set(
                (message.questions as SharedQuestion[]).map(applyRemote),
            );
            connection.set("online");
            retry = 1000;
            for (const item of pendingChanges.get())
                live.send(JSON.stringify(item.change));
        } else if (message.type === "update") {
            const records = sharedQuestions.get();
            const index = records.findIndex(({ id }) => id === message.id);
            if (message.question === null) {
                if (index >= 0 && !isPending(records[index].question.key)) {
                    gameError.set(
                        "A shared question was made private by another seeker.",
                    );
                }
                sharedQuestions.set(
                    records.filter(({ id }) => id !== message.id),
                );
            } else {
                const next = applyRemote(message);
                sharedQuestions.set(
                    index < 0
                        ? [...records, next]
                        : records.map((item, i) => (i === index ? next : item)),
                );
            }
        } else if (message.type === "ack" || message.type === "error") {
            const item = pendingChanges
                .get()
                .find(({ change }) => change.operation === message.operation);
            if (message.type === "error") {
                gameError.set(message.error);
                const current = sharedQuestions
                    .get()
                    .find(({ id }) => id === item?.change.id);
                if (current) {
                    const baseline = JSON.parse(baselines.get(current.id)!);
                    baseline.key = current.question.key;
                    baseline.data.hidden = current.question.data.hidden;
                    sharedQuestions.set(
                        sharedQuestions
                            .get()
                            .map((record) =>
                                record === current
                                    ? { ...current, question: baseline }
                                    : record,
                            ),
                    );
                }
            } else if (item?.localCopy) {
                const copy = item.localCopy;
                if (!questions.get().some(({ key }) => key === copy.key)) {
                    questions.set([...questions.get(), copy]);
                }
            } else if (item?.publishKey !== undefined) {
                questions.set(
                    questions
                        .get()
                        .filter(({ key }) => key !== item.publishKey),
                );
            }
            if (item)
                pendingChanges.set(
                    pendingChanges.get().filter((entry) => entry !== item),
                );
        }
    };
    live.onclose = ({ code }) => {
        if (socket !== live) return;
        socket = undefined;
        connection.set(code === 4001 ? "expired" : "offline");
        if (code === 4001) sharedQuestions.set([]);
        if (code !== 4001) {
            reconnect = setTimeout(connectGame, retry);
            retry = Math.min(retry * 2, 30000);
        }
    };
}

export function isPending(key: number) {
    return pendingChanges
        .get()
        .some(
            ({ publishKey, localCopy, change }) =>
                publishKey === key ||
                localCopy?.key === key ||
                keys.get(change.id) === key,
        );
}

function submit(item: Pending) {
    gameError.set("");
    pendingChanges.set([...pendingChanges.get(), item]);
    if (
        socket?.readyState === WebSocket.OPEN &&
        connection.get() === "online"
    ) {
        socket.send(JSON.stringify(item.change));
    }
}

export function toggleQuestionSync(key: number) {
    if (
        gameSession.get()?.role !== "seeker" ||
        connection.get() === "expired" ||
        isPending(key)
    )
        return;
    const shared = sharedQuestions
        .get()
        .find(({ question }) => question.key === key);
    const local = questions.get().find((question) => question.key === key);
    try {
        if (shared) {
            // Send unsaved edits first so the local copy matches the published version.
            if (fingerprint(shared.question) !== baselines.get(shared.id)) {
                flushSharedEdits();
                gameError.set(
                    "Finish syncing the edit before turning Sync off.",
                );
                return;
            }
            submit({
                localCopy: structuredClone(shared.question),
                change: {
                    operation: crypto.randomUUID(),
                    id: shared.id,
                    version: shared.version,
                    question: null,
                },
            });
        } else if (local) {
            const question = wireQuestion(local);
            // Keep the draft through a reload until publication is acknowledged.
            questions.set([...questions.get()]);
            submit({
                publishKey: key,
                change: {
                    operation: crypto.randomUUID(),
                    id: crypto.randomUUID(),
                    version: 0,
                    question,
                },
            });
        }
    } catch {
        gameError.set("Complete the question fields before syncing.");
    }
}

let editTimer: ReturnType<typeof setTimeout>;
export function sharedQuestionModified() {
    if (gameSession.get()?.role !== "seeker") return;
    clearTimeout(editTimer);
    editTimer = setTimeout(flushSharedEdits, 450);
}

export function flushSharedEdits() {
    if (gameSession.get()?.role !== "seeker") return;
    for (const { id, version, question } of sharedQuestions.get()) {
        if (isPending(question.key)) continue;
        try {
            const value = wireQuestion(question);
            if (JSON.stringify(value) === baselines.get(id)) continue;
            submit({
                change: {
                    operation: crypto.randomUUID(),
                    id,
                    version,
                    question: value,
                },
            });
        } catch {
            gameError.set("Complete the question fields before syncing.");
        }
    }
    triggerLocalRefresh.set(Math.random());
}
