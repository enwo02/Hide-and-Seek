import { useEffect, useRef, useState } from "react";

import { downloadPack } from "@/maps/api/local-data";

import { Button } from "./ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "./ui/dialog";

export function MapDataSetup({ onReady }: { onReady: () => void }) {
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState("");
    const [error, setError] = useState("");
    const controller = useRef<AbortController | null>(null);

    useEffect(() => () => controller.current?.abort(), []);

    const download = async () => {
        const downloadController = new AbortController();
        controller.current = downloadController;
        setBusy(true);
        setError("");
        setProgress("Starting download…");
        try {
            await downloadPack(downloadController.signal, setProgress);
            onReady();
        } catch (error) {
            setProgress("");
            setError(
                downloadController.signal.aborted
                    ? "Download cancelled. You can try again."
                    : error instanceof Error
                      ? error.message
                      : String(error),
            );
        } finally {
            controller.current = null;
            setBusy(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && !busy && onReady()}>
            <DialogContent
                closeIcon={!busy}
                className="max-h-[90dvh] overflow-y-auto"
            >
                <DialogTitle>Download map data to get started</DialogTitle>
                <DialogDescription>
                    Save regional locations and municipality boundaries on this
                    device for reliable map loading and offline questions. When
                    the download finishes, your selected area (Zurich by
                    default) will open automatically.
                </DialogDescription>
                <p className="text-sm text-muted-foreground">
                    This downloads the full regional data pack and may take a
                    few minutes. You only need to do this once per device. You
                    can also download it later in Options.
                </p>
                <p role="status" aria-live="polite" className="text-sm">
                    {error || progress}
                </p>
                <div className="flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => void download()}>
                        {busy ? "Downloading…" : "Download map data"}
                    </Button>
                    {busy ? (
                        <Button
                            variant="outline"
                            onClick={() => controller.current?.abort()}
                        >
                            Cancel download
                        </Button>
                    ) : (
                        <Button variant="outline" onClick={onReady}>
                            Continue using internet
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
