import type { Map } from "leaflet";

// Leaflet 1.9 blocks drag starts while its zoom transition is finishing.
// Finish that transition before Leaflet receives the next touch, keeping the
// existing tile layers rather than using zoomAnimation=false (which clears them).
export function enableInterruptibleMapZoom(map: Map) {
    const zoomMap = map as Map & {
        _animatingZoom?: boolean;
        _onZoomTransitionEnd: () => void;
    };
    const container = map.getContainer();
    const finishZoom = () => {
        if (zoomMap._animatingZoom) zoomMap._onZoomTransitionEnd();
    };

    container.addEventListener("touchstart", finishZoom, {
        capture: true,
        passive: true,
    });
    return () =>
        container.removeEventListener("touchstart", finishZoom, { capture: true });
}
