import { calculateTentacleGeometry } from "./tentacle-worker";

self.onmessage = (event) => {
    const { id, input } = event.data;
    try {
        self.postMessage({ id, result: calculateTentacleGeometry(input) });
    } catch (error) {
        self.postMessage({
            id,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
