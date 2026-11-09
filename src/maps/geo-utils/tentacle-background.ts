import { calculateTentacleGeometry } from "./tentacle-worker";

let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<
    number,
    { resolve: (result: any) => void; reject: (error: Error) => void }
>();

export function tentacleGeometry(input: any): Promise<any> {
    if (typeof Worker === "undefined")
        return Promise.resolve().then(() => calculateTentacleGeometry(input));
    if (!worker) {
        worker = new Worker(
            new URL("./tentacle-worker-entry.ts", import.meta.url),
            { type: "module" },
        );
        worker.onmessage = (event) => {
            const job = pending.get(event.data.id);
            if (!job) return;
            pending.delete(event.data.id);
            if (event.data.error) job.reject(new Error(event.data.error));
            else job.resolve(event.data.result);
        };
        worker.onerror = () => {
            for (const job of pending.values())
                job.reject(
                    new Error("Tentacle calculation failed. Please retry."),
                );
            pending.clear();
            worker?.terminate();
            worker = undefined;
        };
    }
    return new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        try {
            worker!.postMessage({ id, input });
        } catch (error) {
            pending.delete(id);
            reject(error);
        }
    });
}
