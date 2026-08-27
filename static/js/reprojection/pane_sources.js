(function (globalScope) {
    "use strict";

    const IMAGE = "image";
    const COLMAP = "colmap";

    function isImage(source) {
        return source === IMAGE;
    }

    function isColmap(source) {
        return source === COLMAP;
    }

    function isGpuGeometry(source) {
        return Boolean(source) && !isImage(source) && !isColmap(source);
    }

    function isGeometry(source) {
        return Boolean(source) && !isImage(source);
    }

    function cycleIndex(currentIndex, optionCount, direction = 1) {
        if (optionCount <= 0) {
            return -1;
        }
        const step = Math.sign(direction || 1);
        return (currentIndex + step + optionCount) % optionCount;
    }

    const api = {
        IMAGE,
        COLMAP,
        isImage,
        isColmap,
        isGpuGeometry,
        isGeometry,
        cycleIndex,
    };
    globalScope.ReprojectionPaneSources = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
