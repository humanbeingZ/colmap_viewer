(function (globalScope) {
    "use strict";

    const SIZES = Object.freeze([0.25, 0.5, 0.75, 1, 3, 5, 7, 9, 11, 13, 15]);

    function normalize(value) {
        let size = Number(value);
        if (!Number.isFinite(size)) {
            size = 3;
        }
        size = Math.max(SIZES[0], Math.min(SIZES[SIZES.length - 1], size));
        if (size < 1) {
            return Math.round(size * 4) / 4;
        }
        size = Math.round(size);
        if (size % 2 === 0) {
            size += size === SIZES[SIZES.length - 1] ? -1 : 1;
        }
        return size;
    }

    function step(value, direction) {
        const current = normalize(value);
        const currentIndex = SIZES.indexOf(current);
        const index = Math.max(
            0,
            Math.min(SIZES.length - 1, currentIndex + Math.sign(direction))
        );
        return SIZES[index];
    }

    function displayRenderMaxSize({
        displayWidth,
        displayHeight,
        fallbackMaxSize,
        navigationPreview = false,
        navigationPreviewSize = fallbackMaxSize,
        minRenderSize = 1,
        maxRenderSize,
    }) {
        const displayMax = Math.max(
            Number(displayWidth) || 0,
            Number(displayHeight) || 0
        );
        let maxSize = displayMax > 0
            ? Math.ceil(displayMax)
            : Math.max(1, Number(fallbackMaxSize) || 1);
        if (navigationPreview) {
            maxSize = Math.min(
                maxSize,
                Math.max(1, Number(navigationPreviewSize) || 1)
            );
        }
        const limit = Number(maxRenderSize);
        if (Number.isFinite(limit) && limit > 0) {
            maxSize = Math.min(maxSize, limit);
        }
        return Math.max(Number(minRenderSize) || 1, Math.round(maxSize));
    }

    function renderParameters({
        pointSize,
        baseMaxSize,
        navigationPreview,
        maxRenderSize,
    }) {
        const size = normalize(pointSize);
        if (size >= 1 || navigationPreview || !maxRenderSize) {
            return {
                maxSize: baseMaxSize,
                radius: Math.floor(size / 2),
            };
        }
        const renderScale = Math.min(1 / size, maxRenderSize / baseMaxSize);
        return {
            maxSize: Math.round(baseMaxSize * Math.max(1, renderScale)),
            radius: 0,
        };
    }

    const api = {displayRenderMaxSize, normalize, renderParameters, step};
    globalScope.ReprojectionPointSize = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
