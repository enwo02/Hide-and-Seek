import { useStore } from "@nanostores/react";
import { useEffect, useState } from "react";

import {
    connection,
    enterGame,
    gameError,
    gameSession,
    leaveGame,
    pendingChanges,
    watchGameConnection,
    workerURL,
} from "@/lib/game-client";
import type { Role } from "@/lib/game-protocol";

import { Button } from "./ui/button";
import { RawInput } from "./ui/input";

export function GameSession() {
    const session = useStore(gameSession);
    const status = useStore(connection);
    const pending = useStore(pendingChanges);
    const error = useStore(gameError);
    const [code, setCode] = useState("");
    const [role, setRole] = useState<Role>("hider");
    const [busy, setBusy] = useState(false);
    useEffect(watchGameConnection, []);
    if (!workerURL) return null;

    async function enter(create: boolean) {
        setBusy(true);
        gameError.set("");
        try {
            await enterGame(
                create ? undefined : code,
                create ? "seeker" : role,
            );
        } catch (cause) {
            gameError.set(
                cause instanceof Error
                    ? cause.message
                    : "Could not enter the game",
            );
        } finally {
            setBusy(false);
        }
    }

    return (
        <details
            open={session ? true : undefined}
            className="m-3 rounded border p-2 text-sm"
        >
            <summary className="cursor-pointer">Multiplayer</summary>
            {session ? (
                <div className="mt-2 space-y-2">
                    <div>
                        Game <strong>{session.code}</strong> ·{" "}
                        {session.role === "seeker" ? "Seeker" : "Hider"}
                    </div>
                    <div role="status">
                        {status === "online"
                            ? "Connected"
                            : status === "expired"
                              ? "Game expired"
                              : status === "offline"
                                ? "Offline · Reconnecting…"
                                : "Connecting to game…"}
                        {pending.length > 0 && " · Sync pending"}
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            if (
                                !pending.length ||
                                window.confirm(
                                    "Leave the game and discard pending changes?",
                                )
                            )
                                leaveGame();
                        }}
                    >
                        Leave game
                    </Button>
                </div>
            ) : (
                <form
                    className="mt-2 space-y-2"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void enter(false);
                    }}
                >
                    <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        onClick={() => void enter(true)}
                    >
                        Create game
                    </Button>
                    <RawInput
                        aria-label="Game code"
                        placeholder="Game code"
                        value={code}
                        maxLength={8}
                        required
                        pattern="[A-F0-9]{8}"
                        onChange={(event) =>
                            setCode(event.target.value.toUpperCase())
                        }
                    />
                    <label className="flex items-center gap-2">
                        Team
                        <select
                            className="rounded border bg-background p-1"
                            value={role}
                            onChange={(event) =>
                                setRole(event.target.value as Role)
                            }
                        >
                            <option value="hider">Hider</option>
                            <option value="seeker">Seeker</option>
                        </select>
                    </label>
                    <Button type="submit" size="sm" disabled={busy}>
                        Join game
                    </Button>
                </form>
            )}
            {error && (
                <p className="mt-2 text-red-400" role="alert">
                    {error}
                </p>
            )}
        </details>
    );
}
