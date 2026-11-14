import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
    DurableObject: class {
        constructor(protected ctx: unknown) {}
    },
}));

import worker, { Game } from "../worker/index";

describe("game creation", () => {
    it.each(["hider", "seeker"])("creates a game as %s", async (role) => {
        const exec = vi.fn(() => ({ toArray: () => [] }));
        const setAlarm = vi.fn();
        const game = new Game(
            {
                id: { toString: () => "test-game" },
                storage: {
                    sql: { exec },
                    transactionSync: (callback: () => unknown) => callback(),
                    setAlarm,
                },
            } as never,
            {} as never,
        );
        const response = await worker.fetch(
            new Request("https://example.com/games", {
                method: "POST",
                headers: { Origin: "http://localhost:4321" },
                body: JSON.stringify({ role }),
            }),
            { GAMES: { getByName: () => game } } as never,
        );
        expect(response.status).toBe(200);
        const data = (await response.json()) as { code: string; token: string };
        expect(data.code).toMatch(/^[A-F0-9]{8}$/);
        expect(exec).toHaveBeenCalledWith(
            "INSERT INTO players VALUES (?, ?)",
            data.token,
            role,
        );
        expect(setAlarm).toHaveBeenCalledOnce();
    });

    it.each(['{"role":"admin"}', "{}", "invalid"])(
        "rejects invalid team input %s",
        async (body) => {
            const getByName = vi.fn();
            const response = await worker.fetch(
                new Request("https://example.com/games", {
                    method: "POST",
                    headers: { Origin: "http://localhost:4321" },
                    body,
                }),
                { GAMES: { getByName } } as never,
            );
            expect(response.status).toBe(400);
            expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
                "http://localhost:4321",
            );
            expect(getByName).not.toHaveBeenCalled();
        },
    );
});
