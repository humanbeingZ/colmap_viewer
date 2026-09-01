(function (globalScope) {
    "use strict";

    function canvasForEngine(threeCanvas, gaussianCanvas, engine) {
        return engine === "playcanvas"
            ? gaussianCanvas : threeCanvas;
    }

    const api = {canvasForEngine};
    globalScope.ReprojectionGpuCanvas = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
