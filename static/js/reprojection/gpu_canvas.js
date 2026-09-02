(function (globalScope) {
    "use strict";

    function canvasForEngine(threeCanvas, gaussianCanvas, engine) {
        return engine === "playcanvas"
            ? gaussianCanvas : threeCanvas;
    }

    function needsLiveOutgoingCanvas(outgoingCanvas, destinationCanvas) {
        return Boolean(outgoingCanvas)
            && Boolean(destinationCanvas)
            && outgoingCanvas !== destinationCanvas;
    }

    function sourceTransition(sourceAlreadyVisible, currentCanvasActive) {
        if (sourceAlreadyVisible) {
            return "attach";
        }
        return currentCanvasActive ? "keep" : "disable";
    }

    function rightPresentationMode({
        selectedSource,
        renderedSource,
        leftSelectedSource,
        leftRenderedSource,
        selectedIsGpu,
        leftIsGpu,
        sharesLeftSurface,
    }) {
        const canShareLeft = sharesLeftSurface
            && leftIsGpu
            && selectedIsGpu
            && selectedSource === leftSelectedSource
            && leftRenderedSource === leftSelectedSource;
        if (canShareLeft) {
            return "same";
        }
        return selectedSource === renderedSource ? "independent" : "retain";
    }

    function waitForPresentation(
        requestFrame = globalScope.requestAnimationFrame.bind(globalScope)
    ) {
        return new Promise(resolve => {
            requestFrame(() => requestFrame(resolve));
        });
    }

    const api = {
        canvasForEngine,
        needsLiveOutgoingCanvas,
        rightPresentationMode,
        sourceTransition,
        waitForPresentation,
    };
    globalScope.ReprojectionGpuCanvas = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
