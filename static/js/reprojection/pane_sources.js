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

    function isPointCloud(source, loadedGeometries = []) {
        return isColmap(source) || loadedGeometries.some(
            geometry => geometry.gpuKey === source
                && (geometry.kind === "point cloud"
                    || geometry.renderPath === "server")
        );
    }

    function renderPath(source, {
        colmapGpuReady = false,
        cameraSupported = false,
    } = {}) {
        if (isImage(source)) {
            return "image";
        }
        if (!isColmap(source)) {
            return "gpu";
        }
        return colmapGpuReady && cameraSupported
            ? "gpu" : "server";
    }

    function cycleIndex(currentIndex, optionCount, direction = 1) {
        if (optionCount <= 0) {
            return -1;
        }
        const step = Math.sign(direction || 1);
        return (currentIndex + step + optionCount) % optionCount;
    }

    function uniqueLabel(preferredLabel, existingLabels = []) {
        const preferred = String(preferredLabel || "").trim() || "Geometry";
        const used = new Set([...existingLabels].map(label => String(label)));
        if (!used.has(preferred)) {
            return preferred;
        }
        let suffix = 2;
        while (used.has(`${preferred} (${suffix})`)) {
            suffix += 1;
        }
        return `${preferred} (${suffix})`;
    }

    function sourceLabelDisplay(mode) {
        if (mode === "temporary") {
            return {visible: true, timeoutMs: 2000};
        }
        if (mode === "hidden") {
            return {visible: false, timeoutMs: null};
        }
        return {visible: true, timeoutMs: null};
    }

    const api = {
        IMAGE,
        COLMAP,
        isImage,
        isColmap,
        isGpuGeometry,
        isGeometry,
        isPointCloud,
        renderPath,
        sourceLabelDisplay,
        cycleIndex,
        uniqueLabel,
    };
    globalScope.ReprojectionPaneSources = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
