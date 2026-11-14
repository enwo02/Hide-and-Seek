import { DurableObject } from "cloudflare:workers";
import {
    parseGameArea,
    sharedFields,
    type Change,
    type Role,
    type SharedQuestion,
} from "../src/lib/game-protocol";

interface Env {
    GAMES: DurableObjectNamespace<Game>;
    ALLOWED_ORIGINS?: string;
}

const lifetime = 24 * 60 * 60 * 1000;
const codePattern = /^[A-F0-9]{8}$/;
const idPattern = /^[a-f0-9-]{36}$/;
const random = (bytes: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");

const error = (message: string, status: number) =>
    Response.json({ error: message }, { status });

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const origin = request.headers.get("Origin") || "";
        const origins = (
            env.ALLOWED_ORIGINS ||
            "https://enwo02.github.io,http://localhost:4321,http://127.0.0.1:4321"
        ).split(",");
        if (!origins.includes(origin)) return error("Origin denied", 403);
        const cors = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "600",
            "Cache-Control": "no-store",
            Vary: "Origin",
        };
        if (request.method === "OPTIONS")
            return new Response(null, { status: 204, headers: cors });

        const path = new URL(request.url).pathname;
        let response: Response;
        if (path === "/games" && request.method === "POST") {
            const body = await request.text();
            let input;
            try {
                input = body.length <= 256 ? JSON.parse(body) : null;
            } catch {
                input = null;
            }
            if (input?.role !== "hider" && input?.role !== "seeker")
                return new Response(
                    JSON.stringify({ error: "Choose a team" }),
                    {
                        status: 400,
                        headers: {
                            ...cors,
                            "Content-Type": "application/json",
                        },
                    },
                );
            do {
                const code = random(4).toUpperCase();
                response = await env.GAMES.getByName(code).fetch(
                    new Request("https://game/create", {
                        method: "POST",
                        body: JSON.stringify({ code, role: input.role }),
                    }),
                );
            } while (response.status === 409);
        } else {
            const [, resource, code, action, extra] = path.split("/");
            if (
                resource !== "games" ||
                extra !== undefined ||
                !codePattern.test(code || "") ||
                !(
                    (action === "join" && request.method === "POST") ||
                    (action === "live" &&
                        request.headers.get("Upgrade") === "websocket")
                )
            ) {
                return new Response(null, { status: 404, headers: cors });
            }
            response = await env.GAMES.getByName(code).fetch(request);
        }
        if (response.status === 101) return response;
        return new Response(response.body, {
            status: response.status,
            headers: { ...cors, "Content-Type": "application/json" },
        });
    },
};

export class Game extends DurableObject<Env> {
    private get sql() {
        return this.ctx.storage.sql;
    }

    private measure(kind: string, start: number) {
        console.log({
            game: this.ctx.id.toString(),
            kind,
            handlerMs: performance.now() - start,
        });
    }

    async fetch(request: Request) {
        const start = performance.now();
        const action = new URL(request.url).pathname.split("/").pop();
        try {
            if (action === "create") {
                const { code, role } = await request.json<{
                    code: string;
                    role: Role;
                }>();
                return await this.create(code, role);
            }
            const exists = this.sql
                .exec("SELECT 1 FROM sqlite_master WHERE name = 'room'")
                .toArray().length;
            const room = exists
                ? this.sql
                      .exec<{ expires: number }>("SELECT expires FROM room")
                      .toArray()[0]
                : undefined;
            if (!room || room.expires <= Date.now()) {
                return action === "live"
                    ? this.closeConnection(request, 4001, "Game expired")
                    : error("Game expired or unavailable", 410);
            }
            if (action === "join") {
                const body = await request.text();
                if (body.length > 256)
                    return error("Invalid join request", 400);
                let input;
                try {
                    input = JSON.parse(body);
                } catch {
                    return error("Invalid join request", 400);
                }
                if (input?.role !== "hider" && input?.role !== "seeker")
                    return error("Choose a team", 400);
                return Response.json({ token: this.issueToken(input.role) });
            }

            const token = request.headers.get("Sec-WebSocket-Protocol");
            const player = this.sql
                .exec<{
                    role: Role;
                }>("SELECT role FROM players WHERE token = ?", token)
                .toArray()[0];
            if (!player)
                return this.closeConnection(
                    request,
                    4001,
                    "Game session unavailable",
                );
            const [client, server] = Object.values(new WebSocketPair());
            this.ctx.acceptWebSocket(server);
            server.serializeAttachment({
                ...player,
                token,
                expires: room.expires,
            });
            this.send(server, {
                type: "state",
                questions: this.snapshot(),
                area: this.area(),
            });
            return new Response(null, {
                status: 101,
                webSocket: client,
                headers: { "Sec-WebSocket-Protocol": token! },
            });
        } finally {
            this.measure(action || "http", start);
        }
    }

    private closeConnection(request: Request, code: number, reason: string) {
        const { 0: client, 1: server } = new WebSocketPair();
        const token = request.headers.get("Sec-WebSocket-Protocol");
        server.accept();
        server.close(code, reason);
        return new Response(null, {
            status: 101,
            webSocket: client,
            headers:
                token && /^[a-f0-9]{48}$/.test(token)
                    ? { "Sec-WebSocket-Protocol": token }
                    : {},
        });
    }

