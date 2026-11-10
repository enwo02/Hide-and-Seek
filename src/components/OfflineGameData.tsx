import { useStore } from "@nanostores/react";
import { Check, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
    downloadPack,
    getLocalPack,
    localDataStatus,
    removePack,
} from "@/maps/api/local-data";

import { Button } from "./ui/button";

export function OfflineGameData() {
    const status = useStore(localDataStatus);
    const [downloaded, setDownloaded] = useState(false);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const controller = useRef<AbortController | null>(null);
    useEffect(() => {
        let active = true;
        void getLocalPack().then((pack) => {
            if (active) setDownloaded(Boolean(pack));
        });
        return () => {
            active = false;
        };
    }, [status]);
    useEffect(() => () => controller.current?.abort(), []);
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
            <div className="flex flex-wrap gap-2">
                <Button
                    disabled={busy || downloaded}
                    onClick={() =>
                        void run(async () => {
                            controller.current = new AbortController();
                            await downloadPack(
                                controller.current.signal,
                                setMessage,
                            );
                            setMessage("Downloaded. Reload to use the data.");
                        })
                    }
                >
                    {downloaded && <Check aria-hidden="true" />}
                    {busy
                        ? "Downloading…"
                        : downloaded
                          ? "Switzerland Data Downloaded"
                          : "Download Switzerland Data"}
                </Button>
                {busy && controller.current && (
                    <Button onClick={() => controller.current?.abort()}>
                        Cancel download
                    </Button>
                )}
                {downloaded && (
                    <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        aria-label="Remove Switzerland data"
                        title="Remove Switzerland data"
                        onClick={() =>
                            void run(async () => {
                                await removePack();
                                setMessage(
                                    "Removed. Reload to clear saved answers.",
                                );
                            })
                        }
                    >
                        <Trash2 aria-hidden="true" />
                    </Button>
                )}
            </div>
            {message && (
                <p className="text-sm" role="status" aria-live="polite">
                    {message}
                </p>
            )}
        </section>
    );
}
