(function (globalScope) {
    "use strict";

    const BASE_STEP = 0.002;
    const MAX_STEP = 0.02;
    const MINIMUM_GAP = BASE_STEP;

    function adaptiveStep(deltaY, elapsedMs = Infinity, deltaMode = 0) {
        const deltaUnit = deltaMode === 1 ? 16 : deltaMode === 2 ? 800 : 1;
        const pixelDelta = Math.abs(Number(deltaY) || 0) * deltaUnit;
        const magnitudeFactor = Math.max(1, pixelDelta / 100);
        const cadenceFactor = Number.isFinite(elapsedMs) && elapsedMs > 0
            ? Math.max(1, 120 / elapsedMs)
            : 1;
        return Math.min(
            MAX_STEP,
            BASE_STEP * Math.max(magnitudeFactor, cadenceFactor)
        );
    }

    function adjustRange(
        near, far, plane, direction, increment = BASE_STEP
    ) {
        const step = Math.abs(Number(increment) || BASE_STEP)
            * Math.sign(direction || 1);
        if (plane === "near") {
            near = Math.max(0, Math.min(far - MINIMUM_GAP, near + step));
        } else {
            far = Math.min(1, Math.max(near + MINIMUM_GAP, far + step));
        }
        return {near, far};
    }

    const api = {adaptiveStep, adjustRange};
    globalScope.ReprojectionClippingScroll = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
