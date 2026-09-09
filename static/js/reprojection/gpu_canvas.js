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
        renderedMode = "independent",
        leftSelectedSource,
        leftRenderedSource,
        selectedIsGpu,
        leftIsGpu,
        sharesLeftSurface,
    }) {
        const hasIndependentFrame = selectedSource === renderedSource
            && renderedMode === "independent";
        if (hasIndependentFrame) {
            return "independent";
        }
        const canShareLeft = sharesLeftSurface
            && leftIsGpu
            && selectedIsGpu
            && selectedSource === leftSelectedSource
            && leftRenderedSource === leftSelectedSource;
        if (canShareLeft) {
            return "same";
        }
        return "retain";
    }

    function shouldRenderRightOnly({
        rightIsGpu,
        leftSelectedSource,
        leftPresentedSource,
        leftPresentationActive,
        rightSourcePending,
    }) {
        return rightIsGpu
            && leftPresentationActive
            && leftPresentedSource === leftSelectedSource
            && rightSourcePending;
    }

    function createCapturedPresentation(
        canvas, layer, backgroundHosts = [layer]
    ) {
        const hosts = [...new Set(backgroundHosts)];
        const setBackground = (background = "") => {
            for (const host of hosts) {
                host.style.background = background;
            }
        };
        return {
            holdBackground: setBackground,
            setActive(active) {
                // Background overrides belong only to transition holds.
                setBackground();
                canvas.classList.toggle("active", active);
                layer.classList.toggle("capture-active", active);
            },
        };
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
        createCapturedPresentation,
        needsLiveOutgoingCanvas,
        rightPresentationMode,
        shouldRenderRightOnly,
        sourceTransition,
        waitForPresentation,
    };
    globalScope.ReprojectionGpuCanvas = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
