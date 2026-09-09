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
        const canShareLeft = sharesLeftSurface
            && leftIsGpu
            && selectedIsGpu
            && selectedSource === leftSelectedSource
            && leftRenderedSource === leftSelectedSource;
        if (canShareLeft) {
            return "same";
        }
        const hasIndependentFrame = selectedSource === renderedSource
            && renderedMode === "independent";
        if (hasIndependentFrame) {
            return "independent";
        }
        return "retain";
    }

    function rightLayerState({sourceIsGeometry, sourceIsGpu, mode}) {
        if (mode !== "independent" && mode !== "same") {
            throw new Error(`Unsupported right presentation mode: ${mode}`);
        }
        if (mode === "same" && !sourceIsGpu) {
            throw new Error("Only GPU geometry can share the left surface");
        }
        const captureActive = mode === "independent" && sourceIsGpu;
        return {
            captureActive,
            geometryActive: sourceIsGeometry,
            gpuIndependent: captureActive,
            rasterVisible: mode === "independent" && !sourceIsGpu,
            sameGeometry: mode === "same",
        };
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

    function isCurrentIndependentFrame({
        source,
        renderedSource,
        renderedMode,
        frameKey,
        renderedFrameKey,
    }) {
        return renderedMode === "independent"
            && renderedSource === source
            && renderedFrameKey === frameKey;
    }

    function shouldCaptureRightPane({
        includeRightPane,
        rightIsGpu,
        sideBySide,
        leftSource,
        rightSource,
        rightFrameCurrent,
    }) {
        return includeRightPane
            && rightIsGpu
            && (sideBySide || rightSource !== leftSource)
            && !rightFrameCurrent;
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
        isCurrentIndependentFrame,
        needsLiveOutgoingCanvas,
        rightLayerState,
        rightPresentationMode,
        shouldCaptureRightPane,
        shouldRenderRightOnly,
        sourceTransition,
        waitForPresentation,
    };
    globalScope.ReprojectionGpuCanvas = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
