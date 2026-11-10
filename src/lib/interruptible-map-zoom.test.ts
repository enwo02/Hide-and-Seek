import type { Map } from "leaflet";
import { describe, expect, it, vi } from "vitest";

import { enableInterruptibleMapZoom } from "./interruptible-map-zoom";

describe("interruptible map zoom", () => {
    it("unlocks an active zoom synchronously on the next touch and cleans up", () => {
        const container = new EventTarget();
        const map = {
            getContainer: () => container,
            _animatingZoom: false,
            _onZoomTransitionEnd: vi.fn(() => {
                map._animatingZoom = false;
            }),
        };
        const cleanup = enableInterruptibleMapZoom(map as unknown as Map);

        // Ordinary touches and the live pinch must not finish a transition.
        container.dispatchEvent(new Event("touchstart"));
        expect(map._onZoomTransitionEnd).not.toHaveBeenCalled();

        map._animatingZoom = true;
        container.dispatchEvent(new Event("touchstart"));
        expect(map._animatingZoom).toBe(false);
        expect(map._onZoomTransitionEnd).toHaveBeenCalledOnce();

        cleanup();
        map._animatingZoom = true;
        container.dispatchEvent(new Event("touchstart"));
        expect(map._onZoomTransitionEnd).toHaveBeenCalledOnce();
    });
});
