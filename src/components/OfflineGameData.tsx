import { useStore } from "@nanostores/react";
import { useEffect, useRef, useState } from "react";

import {
    downloadPack,
    getLocalPack,
    installPack,
    localDataStatus,
    readPackFile,
    removePack,
} from "@/maps/api/local-data";
import { prepareQuestionRuntime } from "@/maps/api/runtime-assets";

import { Button } from "./ui/button";

export function OfflineGameData() {
    const status = useStore(localDataStatus);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const controller = useRef<AbortController | null>(null);
    useEffect(() => {
        void getLocalPack();
        return () => controller.current?.abort();
    }, []);
    const run = async (operation: () => Promise<void>) => {
        setBusy(true);
        setMessage("");
        try {
            await operation();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy(false);
            controller.current = null;
        }
    };
    return (
        <section
            className="flex flex-col gap-3 w-full"
            aria-label="Offline game data"
        >
            <h3 className="font-semibold">Offline game data</h3>
            <p className="text-sm" role="status" aria-live="polite">
                {status}
            </p>
            {message && (
                <p className="text-sm" role="status" aria-live="polite">
                    {message}
                </p>
            )}
            <p className="text-sm">
                Save game locations and boundaries for fast questions. Searches
                beyond the downloaded coverage use internet.
            </p>
            <div className="flex flex-wrap gap-2">
                <Button
                    disabled={busy}
                    onClick={() =>
                        void run(async () => {
                            controller.current = new AbortController();
                            await downloadPack(
                                controller.current.signal,
                                setMessage,
                            );
                            setMessage(
                                "Saved. Reload the app to use the new data for all questions.",
                            );
                        })
                    }
                >
                    Download regional data
                </Button>
                {busy && controller.current && (
                    <Button onClick={() => controller.current?.abort()}>
                        Cancel download
                    </Button>
                )}
                <Button
                    disabled={busy}
                    onClick={() =>
                        void run(async () => {
                            await removePack();
                            setMessage(
                                "Removed. Reload the app to clear previously calculated answers.",
                            );
                        })
                    }
                >
                    Remove saved data
                </Button>
            </div>
            <label className="text-sm flex flex-col gap-2">
                Import a prepared game-data file
                <input
                    type="file"
                    accept="application/json,.json,.gz,.pack"
                    disabled={busy}
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file)
                            void run(async () => {
                                setMessage("Reading and saving game data…");
                                await prepareQuestionRuntime();
                                await installPack(
                                    await readPackFile(
                                        file,
                                        file.name.endsWith(".gz") ||
                                            file.name.endsWith(".pack"),
                                    ),
                                );
                                setMessage(
                                    "Saved. Reload the app to use the new data for all questions.",
                                );
                            });
                    }}
                />
            </label>
            <a
                className="text-sm underline"
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
            >
                Game data © OpenStreetMap contributors · ODbL
            </a>
        </section>
    );
}