    private async create(code: string, role: Role) {
        this.sql.exec(`
            CREATE TABLE IF NOT EXISTS room (expires INTEGER);
            CREATE TABLE IF NOT EXISTS players (token TEXT PRIMARY KEY, role TEXT);
            CREATE TABLE IF NOT EXISTS questions (id TEXT PRIMARY KEY, version INTEGER, data TEXT);
            CREATE TABLE IF NOT EXISTS receipts (player TEXT, operation TEXT, id TEXT, version INTEGER, PRIMARY KEY (player, operation));
        `);
        if (this.sql.exec("SELECT 1 FROM room").toArray().length)
            return error("Code in use", 409);
        const expires = Date.now() + lifetime;
        const token = this.ctx.storage.transactionSync(() => {
            this.sql.exec("INSERT INTO room (expires) VALUES (?)", expires);
            return this.issueToken(role);
        });
        await this.ctx.storage.setAlarm(expires);
        return Response.json({ code, token });
    }

    private issueToken(role: Role) {
        const token = random(24);
        this.sql.exec("INSERT INTO players VALUES (?, ?)", token, role);
        return token;
    }

    private area() {
        const exists = this.sql
            .exec("SELECT 1 FROM sqlite_master WHERE name = 'game_area'")
            .toArray().length;
        if (!exists) return null;
        const record = this.sql
            .exec<{
                location: string;
            }>("SELECT location FROM game_area WHERE id = 1")
            .toArray()[0];
        return record ? JSON.parse(record.location) : null;
    }

    private snapshot(): SharedQuestion[] {
        return this.sql
            .exec<{ id: string; version: number; data: string }>(
                "SELECT * FROM questions WHERE data IS NOT NULL",
            )
            .toArray()
            .map(({ id, version, data }) => ({
                id,
                version,
                question: JSON.parse(data),
            }));
    }

    private send(socket: WebSocket, message: unknown) {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
            socket.send(JSON.stringify(message));
        } catch {
            // A disconnected client gets a fresh snapshot and retries its outbox.
        }
    }

    webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
        const start = performance.now();
        let operation: string | undefined;
        let areaChange = false;
        try {
            const player = socket.deserializeAttachment();
            if (player.expires <= Date.now()) {
                socket.close(4001, "Game expired");
                return;
            }
            if (player.role !== "seeker") {
                this.send(socket, {
                    type: "error",
                    error: "Only seekers can change shared questions",
                });
                return;
            }
            if (typeof message !== "string" || message.length > 65536)
                throw Error("Question is too large");
            const payload = JSON.parse(message);
            if (payload?.type === "set-area") {
                areaChange = true;
                const parsed = parseGameArea(payload.location);
                this.sql.exec(
                    "CREATE TABLE IF NOT EXISTS game_area (id INTEGER PRIMARY KEY, location TEXT)",
                );
                this.sql.exec(
                    "INSERT OR REPLACE INTO game_area VALUES (1, ?)",
                    JSON.stringify(parsed),
                );
                for (const peer of this.ctx.getWebSockets()) {
                    this.send(peer, { type: "area", area: parsed });
                }
                return;
            }
            const change: Change = payload;
            if (
                typeof change.operation !== "string" ||
                !idPattern.test(change.operation) ||
                typeof change.id !== "string" ||
                !idPattern.test(change.id) ||
                !Number.isSafeInteger(change.version) ||
                change.version < 0
            )
                throw Error("Invalid change");
            operation = change.operation;
            const prior = this.sql
                .exec<{
                    id: string;
                    version: number;
                }>(
                    "SELECT id, version FROM receipts WHERE player = ? AND operation = ?",
                    player.token,
                    operation,
                )
                .toArray()[0];
            if (prior) {
                this.send(socket, { type: "ack", operation, ...prior });
                return;
            }
            const current = this.sql
                .exec<{
                    version: number;
                    data: string | null;
                }>(
                    "SELECT version, data FROM questions WHERE id = ?",
                    change.id,
                )
                .toArray()[0];
            if (
                (current && !current.data) ||
                (current?.version ?? 0) !== change.version
            )
                throw Error(
                    "Another seeker changed this question. Review the latest version and try again.",
                );
            const question =
                change.question === null ? null : sharedFields(change.question);
            if (current?.data && question) {
                const previous = JSON.parse(current.data);
                if (!previous.data.drag) {
                    previous.data.drag = question.data.drag;
                    if (JSON.stringify(previous) !== JSON.stringify(question))
                        throw Error("Unlock this question before editing it.");
                }
            }
            if (
                !current &&
                this.sql
                    .exec(
                        "SELECT id FROM questions WHERE data IS NOT NULL LIMIT 100",
                    )
                    .toArray().length >= 100
            ) {
                throw Error("This game has reached its question limit");
            }
            if (!question && !current?.data)
                throw Error("Question is already private");
            const version = change.version + 1;
            this.ctx.storage.transactionSync(() => {
                this.sql.exec(
                    "INSERT OR REPLACE INTO questions VALUES (?, ?, ?)",
                    change.id,
                    version,
                    question && JSON.stringify(question),
                );
                this.sql.exec(
                    "INSERT INTO receipts VALUES (?, ?, ?, ?)",
                    player.token,
                    operation!,
                    change.id,
                    version,
                );
            });
            const update = { type: "update", id: change.id, version, question };
            for (const peer of this.ctx.getWebSockets())
                this.send(peer, update);
            this.send(socket, {
                type: "ack",
                operation,
                id: change.id,
                version,
            });
        } catch (cause) {
            this.send(socket, {
                type: areaChange ? "area-error" : "error",
                operation,
                error:
                    cause instanceof Error && cause.name !== "ZodError"
                        ? cause.message
                        : "Invalid question",
            });
        } finally {
            this.measure("message", start);
        }
    }

    async alarm() {
        const start = performance.now();
        for (const socket of this.ctx.getWebSockets())
            socket.close(4001, "Game expired");
        await this.ctx.storage.deleteAll();
        this.measure("expiry", start);
    }
}
