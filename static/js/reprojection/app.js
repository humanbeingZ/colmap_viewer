const viewerModeSelect = document.getElementById("viewer-mode-select");
const matchingControls = document.getElementById("matching-controls");
const reprojectionControls = document.getElementById("reprojection-controls");
const matchingViewer = document.getElementById("matching-viewer");
const reprojectionViewer = document.getElementById("reprojection-viewer");
const reprojectionImageSelect = document.getElementById("reprojection-image-select");
const reprojectionStatus = document.getElementById("reprojection-status");
const reprojectionSplit = document.getElementById("reprojection-split");
const reprojectionSide = document.getElementById("reprojection-side");
const reprojectionLeftPane = reprojectionSide.querySelector(
    ".reprojection-pane"
);
const reprojectionInputLayer = document.getElementById("reprojection-input-layer");
const reprojectionInput = document.getElementById("reprojection-input");
const reprojectionInputSide = document.getElementById("reprojection-input-side");
const reprojectionRightGeometry = document.getElementById(
    "reprojection-right-geometry"
);
const reprojectionRightGeometrySide = document.getElementById(
    "reprojection-right-geometry-side"
);
const reprojectionCloud = document.getElementById("reprojection-cloud");
const reprojectionCloudSide = document.getElementById("reprojection-cloud-side");
const reprojectionGpuFallback = document.getElementById(
    "reprojection-gpu-fallback"
);
const reprojectionLeftGeometryLayer = document.getElementById(
    "reprojection-left-geometry-layer"
);
const reprojectionLeftGeometry = document.getElementById(
    "reprojection-left-geometry"
);
const leftCapturedPresentation =
    ReprojectionGpuCanvas.createCapturedPresentation(
        reprojectionLeftGeometry,
        reprojectionLeftGeometryLayer,
        [reprojectionLeftGeometryLayer, reprojectionLeftPane]
    );
const reprojectionRightGeometryLayer = document.getElementById(
    "reprojection-right-geometry-layer"
);
const rightCapturedPresentation =
    ReprojectionGpuCanvas.createCapturedPresentation(
        reprojectionRightGeometry,
        reprojectionRightGeometryLayer
    );
const reprojectionGpuCanvas = document.getElementById("reprojection-gpu");
const reprojectionGaussianCanvas = document.getElementById(
    "reprojection-gaussian"
);
const reprojectionDivider = document.getElementById("reprojection-divider");
const reprojectionLayout = document.getElementById("reprojection-layout");
const reprojectionSourceLabelMode = document.getElementById(
    "reprojection-source-label-mode"
);
const reprojectionSplitAngle = document.getElementById("reprojection-split-angle");
const reprojectionShowOutsideFrame = document.getElementById(
    "reprojection-show-outside-frame"
);
const reprojectionColor = document.getElementById("reprojection-color");
const reprojectionPointSize = document.getElementById("reprojection-point-size");
const reprojectionMeshShading = document.getElementById(
    "reprojection-mesh-shading"
);
const reprojectionMeshColor = document.getElementById(
    "reprojection-mesh-color"
);
const reprojectionMeshColorField = document.getElementById(
    "reprojection-mesh-color-field"
);
const reprojectionMeshBrightness = document.getElementById(
    "reprojection-mesh-brightness"
);
const reprojectionMeshBrightnessValue = document.getElementById(
    "reprojection-mesh-brightness-value"
);
const reprojectionGsplatField = document.getElementById(
    "reprojection-gsplat-field"
);
const reprojectionGsplatAa = document.getElementById("reprojection-gsplat-aa");
const reprojectionGsplatKernel = document.getElementById(
    "reprojection-gsplat-kernel"
);
const reprojectionBackgroundTop = document.getElementById(
    "reprojection-background-top"
);
const reprojectionBackgroundBottom = document.getElementById(
    "reprojection-background-bottom"
);
const reprojectionFlip = document.getElementById("reprojection-flip");
const reprojectionMaskField = document.getElementById("reprojection-mask-field");
const reprojectionMask = document.getElementById("reprojection-mask");
const reprojectionInvertMask = document.getElementById(
    "reprojection-invert-mask"
);
const reprojectionResetView = document.getElementById("reprojection-reset-view");
const reprojectionResetDivider = document.getElementById("reprojection-reset-divider");
const reprojectionResetClipping = document.getElementById(
    "reprojection-reset-clipping"
);
const reprojectionLeftSource = document.getElementById("reprojection-left-source");
const reprojectionRightSource = document.getElementById("reprojection-right-source");
const reprojectionLeftSourcePicker = document.getElementById(
    "reprojection-left-source-picker"
);
const reprojectionRightSourcePicker = document.getElementById(
    "reprojection-right-source-picker"
);
const reprojectionSourceBadges = {
    left: [...document.querySelectorAll(
        '[data-reprojection-source-badge="left"]'
    )],
    right: [...document.querySelectorAll(
        '[data-reprojection-source-badge="right"]'
    )],
};
const reprojectionGeometryDrop = document.getElementById("reprojection-geometry-drop");
const reprojectionGeometryFile = document.getElementById("reprojection-geometry-file");
const reprojectionGeometryStatus = document.getElementById("reprojection-geometry-status");
const reprojectionGeometrySummary = document.getElementById("reprojection-geometry-summary");
const reprojectionClearGeometries = document.getElementById(
    "reprojection-clear-geometries"
);
const reprojectionLocalPath = document.getElementById("reprojection-local-path");
const reprojectionLoadLocalPath = document.getElementById(
    "reprojection-load-local-path"
);

const reprojectionStreamStorageKey = "colmap-viewer-reprojection-stream-v1";
const reprojectionUploadGenerationKey = "colmap-viewer-upload-generation-v1";
const paneSources = ReprojectionPaneSources;
const configuredGeometryLoadResult = Object.freeze({
    loaded: "loaded",
    deferred: "deferred",
    failed: "failed",
});
const reprojectionTransitionDebugMs = Math.max(0, Math.min(
    10_000,
    Number(new URLSearchParams(window.location.search).get(
        "gpu_transition_debug_ms"
    )) || 0
));
let reprojectionTransitionDebugBadge = null;

async function pauseReprojectionGpuTransitionDebug(message, isCurrent) {
    if (reprojectionTransitionDebugMs <= 0) {
        return isCurrent();
    }
    if (!reprojectionTransitionDebugBadge) {
        reprojectionTransitionDebugBadge = document.createElement("div");
        reprojectionTransitionDebugBadge.className =
            "reprojection-transition-debug";
        reprojectionViewer.appendChild(reprojectionTransitionDebugBadge);
    }
    reprojectionTransitionDebugBadge.textContent = message;
    reprojectionTransitionDebugBadge.hidden = false;
    console.info(`[GPU transition] ${message}`);
    await new Promise(resolve => {
        window.setTimeout(resolve, reprojectionTransitionDebugMs);
    });
    const current = isCurrent();
    if (!current) {
        clearReprojectionGpuTransitionDebug();
    }
    return current;
}

function clearReprojectionGpuTransitionDebug() {
    if (reprojectionTransitionDebugBadge) {
        reprojectionTransitionDebugBadge.hidden = true;
    }
}

const builtInReprojectionSourceLabels = {
    image: "Camera image",
    colmap: "COLMAP points",
};

function reprojectionSourceLabel(source) {
    if (source in builtInReprojectionSourceLabels) {
        return builtInReprojectionSourceLabels[source];
    }
    return reprojectionState.loadedGeometries.find(
        geometry => geometry.gpuKey === source
    )?.label || "geometry";
}

const reprojectionSourceBadgeTimers = {left: null, right: null};

function showReprojectionSourceBadge(pane, source) {
    window.clearTimeout(reprojectionSourceBadgeTimers[pane]);
    reprojectionSourceBadgeTimers[pane] = null;
    const display = paneSources.sourceLabelDisplay(
        reprojectionSourceLabelMode.value
    );
    const label = reprojectionSourceLabel(source);
    for (const badge of reprojectionSourceBadges[pane]) {
        badge.textContent = label;
        badge.title = label;
        badge.classList.toggle("visible", display.visible);
    }
    if (display.timeoutMs === null) {
        return;
    }
    reprojectionSourceBadgeTimers[pane] = window.setTimeout(() => {
        for (const badge of reprojectionSourceBadges[pane]) {
            badge.classList.remove("visible");
        }
        reprojectionSourceBadgeTimers[pane] = null;
    }, display.timeoutMs);
}

function showReprojectionSourceBadges() {
    showReprojectionSourceBadge("left", reprojectionState.leftSource);
    showReprojectionSourceBadge("right", reprojectionState.rightSource);
}

async function recoverFromLateIdentityCollision(replacementStream) {
    if (reprojectionIdentity.id !== replacementStream) {
        return;
    }
    cancelConfiguredGeometryLoads();
    supersedeGeometryLoad({clearDropState: true});
    reprojectionState.generation += 1;
    reprojectionState.pointGeneration += 1;
    reprojectionState.prefetchInFlight.clear();
    await initializeReprojectionCapability();
    if (reprojectionState.loaded) {
        loadReprojectionFrame(reprojectionState.currentIndex);
    }
}

const reprojectionIdentity = new ViewerStreamIdentity({
    storageKey: reprojectionStreamStorageKey,
    onLateCollision: recoverFromLateIdentityCollision,
});
const reprojectionIdentityReady = reprojectionIdentity.ready;
const reprojectionApi = new ReprojectionApi(() => reprojectionIdentity.id);
let reprojectionUploadGeneration = Number(
    ViewerStreamIdentity.readSession(reprojectionUploadGenerationKey) || 0
);
if (!Number.isSafeInteger(reprojectionUploadGeneration)
        || reprojectionUploadGeneration < 0) {
    reprojectionUploadGeneration = 0;
}
let reprojectionUploadController = null;
let activeGeometryLoadOperation = null;
let reprojectionImagesLoadPromise = null;

const reprojectionState = {
    images: [],
    datasetNamespace: "uninitialized",
    geometryCacheToken: "colmap",
    rightServerGeometryCacheToken: "colmap",
    geometryKind: "colmap",
    loaded: false,
    currentIndex: 0,
    generation: 0,
    pointGeneration: 0,
    serverSelectionGeneration: 0,
    serverSelectionPending: false,
    splitPercent: 50,
    splitAngle: 0,
    viewScale: 1,
    viewTranslateX: 0,
    viewTranslateY: 0,
    nearClipFraction: 0,
    farClipFraction: 1,
    maxSize: 1600,
    maxRenderSize: null,
    maxInputSize: 8192,
    masksConfigured: false,
    navigationPointTimer: null,
    pointSizeRenderTimer: null,
    zoomDetailTimer: null,
    meshBrightnessTimer: null,
    backgroundColors: {
        surface: {top: "#ffffff", bottom: "#747474"},
        gaussian: {top: "#000000", bottom: "#000000"},
    },
    prefetchInFlight: new Map(),
    navigationHoldKey: null,
    navigationHoldDelay: null,
    navigationHoldInterval: null,
    navigationRepeatDelay: 110,
    navigationSession: 0,
    frameLoadResolve: null,
    navigationPreview: false,
    navigationPreviewSize: 768,
    currentInputUrl: null,
    currentRenderUrl: null,
    currentRenderView: null,
    renderMode: "server",
    configuredGeometries: [],
    browserGeometryLoading: false,
    pointRenderedView: {scale: 1, translateX: 0, translateY: 0},
    gpuRenderedView: {scale: 1, translateX: 0, translateY: 0},
    gpuFallbackRenderedView: {scale: 1, translateX: 0, translateY: 0},
    gpuFallbackReady: false,
    gpuFrameRequest: 0,
    gpuRenderedSource: null,
    leftCapturedSource: null,
    rightRenderedView: {scale: 1, translateX: 0, translateY: 0},
    rightRenderedSource: "image",
    rightRenderedMode: "independent",
    rightRenderedFrameKey: null,
    colmapGpuKey: null,
    colmapGpuPointCount: 0,
    colmapGpuLoadPromise: null,
    colmapGpuLoadGeneration: 0,
    loadedGeometries: [],
    configuredGeometryLoads: new Map(),
    configuredGeometryLoadQueue: Promise.resolve(),
    configuredGeometryQueueGeneration: 0,
    leftSource: "colmap",
    rightSource: "image",
    geometryFrameCache: new Map(),
};

let reprojectionGpuRenderer = null;
const clippingRenderScheduler = new ReprojectionLatestTaskScheduler();
const rightServerFrameRequests = new ReprojectionLatestRequestGuard();
let lastClippingWheelTime = -Infinity;
let lastClippingWheelPlane = null;

function rightServerRequestStream() {
    return `${reprojectionIdentity.id}:right`;
}

function getReprojectionGpuRenderer() {
    if (!reprojectionGpuRenderer) {
        if (!globalThis.ReprojectionGpu?.ReprojectionGpuRenderer) {
            throw new Error("The browser GPU renderer did not load");
        }
        reprojectionGpuRenderer = new ReprojectionGpu.ReprojectionGpuRenderer(
            reprojectionGpuCanvas, reprojectionGaussianCanvas
        );
        reprojectionGpuRenderer.setPointSize(reprojectionPointSize.value);
        reprojectionGpuRenderer.setPointColorMode(reprojectionColor.value);
        reprojectionGpuRenderer.setClippingRange(
            reprojectionState.nearClipFraction,
            reprojectionState.farClipFraction
        );
    }
    return reprojectionGpuRenderer;
}

function currentReprojectionImage() {
    return reprojectionState.images[reprojectionState.currentIndex] || null;
}

function maskedInputEnabled(image = currentReprojectionImage()) {
    return Boolean(reprojectionMask.checked && image?.has_mask);
}

function syncReprojectionMaskControl() {
    const available = Boolean(currentReprojectionImage()?.has_mask);
    reprojectionMaskField.hidden = !reprojectionState.masksConfigured;
    reprojectionMask.disabled = !available;
    reprojectionInvertMask.disabled = !available;
    reprojectionMask.title = available
        ? "Black out pixels where the image mask is zero"
        : "No mask is available for this image";
    reprojectionInvertMask.title = available
        ? "Reverse which mask values retain the input image"
        : "No mask is available for this image";
}

function refreshReprojectionInputMask() {
    const image = currentReprojectionImage();
    if (!image) {
        return;
    }
    const urls = reprojectionUrls(
        image,
        reprojectionIdentity.id,
        currentZoomDetailMaxSize(image)
    );
    reprojectionState.currentInputUrl = urls.input;
    if (paneSources.isImage(reprojectionState.rightSource)) {
        refreshReprojectionInputVisibility();
    }
}

function sourceRenderPath(source, image = currentReprojectionImage()) {
    const geometry = reprojectionState.loadedGeometries.find(
        loaded => loaded.gpuKey === source
    );
    if (geometry?.renderPath === "server"
            || (geometry?.configuredGeometry
                && image
                && !ReprojectionGpu.isPinholeCamera(image))) {
        return "server";
    }
    return paneSources.renderPath(source, {
        colmapGpuReady: Boolean(reprojectionState.colmapGpuKey),
        cameraSupported: Boolean(
            image && ReprojectionGpu.isPinholeCamera(image)
        ),
    });
}

function sourceUsesGpu(source, image = currentReprojectionImage()) {
    return sourceRenderPath(source, image) === "gpu";
}

function sourceUsesServer(source, image = currentReprojectionImage()) {
    return sourceRenderPath(source, image) === "server";
}

function gpuGeometryKey(source) {
    return paneSources.isColmap(source)
        ? reprojectionState.colmapGpuKey : source;
}

function hasGpuCompatibleColmapCamera() {
    return reprojectionState.images.some(ReprojectionGpu.isPinholeCamera);
}

function invalidateColmapGpuGeometry() {
    reprojectionState.colmapGpuLoadGeneration += 1;
    reprojectionState.colmapGpuKey = null;
    reprojectionState.colmapGpuPointCount = 0;
    reprojectionState.colmapGpuLoadPromise = null;
}

function ensureColmapGpuGeometry() {
    if (reprojectionState.colmapGpuKey) {
        return Promise.resolve(true);
    }
    if (reprojectionState.colmapGpuLoadPromise) {
        return reprojectionState.colmapGpuLoadPromise;
    }
    if (!hasGpuCompatibleColmapCamera()) {
        return Promise.resolve(false);
    }
    const loadGeneration = ++reprojectionState.colmapGpuLoadGeneration;
    const isCurrent = () =>
        loadGeneration === reprojectionState.colmapGpuLoadGeneration;
    const loadPromise = (async () => {
        try {
            const bytes = await reprojectionApi.colmapPoints();
            if (!isCurrent()) {
                return false;
            }
            const renderer = getReprojectionGpuRenderer();
            await renderer.ready;
            if (!isCurrent()) {
                return false;
            }
            const loaded = await renderer.loadArrayBuffer(
                bytes, "point cloud", isCurrent
            );
            if (!loaded || !isCurrent()) {
                if (loaded?.key) {
                    await renderer.disposeGeometry(loaded.key);
                }
                return false;
            }
            reprojectionState.colmapGpuKey = loaded.key;
            reprojectionState.colmapGpuPointCount = loaded.count;
            clearGeometryFrameCache();
            if (document.body.dataset.viewerMode === "reprojection"
                    && (paneSources.isColmap(reprojectionState.leftSource)
                        || paneSources.isColmap(reprojectionState.rightSource))) {
                refreshReprojectionPanes();
            }
            return true;
        } catch (error) {
            if (isCurrent()) {
                console.warn(
                    "Using the server COLMAP renderer because browser point "
                    + `loading failed: ${error.message}`
                );
            }
            return false;
        } finally {
            if (isCurrent()
                    && reprojectionState.colmapGpuLoadPromise === loadPromise) {
                reprojectionState.colmapGpuLoadPromise = null;
            }
        }
    })();
    reprojectionState.colmapGpuLoadPromise = loadPromise;
    return loadPromise;
}

function reprojectionSourceInfo(source) {
    const label = reprojectionSourceLabel(source);
    if (paneSources.isImage(source)) {
        return {
            label,
            filename: reprojectionState.images[
                reprojectionState.currentIndex
            ]?.name || "",
            path: "",
        };
    }
    const geometry = reprojectionState.loadedGeometries.find(
        loaded => loaded.gpuKey === source
    );
    return {
        label,
        filename: geometry?.filename || "",
        path: geometry?.path || "",
    };
}

const paneSourcePickers = {
    left: new ReprojectionSourcePicker({
        select: reprojectionLeftSource,
        picker: reprojectionLeftSourcePicker,
        cycleIndex: paneSources.cycleIndex,
        onSelect: () => applyPaneSource("left"),
        onRename: renameReprojectionSource,
        onInfo: reprojectionSourceInfo,
    }),
    right: new ReprojectionSourcePicker({
        select: reprojectionRightSource,
        picker: reprojectionRightSourcePicker,
        cycleIndex: paneSources.cycleIndex,
        onSelect: () => applyPaneSource("right"),
        onRename: renameReprojectionSource,
        onInfo: reprojectionSourceInfo,
    }),
};

function renameReprojectionSource(source, requestedLabel) {
    const geometry = reprojectionState.loadedGeometries.find(
        loaded => loaded.gpuKey === source
    );
    if (!geometry && !(source in builtInReprojectionSourceLabels)) {
        return;
    }
    const label = String(requestedLabel || "").trim();
    if (!label) {
        return;
    }
    // Labels are presentation only; stable source keys distinguish geometry.
    // Preserve intentional duplicate names while automatic labels remain unique.
    if (geometry) {
        geometry.label = label;
    } else {
        builtInReprojectionSourceLabels[source] = label;
    }
    rebuildPaneSourceOptions();
    if (reprojectionState.leftSource === source
            || reprojectionState.rightSource === source) {
        showReprojectionSourceBadges();
    }
}

function rebuildPaneSourceOptions() {
    const geometries = reprojectionState.loadedGeometries;
    const defaultHiddenSources = new Set(
        geometries.filter(geometry => geometry.hiddenByDefault)
            .map(geometry => geometry.gpuKey)
    );
    const leftValue = reprojectionLeftSource.value;
    const rightValue = reprojectionRightSource.value;

    reprojectionLeftSource.innerHTML = "";
    reprojectionRightSource.innerHTML = "";

    const leftColmap = document.createElement("option");
    leftColmap.value = "colmap";
    leftColmap.textContent = reprojectionSourceLabel("colmap");
    leftColmap.dataset.renamable = "true";
    reprojectionLeftSource.appendChild(leftColmap);

    const rightImage = document.createElement("option");
    rightImage.value = "image";
    rightImage.textContent = reprojectionSourceLabel("image");
    rightImage.dataset.renamable = "true";
    reprojectionRightSource.appendChild(rightImage);
    const rightColmap = document.createElement("option");
    rightColmap.value = "colmap";
    rightColmap.textContent = reprojectionSourceLabel("colmap");
    rightColmap.dataset.renamable = "true";
    reprojectionRightSource.appendChild(rightColmap);

    for (const geo of geometries) {
        const leftOpt = document.createElement("option");
        leftOpt.value = geo.gpuKey;
        leftOpt.textContent = geo.label;
        leftOpt.title = geo.name;
        leftOpt.dataset.renamable = "true";
        reprojectionLeftSource.appendChild(leftOpt);

        const rightOpt = document.createElement("option");
        rightOpt.value = geo.gpuKey;
        rightOpt.textContent = geo.label;
        rightOpt.title = geo.name;
        rightOpt.dataset.renamable = "true";
        reprojectionRightSource.appendChild(rightOpt);
    }

    reprojectionLeftSource.value = leftValue;
    if (!reprojectionLeftSource.value) {
        reprojectionLeftSource.value = geometries.length
            ? geometries[geometries.length - 1].gpuKey : "colmap";
    }
    reprojectionRightSource.value = rightValue;
    if (!reprojectionRightSource.value) {
        reprojectionRightSource.value = "image";
    }
    paneSourcePickers.left.sync(defaultHiddenSources);
    paneSourcePickers.right.sync(defaultHiddenSources);
}

function applyPaneSource(pane) {
    const value = pane === "left"
        ? reprojectionLeftSource.value
        : reprojectionRightSource.value;
    if (pane === "left") {
        reprojectionState.leftSource = value;
    } else {
        reprojectionState.rightSource = value;
    }
    showReprojectionSourceBadges();
    paneSourcePickers[pane].sync();
    refreshReprojectionPanes();
}

function cyclePaneSource(pane, direction = 1) {
    paneSourcePickers[pane].cycle(direction);
}

function configuredGeometryForSource(source) {
    return reprojectionState.loadedGeometries.find(
        loaded => loaded.gpuKey === source
    )?.configuredGeometry || null;
}

async function selectServerSource(source, stream) {
    if (paneSources.isColmap(source)) {
        return reprojectionApi.resetGeometry(stream);
    }
    const configuredGeometry = configuredGeometryForSource(source);
    if (!configuredGeometry) {
        throw new Error("The selected server geometry is unavailable");
    }
    return activateConfiguredServerGeometry(configuredGeometry, stream);
}

async function selectServerSourcesForVisiblePanes(frameGeneration) {
    const selectionGeneration = ++reprojectionState.serverSelectionGeneration;
    reprojectionState.serverSelectionPending = true;
    const leftSource = reprojectionState.leftSource;
    const rightSource = reprojectionState.rightSource;
    const leftUsesServer = sourceUsesServer(leftSource);
    const rightUsesServer = sourceUsesServer(rightSource);
    try {
        const [leftGeometry, rightGeometry] = await Promise.all([
            leftUsesServer
                ? selectServerSource(leftSource, reprojectionIdentity.id)
                : null,
            rightUsesServer
                ? selectServerSource(rightSource, rightServerRequestStream())
                : null,
        ]);
        if (selectionGeneration !== reprojectionState.serverSelectionGeneration
                || frameGeneration !== reprojectionState.generation) {
            return;
        }
        if (leftUsesServer && reprojectionState.leftSource === leftSource) {
            applyGeometryStatus(leftGeometry);
            requestReprojectionPointLayer(frameGeneration);
        }
        if (rightUsesServer && reprojectionState.rightSource === rightSource) {
            reprojectionState.rightServerGeometryCacheToken =
                rightGeometry.cache_token;
            renderReprojectionRightPaneServer(frameGeneration);
        }
    } catch (error) {
        if (selectionGeneration === reprojectionState.serverSelectionGeneration
                && frameGeneration === reprojectionState.generation) {
            setReprojectionStatus(
                `Failed to select server geometry: ${error.message}`, true
            );
        }
    } finally {
        if (selectionGeneration === reprojectionState.serverSelectionGeneration) {
            reprojectionState.serverSelectionPending = false;
        }
    }
}

function refreshReprojectionPanes() {
    const leftSource = reprojectionState.leftSource;
    const rightSource = reprojectionState.rightSource;
    const generation = reprojectionState.generation;

    const leftIsGpu = sourceUsesGpu(leftSource);
    const rightIsGpu = sourceUsesGpu(rightSource);
    const rightSourcePending =
        reprojectionState.rightRenderedSource !== rightSource;
    const rightPresentationMode = ReprojectionGpuCanvas.rightPresentationMode({
        selectedSource: rightSource,
        renderedSource: reprojectionState.rightRenderedSource,
        renderedMode: reprojectionState.rightRenderedMode,
        leftSelectedSource: leftSource,
        leftRenderedSource: reprojectionState.gpuRenderedSource,
        selectedIsGpu: rightIsGpu,
        leftIsGpu,
        sharesLeftSurface: reprojectionLayout.value === "split",
    });
    if (rightPresentationMode === "same") {
        reprojectionState.rightRenderedSource = rightSource;
        reprojectionState.rightRenderedView = {
            ...reprojectionState.gpuRenderedView,
        };
        commitRightPanePresentation(rightSource, "same");
    } else if (rightPresentationMode === "independent") {
        reprojectionInputLayer.classList.remove("same-geometry");
    }
    if (leftIsGpu) {
        const outgoingPointCloud = activeReprojectionCloud();
        const transitioningFromPointRender =
            reprojectionState.renderMode === "server"
            && Boolean(outgoingPointCloud.getAttribute("src"))
            && outgoingPointCloud.style.visibility !== "hidden";
        const sourceAlreadyVisible =
            reprojectionState.gpuRenderedSource === leftSource;
        const canKeepCurrentFrame =
            reprojectionGpuCanvas.classList.contains("active")
            || reprojectionGaussianCanvas.classList.contains("active");
        const canvasTransition = ReprojectionGpuCanvas.sourceTransition(
            sourceAlreadyVisible, canKeepCurrentFrame
        );
        if (canvasTransition === "disable") {
            disableReprojectionGpuCanvas();
        } else if (canvasTransition === "keep") {
            holdReprojectionGpuTransitionFrame();
        }
        if (transitioningFromPointRender) {
            holdReprojectionPointTransitionFrame(outgoingPointCloud);
        }
        reprojectionState.renderMode = "gpu";
        const geo = reprojectionState.loadedGeometries.find(
            g => g.gpuKey === leftSource
        );
        if (paneSources.isColmap(leftSource)) {
            applyGeometryStatus({
                name: "COLMAP points3D",
                kind: "colmap",
                point_count: reprojectionState.colmapGpuPointCount,
                cache_token: "browser-colmap",
                gpu: true,
            });
        } else if (geo) {
            applyGeometryStatus({
                name: geo.name,
                kind: geo.kind,
                point_count: geo.count,
                cache_token: `browser-${leftSource}`,
                gpu: true,
            });
        }
        // Keep the currently active engine canvas visible while a different
        // source renders into its own canvas. Switching canvases here would
        // expose an unrendered (usually black) destination frame.
        if (canvasTransition === "attach") {
            attachReprojectionGpuCanvas();
        }
        const renderRightOnly =
            ReprojectionGpuCanvas.shouldRenderRightOnly({
                rightIsGpu,
                leftSelectedSource: leftSource,
                leftPresentedSource: reprojectionState.leftCapturedSource,
                leftPresentationActive:
                    reprojectionLeftGeometry.classList.contains("active"),
                rightSourcePending,
            });
        if (renderRightOnly) {
            renderReprojectionRightPane(generation);
        }
        // Do not redraw or uncover an already-correct left canvas when the
        // right pane can render independently or is awaiting a raster frame.
        // The right commit path replaces the retained pane when ready.
        if (!renderRightOnly
                && !(rightSourcePending && !rightIsGpu
                    && sourceAlreadyVisible)) {
            renderReprojectionGpuFrame(generation);
        }
    } else if (sourceUsesServer(leftSource)) {
        reprojectionState.renderMode = "server";
        // A point render is asynchronous. Retain any completed GPU frame
        // until the server image is decoded and presented; this also avoids
        // a black intermediate frame when keyboard cycling continues from a
        // mesh through COLMAP points to Gaussian splats.
        const hasVisibleGpuFrame =
            reprojectionGpuCanvas.classList.contains("active")
            || reprojectionGaussianCanvas.classList.contains("active")
            || reprojectionGpuFallback.classList.contains("active");
        if (!hasVisibleGpuFrame) {
            disableReprojectionGpuCanvas();
        }
    }

    if (rightIsGpu && !leftIsGpu) {
        renderReprojectionRightPane(generation);
    } else if (paneSources.isImage(rightSource)) {
        refreshReprojectionInputVisibility();
    }
    if (sourceUsesServer(leftSource) || sourceUsesServer(rightSource)) {
        selectServerSourcesForVisiblePanes(generation);
    }
}

function refreshReprojectionInputVisibility() {
    const rightSource = reprojectionState.rightSource;
    const inputElement = activeReprojectionInput();
    if (paneSources.isImage(rightSource)) {
        if (reprojectionState.currentInputUrl) {
            const url = reprojectionState.currentInputUrl;
            const generation = reprojectionState.generation;
            const preload = new Image();
            preload.onload = () => {
                if (generation !== reprojectionState.generation
                        || reprojectionState.currentInputUrl !== url
                        || !paneSources.isImage(reprojectionState.rightSource)) {
                    return;
                }
                const target = activeReprojectionInput();
                target.src = url;
                reprojectionState.rightRenderedSource = "image";
                commitRightPanePresentation("image", "independent");
                target.style.visibility = "";
                applyReprojectionViewTransform();
            };
            preload.src = url;
            return;
        }
        inputElement.style.visibility = "";
        reprojectionState.rightRenderedSource = "image";
        commitRightPanePresentation("image", "independent");
    }
}

function geometryFrameCacheKey(source, width, height, renderedView) {
    return JSON.stringify([
        source,
        gpuGeometryKey(source),
        reprojectionState.currentIndex,
        width,
        height,
        renderedView.scale,
        renderedView.translateX,
        renderedView.translateY,
        reprojectionState.nearClipFraction,
        reprojectionState.farClipFraction,
        confineGeometryToImageFrame(),
        reprojectionMeshShading.value,
        reprojectionMeshColor.value,
        reprojectionMeshBrightness.value,
        reprojectionPointSize.value,
        reprojectionColor.value,
        reprojectionGsplatAa.checked,
        reprojectionGsplatKernel.value,
    ]);
}

function cacheGeometryFrame(key, frame) {
    const cache = reprojectionState.geometryFrameCache;
    const pixels = frame.width * frame.height;
    if (pixels > 16_000_000) {
        return false;
    }
    const previous = cache.get(key);
    if (previous && previous !== frame) {
        previous.close?.();
    }
    cache.delete(key);
    cache.set(key, frame);
    const cachedPixels = () => [...cache.values()].reduce(
        (total, cached) => total + cached.width * cached.height, 0
    );
    while (cache.size > 8 || cachedPixels() > 32_000_000) {
        const oldestKey = cache.keys().next().value;
        cache.get(oldestKey)?.close?.();
        cache.delete(oldestKey);
    }
    return true;
}

function cachedGeometryFrame(key) {
    const cache = reprojectionState.geometryFrameCache;
    const frame = cache.get(key) || null;
    if (frame) {
        cache.delete(key);
        cache.set(key, frame);
    }
    return frame;
}

function clearGeometryFrameCache() {
    for (const frame of reprojectionState.geometryFrameCache.values()) {
        frame.close?.();
    }
    reprojectionState.geometryFrameCache.clear();
}

async function disposeAllGpuGeometry() {
    invalidateColmapGpuGeometry();
    try {
        if (reprojectionGpuRenderer) {
            await reprojectionGpuRenderer.disposeGeometry();
        }
    } finally {
        clearGeometryFrameCache();
    }
}

async function getGeometryFrame(
    renderer, source, image, renderSize, region, renderedView
) {
    const cacheKey = geometryFrameCacheKey(
        source, renderSize.width, renderSize.height, renderedView
    );
    let frame = cachedGeometryFrame(cacheKey);
    let disposable = false;
    if (!frame) {
        frame = await renderer.captureGeometryFrame(
            gpuGeometryKey(source),
            image, renderSize.width, renderSize.height, region,
            confineGeometryToImageFrame()
        );
        if (frame) {
            disposable = !cacheGeometryFrame(cacheKey, frame);
        }
    }
    return {frame, disposable, frameKey: cacheKey};
}

function installRightGeometryFrame(
    frame, source, renderedView, frameKey, isCurrent
) {
    if (!frame || !isCurrent()) {
        return false;
    }
    for (const canvas of [
        reprojectionRightGeometry, reprojectionRightGeometrySide,
    ]) {
        paintCapturedGeometryFrame(canvas, frame);
    }
    reprojectionState.rightRenderedView = {...renderedView};
    reprojectionState.rightRenderedSource = source;
    commitRightPanePresentation(source, "independent");
    reprojectionState.rightRenderedFrameKey = frameKey;
    applyRightPaneCaptureTransform(activeReprojectionRightGeometry());
    return true;
}

function paintCapturedGeometryFrame(canvas, frame) {
    canvas.width = frame.width;
    canvas.height = frame.height;
    const context = canvas.getContext("2d", {alpha: true});
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (typeof ImageData !== "undefined" && frame instanceof ImageData) {
        context.putImageData(frame, 0, 0);
    } else {
        context.drawImage(frame, 0, 0);
    }
}

function installLeftGeometryFrame(frame, source, renderedView, isCurrent) {
    if (!frame || !isCurrent()) {
        return false;
    }
    paintCapturedGeometryFrame(reprojectionLeftGeometry, frame);
    reprojectionState.gpuRenderedView = {...renderedView};
    reprojectionState.gpuRenderedSource = source;
    reprojectionState.leftCapturedSource = source;
    leftCapturedPresentation.setActive(true);
    applyLeftPaneCaptureTransform();
    return true;
}

async function renderReprojectionRightPane(generation) {
    const rightSource = reprojectionState.rightSource;
    if (!sourceUsesGpu(rightSource)) {
        return;
    }
    const image = reprojectionState.images[reprojectionState.currentIndex];
    if (!image) {
        return;
    }
    const renderer = getReprojectionGpuRenderer();
    if (!renderer.supportsCamera(image)) {
        return;
    }
    const display = reprojectionDisplaySize(image);
    if (display.width <= 0 || display.height <= 0) {
        return;
    }
    const renderSize = ReprojectionGpu.screenRenderSize(
        display.width,
        display.height,
        window.devicePixelRatio,
        Math.min(reprojectionState.maxInputSize, 8192)
    );
    configureGpuPointPixelScale(renderer, renderSize, display);
    const renderedView = currentReprojectionView();
    const region = ReprojectionGpu.zoomViewRegion(
        image,
        display.width,
        display.height,
        renderedView.scale,
        renderedView.translateX,
        renderedView.translateY
    );
    try {
        const {frame, disposable, frameKey} = await getGeometryFrame(
            renderer, rightSource, image, renderSize, region, renderedView
        );
        installRightGeometryFrame(
            frame,
            rightSource,
            renderedView,
            frameKey,
            () => generation === reprojectionState.generation
                && reprojectionState.rightSource === rightSource
        );
        if (disposable) {
            frame?.close?.();
        }
    } catch (error) {
        if (generation === reprojectionState.generation
                && reprojectionState.rightSource === rightSource) {
            setReprojectionStatus(
                `Failed to render the right pane: ${error.message}`, true
            );
        }
    }
}

function renderReprojectionRightPaneServer(generation) {
    const rightSource = reprojectionState.rightSource;
    if (!sourceUsesServer(rightSource)) {
        return;
    }
    const image = reprojectionState.images[reprojectionState.currentIndex];
    if (!image) {
        return;
    }
    const renderedView = currentReprojectionView();
    const request = rightServerFrameRequests.begin();
    const requestStream = rightServerRequestStream();
    const urls = reprojectionUrls(
        image, requestStream, currentPreviewMaxSize(), renderedView,
        reprojectionState.rightServerGeometryCacheToken
    );
    const preload = new Image();
    preload.onload = () => {
        if (generation !== reprojectionState.generation
                || !rightServerFrameRequests.isCurrent(request)
                || reprojectionState.rightSource !== rightSource
                || !sourceUsesServer(rightSource)) {
            return;
        }
        const inputElement = activeReprojectionInput();
        reprojectionState.rightRenderedView = {...renderedView};
        reprojectionState.rightRenderedSource = rightSource;
        inputElement.src = urls.render;
        commitRightPanePresentation(rightSource, "independent");
        inputElement.style.visibility = "";
        applyRightPaneCaptureTransform(inputElement);
    };
    preload.src = urls.render;
}

function applyRightGeometrySplit() {
    if (reprojectionLayout.value === "split") {
        reprojectionRightGeometryLayer.style.clipPath =
            reprojectionInputLayer.style.clipPath;
    }
}

const reprojectionInteraction = new ReprojectionInteraction({
    viewer: reprojectionViewer,
    splitElement: reprojectionSplit,
    inputLayer: reprojectionInputLayer,
    divider: reprojectionDivider,
    layoutControl: reprojectionLayout,
    angleControl: reprojectionSplitAngle,
    state: reprojectionState,
    splitGeometry: ReprojectionSplitGeometry,
    applyViewTransform: applyInteractiveReprojectionViewTransform,
    applySplitRender: applyRightGeometrySplit,
});

const reprojectionPointRequester = new ReprojectionPointRequester({
    state: reprojectionState,
    renderUrl: (image, view) => reprojectionUrls(
        image, reprojectionIdentity.id, currentPreviewMaxSize(), view
    ).render,
    captureView: currentReprojectionView,
    applySource: applyReprojectionRenderSource,
    applyViewTransform: applyReprojectionViewTransform,
    recoverGeometry: heartbeatReprojectionStream,
    reportFailure: image => {
        setReprojectionStatus(`Failed to render points for ${image.name}`, true);
    },
});

document.body.dataset.viewerMode = "matches";

function setReprojectionStatus(message, isError = false) {
    reprojectionStatus.textContent = message;
    reprojectionStatus.style.color = isError ? "#a00000" : "#666";
}

function hasClearableGeometry(kind = reprojectionState.geometryKind) {
    return reprojectionState.loadedGeometries.length > 0 || kind !== "colmap";
}

function applyGeometryStatus(geometry) {
    reprojectionState.geometryCacheToken = geometry.cache_token;
    reprojectionState.geometryKind = geometry.kind;
    const count = Number(geometry.point_count || 0).toLocaleString();
    const countLabel = geometry.gpu ? "vertices" : "rendered points";
    reprojectionGeometryStatus.textContent =
        `${geometry.name} — ${geometry.kind}, ${count} ${countLabel}`;
    reprojectionGeometrySummary.textContent = geometry.name;
    reprojectionGeometrySummary.title = geometry.name;
    reprojectionClearGeometries.disabled = !hasClearableGeometry(geometry.kind);
    const hasLoadedMesh = geometry.kind === "triangle mesh"
        || reprojectionState.loadedGeometries.some(
            loaded => loaded.kind === "triangle mesh"
        );
    const meshControlsDisabled = geometry.kind !== "triangle mesh";
    reprojectionMeshColorField.hidden = !hasLoadedMesh;
    reprojectionMeshShading.disabled = meshControlsDisabled;
    reprojectionMeshColor.disabled = !hasLoadedMesh;
    reprojectionMeshBrightness.disabled = meshControlsDisabled;
    reprojectionMeshBrightnessValue.disabled = meshControlsDisabled;
    const hasLoadedGaussian = geometry.kind === "gaussian splats"
        || reprojectionState.loadedGeometries.some(
            loaded => loaded.kind === "gaussian splats"
        );
    reprojectionGsplatField.hidden = !hasLoadedGaussian;
    syncReprojectionBackgroundControls(geometry.kind, Boolean(geometry.gpu));
}

function backgroundCategory(kind = reprojectionState.geometryKind) {
    return kind === "gaussian splats" ? "gaussian" : "surface";
}

function backgroundGradientForKind(kind) {
    const colors = reprojectionState.backgroundColors[backgroundCategory(kind)];
    return `linear-gradient(to bottom, ${colors.top}, ${colors.bottom})`;
}

function backgroundGradientForSource(source) {
    if (!paneSources.isGeometry(source)) {
        return "";
    }
    const geometry = reprojectionState.loadedGeometries.find(
        loaded => loaded.gpuKey === source
    );
    return backgroundGradientForKind(geometry?.kind || "point cloud");
}

function syncRightPaneBackground(source) {
    const background = backgroundGradientForSource(source);
    for (const element of [
        reprojectionInput,
        reprojectionInputSide,
        reprojectionRightGeometrySide,
    ]) {
        element.style.background = background;
    }
    reprojectionRightGeometry.style.background = "";
    reprojectionRightGeometryLayer.style.background = background;
    if (background) {
        reprojectionInputLayer.style.setProperty(
            "--reprojection-right-bg", background
        );
    } else {
        reprojectionInputLayer.style.removeProperty("--reprojection-right-bg");
    }
}

function commitRightPanePresentation(source, mode = "independent") {
    reprojectionState.rightRenderedMode = mode;
    const layerState = ReprojectionGpuCanvas.rightLayerState({
        sourceIsGeometry: paneSources.isGeometry(source),
        sourceIsGpu: sourceUsesGpu(source),
        mode,
    });
    if (!layerState.captureActive) {
        reprojectionState.rightRenderedFrameKey = null;
    }
    reprojectionInputLayer.classList.toggle(
        "geometry-active", layerState.geometryActive
    );
    reprojectionInputLayer.classList.toggle(
        "gpu-independent", layerState.gpuIndependent
    );
    rightCapturedPresentation.setActive(layerState.captureActive);
    reprojectionRightGeometrySide.classList.toggle(
        "active", layerState.captureActive
    );
    syncRightPaneBackground(source);
    const rasterVisibility = layerState.rasterVisible ? "" : "hidden";
    reprojectionInput.style.visibility = rasterVisibility;
    reprojectionInputSide.style.visibility = rasterVisibility;
    reprojectionInputLayer.classList.toggle(
        "same-geometry", layerState.sameGeometry
    );
}

function syncReprojectionBackgroundControls(kind, gpuEnabled) {
    const colors = reprojectionState.backgroundColors[backgroundCategory(kind)];
    reprojectionBackgroundTop.value = colors.top;
    reprojectionBackgroundBottom.value = colors.bottom;
    reprojectionBackgroundTop.disabled = !gpuEnabled;
    reprojectionBackgroundBottom.disabled = !gpuEnabled;
    if (gpuEnabled) {
        reprojectionViewer.style.setProperty(
            "--reprojection-bg",
            backgroundGradientForKind(kind)
        );
    }
}

async function initializeReprojectionCapability() {
    await reprojectionIdentityReady;
    try {
        const capabilities = await reprojectionApi.capabilities();
        reprojectionState.datasetNamespace = capabilities.dataset_namespace;
        reprojectionState.maxRenderSize = capabilities.max_reprojection_size;
        reprojectionState.maxInputSize = capabilities.max_input_size || 4096;
        reprojectionState.masksConfigured = Boolean(capabilities.image_masks);
        syncReprojectionMaskControl();
        reprojectionState.configuredGeometries =
            capabilities.configured_geometries
            || (capabilities.configured_geometry
                ? [capabilities.configured_geometry] : []);
        applyGeometryStatus(capabilities.geometry);
        if (!capabilities.reprojection) {
            const option = viewerModeSelect.querySelector('option[value="reprojection"]');
            option.disabled = true;
            option.textContent = "3D reprojection (sparse model required)";
        }
    } catch (error) {
        console.error("Unable to query viewer capabilities:", error);
    }
}

async function setViewerMode(mode) {
    const isReprojection = mode === "reprojection";
    if (isReprojection) {
        await Promise.all([
            reprojectionIdentityReady,
            reprojectionCapabilityReady,
        ]);
    }
    document.body.dataset.viewerMode = mode;
    matchingControls.hidden = isReprojection;
    matchingViewer.hidden = isReprojection;
    reprojectionControls.hidden = !isReprojection;
    reprojectionViewer.hidden = !isReprojection;

    if (isReprojection) {
        const bounds = reprojectionViewer.getBoundingClientRect();
        const displayPixels = Math.max(bounds.width, bounds.height)
            * Math.min(window.devicePixelRatio || 1, 2);
        reprojectionState.maxSize = Math.max(
            640, Math.min(1600, Math.ceil(displayPixels / 64) * 64)
        );
        await ensureReprojectionImages();
        fitReprojectionSplit();
    } else {
        stopContinuousNavigation(false);
        // Let the existing viewer recompute canvas dimensions after becoming visible.
        window.dispatchEvent(new Event("resize"));
    }
}

async function loadReprojectionImages() {
    setReprojectionStatus("Loading registered images…");
    try {
        reprojectionState.images = await reprojectionApi.images();
        if (!reprojectionState.images.length) {
            throw new Error("The sparse model has no registered images.");
        }
        reprojectionImageSelect.innerHTML = "";
        reprojectionState.images.forEach((image, index) => {
            const option = document.createElement("option");
            option.value = image.id;
            option.textContent = `${index}: ${image.name}`;
            reprojectionImageSelect.appendChild(option);
        });
        reprojectionState.loaded = true;
        void ensureColmapGpuGeometry();

        // When possible, carry Image 1 across from match mode.
        const matchImageId = image1Select.value;
        const matchingIndex = reprojectionState.images.findIndex(
            image => String(image.id) === String(matchImageId)
        );
        reprojectionState.currentIndex = matchingIndex >= 0 ? matchingIndex : 0;
        reprojectionImageSelect.selectedIndex = reprojectionState.currentIndex;
        syncReprojectionMaskControl();
        loadInitialReprojectionFrameIfVisible();
    } catch (error) {
        setReprojectionStatus(error.message, true);
    }
}

async function loadConfiguredGeometryForReprojection() {
    const configuredGeometries = reprojectionState.configuredGeometries;
    if (!configuredGeometries.length) {
        return;
    }
    try {
        let loadFailed = false;
        for (const configuredGeometry of configuredGeometries) {
            const result = await loadConfiguredReprojectionGeometry(
                configuredGeometry
            );
            loadFailed ||= result !== configuredGeometryLoadResult.loaded;
        }
        if (sourceUsesServer(reprojectionState.leftSource)) {
            refreshReprojectionPanes();
        }
        if (loadFailed && reprojectionState.renderMode === "server") {
            requestReprojectionPointLayer(reprojectionState.generation);
        }
    } catch (error) {
        setReprojectionStatus(error.message, true);
    }
}

function loadInitialReprojectionFrameIfVisible() {
    if (document.body.dataset.viewerMode === "reprojection"
            && reprojectionState.loaded
            && !reprojectionState.currentInputUrl) {
        loadReprojectionFrame(reprojectionState.currentIndex);
    }
}

async function ensureReprojectionImages(loadFrame = true) {
    if (!reprojectionState.loaded && !reprojectionImagesLoadPromise) {
        reprojectionImagesLoadPromise = loadReprojectionImages()
            .finally(() => {
                reprojectionImagesLoadPromise = null;
            });
    }
    if (loadFrame) {
        // Geometry preloading may still own the shared promise. Do not make
        // the visible camera image wait for that longer operation.
        loadInitialReprojectionFrameIfVisible();
    }
    if (reprojectionImagesLoadPromise) {
        await reprojectionImagesLoadPromise;
    }
    if (loadFrame) {
        loadInitialReprojectionFrameIfVisible();
        // Parsing and GPU upload are exact but resource-intensive. Run them
        // only for the visible reprojection viewer so matching stays smooth.
        await loadConfiguredGeometryForReprojection();
    }
}

function previewSize(image, maxSize = reprojectionState.maxSize) {
    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    return {
        width: Math.max(1, Math.round(image.width * scale)),
        height: Math.max(1, Math.round(image.height * scale)),
    };
}

function fitReprojectionSplit() {
    if (!reprojectionState.images.length
            || reprojectionViewer.hidden
            || reprojectionLayout.value === "side") {
        return;
    }
    const image = reprojectionState.images[reprojectionState.currentIndex];
    const preview = previewSize(image);
    const bounds = reprojectionViewer.getBoundingClientRect();
    const scale = Math.min(bounds.width / preview.width, bounds.height / preview.height);
    const width = preview.width * scale;
    const height = preview.height * scale;
    reprojectionInteraction.resize(width, height);
    applyReprojectionViewTransform();
}

function inputOrientationSigns() {
    return {
        x: ["horizontal", "both"].includes(reprojectionFlip.value) ? -1 : 1,
        y: ["vertical", "both"].includes(reprojectionFlip.value) ? -1 : 1,
    };
}

function setImageTransform(element, flipInput = false) {
    const scale = reprojectionState.viewScale;
    const signs = flipInput ? inputOrientationSigns() : {x: 1, y: 1};
    const offsetX = reprojectionState.viewTranslateX
        + (signs.x < 0 ? scale * element.clientWidth : 0);
    const offsetY = reprojectionState.viewTranslateY
        + (signs.y < 0 ? scale * element.clientHeight : 0);
    element.style.transform = `matrix(${scale * signs.x}, 0, 0, `
        + `${scale * signs.y}, ${offsetX}, ${offsetY})`;
}

function attachReprojectionGpuCanvas() {
    if (reprojectionState.renderMode !== "gpu") {
        return;
    }
    if (reprojectionLayout.value === "side") {
        const pane = reprojectionLeftPane;
        if (reprojectionGpuFallback.parentElement !== pane) {
            pane.insertBefore(reprojectionGpuFallback, reprojectionCloudSide);
        }
        if (reprojectionLeftGeometry.parentElement !== pane) {
            pane.insertBefore(reprojectionLeftGeometry, reprojectionCloudSide);
        }
        if (reprojectionGpuCanvas.parentElement !== pane) {
            pane.insertBefore(reprojectionGpuCanvas, reprojectionCloudSide);
        }
        if (reprojectionGaussianCanvas.parentElement !== pane) {
            pane.insertBefore(reprojectionGaussianCanvas, reprojectionCloudSide);
        }
    } else {
        reprojectionGpuFallback.style.left = "";
        reprojectionGpuFallback.style.top = "";
        reprojectionGpuFallback.style.width = "";
        reprojectionGpuFallback.style.height = "";
        reprojectionLeftGeometry.style.left = "";
        reprojectionLeftGeometry.style.top = "";
        reprojectionLeftGeometry.style.width = "";
        reprojectionLeftGeometry.style.height = "";
        if (reprojectionGpuFallback.parentElement !== reprojectionSplit) {
            reprojectionSplit.insertBefore(
                reprojectionGpuFallback, reprojectionLeftGeometryLayer
            );
        }
        if (reprojectionLeftGeometry.parentElement
                !== reprojectionLeftGeometryLayer) {
            reprojectionLeftGeometryLayer.appendChild(reprojectionLeftGeometry);
        }
        if (reprojectionGpuCanvas.parentElement !== reprojectionSplit) {
            reprojectionSplit.insertBefore(reprojectionGpuCanvas, reprojectionCloud);
        }
        if (reprojectionGaussianCanvas.parentElement !== reprojectionSplit) {
            reprojectionSplit.insertBefore(
                reprojectionGaussianCanvas, reprojectionCloud
            );
        }
    }
    reprojectionGpuFallback.classList.toggle(
        "active", reprojectionState.gpuFallbackReady
            || reprojectionGpuFallback.classList.contains("transition-hold")
    );
    const engine = reprojectionGpuRenderer?.getGeometryEngine(
        gpuGeometryKey(reprojectionState.leftSource)
    );
    const gaussianActive = engine === "playcanvas";
    // During an engine handoff the outgoing canvas is the only guaranteed
    // compositor-ready copy of its last frame. Keep it mounted above the
    // destination until releaseReprojectionTransitionFrame observes the
    // destination across a paint. drawImage() is only a fallback here: some
    // WebGPU implementations return a cleared/black canvas snapshot.
    reprojectionGpuCanvas.classList.toggle(
        "active",
        !gaussianActive
            || reprojectionGpuCanvas.classList.contains("transition-outgoing")
    );
    reprojectionGaussianCanvas.classList.toggle(
        "active",
        gaussianActive
            || reprojectionGaussianCanvas.classList.contains("transition-outgoing")
    );
    if (reprojectionLayout.value === "side") {
        // The detailed canvas remains the centered flex item. Overlay the
        // snapshot on its exact untransformed box without adding a second
        // flex item that would shrink or displace it.
        const detailedCanvas = ReprojectionGpuCanvas.canvasForEngine(
            reprojectionGpuCanvas, reprojectionGaussianCanvas, engine
        );
        reprojectionGpuFallback.style.left = `${detailedCanvas.offsetLeft}px`;
        reprojectionGpuFallback.style.top = `${detailedCanvas.offsetTop}px`;
        reprojectionGpuFallback.style.width = `${detailedCanvas.clientWidth}px`;
        reprojectionGpuFallback.style.height = `${detailedCanvas.clientHeight}px`;
        reprojectionLeftGeometry.style.left = `${detailedCanvas.offsetLeft}px`;
        reprojectionLeftGeometry.style.top = `${detailedCanvas.offsetTop}px`;
        reprojectionLeftGeometry.style.width = `${detailedCanvas.clientWidth}px`;
        reprojectionLeftGeometry.style.height = `${detailedCanvas.clientHeight}px`;
    }
    reprojectionCloud.style.visibility = "hidden";
    reprojectionCloud.style.background = "";
    reprojectionCloudSide.style.visibility = "hidden";
    reprojectionCloudSide.style.background = "";
}

function disableReprojectionGpuCanvas() {
    clearReprojectionGpuTransitionDebug();
    delete reprojectionGpuFallback.dataset.transitionSourceLabel;
    delete reprojectionGpuFallback.dataset.transitionCapturedLeft;
    reprojectionState.gpuFallbackReady = false;
    reprojectionGpuFallback.classList.remove("active", "transition-hold");
    reprojectionGpuFallback.style.transform = "";
    leftCapturedPresentation.setActive(false);
    reprojectionState.leftCapturedSource = null;
    reprojectionLeftGeometry.style.transform = "";
    reprojectionGpuCanvas.classList.remove(
        "active", "transition-outgoing", "transition-source"
    );
    reprojectionGpuCanvas.style.transform = "";
    reprojectionGpuCanvas.style.background = "";
    reprojectionGaussianCanvas.classList.remove(
        "active", "transition-outgoing", "transition-source"
    );
    reprojectionGaussianCanvas.style.transform = "";
    reprojectionGaussianCanvas.style.background = "";
}

function applyReprojectionViewTransform() {
    reprojectionViewer.classList.toggle(
        "zoomed-in", reprojectionState.viewScale > 1 + 1e-6
    );
    const rightIsRenderedGeometry = paneSources.isGeometry(
        reprojectionState.rightSource
    );
    if (reprojectionLayout.value === "side") {
        if (reprojectionState.renderMode === "server") {
            applyPointRenderTransform(reprojectionCloudSide);
        } else {
            setImageTransform(reprojectionCloudSide);
        }
        if (reprojectionState.renderMode === "gpu") {
            applyGpuFallbackViewTransform();
            applyLeftPaneCaptureTransform();
            applyReprojectionGpuViewTransform();
        }
        if (rightIsRenderedGeometry) {
            applyRightPaneCaptureTransform(
                sourceUsesGpu(reprojectionState.rightRenderedSource)
                    ? reprojectionRightGeometrySide : reprojectionInputSide
            );
        } else {
            reprojectionInputSide.style.clipPath = "";
            setImageTransform(reprojectionInputSide, true);
        }
    } else {
        if (reprojectionState.renderMode === "server") {
            applyPointRenderTransform(reprojectionCloud);
        } else {
            setImageTransform(reprojectionCloud);
        }
        if (reprojectionState.renderMode === "gpu") {
            applyGpuFallbackViewTransform();
            applyLeftPaneCaptureTransform();
            applyReprojectionGpuViewTransform();
        }
        if (rightIsRenderedGeometry) {
            applyRightPaneCaptureTransform(
                sourceUsesGpu(reprojectionState.rightRenderedSource)
                    ? reprojectionRightGeometry : reprojectionInput
            );
        } else {
            reprojectionInput.style.clipPath = "";
            setImageTransform(reprojectionInput, true);
        }
    }
}

function applyRightPaneCaptureTransform(element) {
    const transform = ReprojectionGpu.relativeViewTransform(
        reprojectionState.rightRenderedView,
        currentReprojectionView()
    );
    element.style.transform = `matrix(${transform.scale}, 0, 0, `
        + `${transform.scale}, ${transform.translateX}, ${transform.translateY})`;
    applyGeometryFrameClip(element, reprojectionState.rightRenderedView);
}

function applyLeftPaneCaptureTransform() {
    const transform = ReprojectionGpu.relativeViewTransform(
        reprojectionState.gpuRenderedView,
        currentReprojectionView()
    );
    reprojectionLeftGeometry.style.transform =
        `matrix(${transform.scale}, 0, 0, ${transform.scale}, `
        + `${transform.translateX}, ${transform.translateY})`;
    applyGeometryFrameClip(
        reprojectionLeftGeometry, reprojectionState.gpuRenderedView
    );
}

function applyPointRenderTransform(element) {
    const transform = ReprojectionGpu.relativeViewTransform(
        reprojectionState.pointRenderedView,
        currentReprojectionView()
    );
    element.style.transform = `matrix(${transform.scale}, 0, 0, `
        + `${transform.scale}, ${transform.translateX}, ${transform.translateY})`;
    applyGeometryFrameClip(element, reprojectionState.pointRenderedView);
}

function applyGeometryFrameClip(element, renderedView) {
    if (!confineGeometryToImageFrame()) {
        element.style.clipPath = "";
        return;
    }
    const width = element.clientWidth;
    const height = element.clientHeight;
    const scale = Math.max(Number(renderedView.scale) || 1, 1e-6);
    const translateX = Number(renderedView.translateX) || 0;
    const translateY = Number(renderedView.translateY) || 0;
    const clamp = (value, maximum) => Math.max(0, Math.min(maximum, value));
    const top = clamp(translateY, height);
    const right = clamp(width - translateX - scale * width, width);
    const bottom = clamp(height - translateY - scale * height, height);
    const left = clamp(translateX, width);
    element.style.clipPath =
        `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}

function confineGeometryToImageFrame() {
    return !reprojectionShowOutsideFrame.checked;
}

function applyInteractiveReprojectionViewTransform() {
    applyReprojectionViewTransform();
    if (reprojectionState.renderMode === "gpu") {
        scheduleZoomDetailRefresh(80);
    }
}

function captureReprojectionGpuFallback() {
    const engine = reprojectionGpuRenderer?.getGeometryEngine(
        gpuGeometryKey(reprojectionState.leftSource)
    );
    const source = ReprojectionGpuCanvas.canvasForEngine(
        reprojectionGpuCanvas, reprojectionGaussianCanvas, engine
    );
    reprojectionState.gpuFallbackReady = drawReprojectionFallback(
        source, source.width, source.height
    );
    if (reprojectionState.gpuFallbackReady) {
        reprojectionState.gpuFallbackRenderedView = {
            ...reprojectionState.gpuRenderedView,
        };
        reprojectionGpuFallback.classList.add("active");
        applyGpuFallbackViewTransform();
    }
}

function drawReprojectionFallback(source, width, height, paintBackground = null) {
    try {
        const context = reprojectionGpuFallback.getContext("2d", {alpha: true});
        reprojectionGpuFallback.width = width;
        reprojectionGpuFallback.height = height;
        paintBackground?.(context, width, height);
        context.drawImage(source, 0, 0, width, height);
        return true;
    } catch (error) {
        console.warn("Unable to retain the current reprojection frame", error);
        return false;
    }
}

function holdReprojectionPointTransitionFrame(source) {
    if (!source || source.naturalWidth <= 0 || source.naturalHeight <= 0) {
        return false;
    }
    if (reprojectionLayout.value === "side") {
        const pane = reprojectionLeftPane;
        if (reprojectionGpuFallback.parentElement !== pane) {
            pane.insertBefore(reprojectionGpuFallback, reprojectionCloudSide);
        }
        reprojectionGpuFallback.style.left = `${source.offsetLeft}px`;
        reprojectionGpuFallback.style.top = `${source.offsetTop}px`;
        reprojectionGpuFallback.style.width = `${source.clientWidth}px`;
        reprojectionGpuFallback.style.height = `${source.clientHeight}px`;
    } else {
        if (reprojectionGpuFallback.parentElement !== reprojectionSplit) {
            reprojectionSplit.insertBefore(reprojectionGpuFallback, reprojectionCloud);
        }
        reprojectionGpuFallback.style.left = "";
        reprojectionGpuFallback.style.top = "";
        reprojectionGpuFallback.style.width = "";
        reprojectionGpuFallback.style.height = "";
    }
    const retained = drawReprojectionFallback(
        source, source.naturalWidth, source.naturalHeight,
        (context, width, height) => {
            const colors = reprojectionState.backgroundColors.surface;
            const background = context.createLinearGradient(0, 0, 0, height);
            background.addColorStop(0, colors.top);
            background.addColorStop(1, colors.bottom);
            context.fillStyle = background;
            context.fillRect(0, 0, width, height);
        }
    );
    if (!retained) {
        return false;
    }
    reprojectionState.gpuFallbackRenderedView = {
        ...reprojectionState.pointRenderedView,
    };
    reprojectionState.gpuFallbackReady = false;
    reprojectionGpuFallback.dataset.transitionSourceLabel =
        reprojectionSourceLabel("colmap");
    reprojectionGpuFallback.classList.add("active", "transition-hold");
    applyGpuFallbackViewTransform();
    return true;
}

function holdReprojectionGpuTransitionFrame() {
    if (reprojectionLeftGeometry.classList.contains("active")) {
        if (!drawReprojectionFallback(
            reprojectionLeftGeometry,
            reprojectionLeftGeometry.width,
            reprojectionLeftGeometry.height
        )) {
            return false;
        }
        reprojectionState.gpuFallbackReady = false;
        reprojectionState.gpuFallbackRenderedView = {
            ...reprojectionState.gpuRenderedView,
        };
        // The capture bitmap is transparent. Keep its outgoing source
        // background stable while applyGeometryStatus configures the incoming
        // source's shared background variable.
        const outgoingBackground = backgroundGradientForSource(
            reprojectionState.leftCapturedSource
        ) || getComputedStyle(
            reprojectionLeftGeometry.parentElement
        ).backgroundImage;
        leftCapturedPresentation.holdBackground(outgoingBackground);
        reprojectionGpuFallback.dataset.transitionSourceLabel =
            reprojectionSourceLabel(reprojectionState.gpuRenderedSource);
        reprojectionGpuFallback.dataset.transitionCapturedLeft = "true";
        reprojectionGpuFallback.classList.add("active", "transition-hold");
        applyGpuFallbackViewTransform();
        return true;
    }
    const source = [reprojectionGpuCanvas, reprojectionGaussianCanvas].find(
        canvas => canvas.classList.contains("transition-outgoing")
    ) || (reprojectionGaussianCanvas.classList.contains("active")
        ? reprojectionGaussianCanvas
        : (reprojectionGpuCanvas.classList.contains("active")
            ? reprojectionGpuCanvas : null));
    if (!source || source.width <= 0 || source.height <= 0) {
        return false;
    }
    reprojectionGpuCanvas.classList.remove("transition-outgoing");
    reprojectionGaussianCanvas.classList.remove("transition-outgoing");
    reprojectionGpuCanvas.classList.remove("transition-source");
    reprojectionGaussianCanvas.classList.remove("transition-source");
    source.classList.add("transition-source");
    const destinationEngine = reprojectionGpuRenderer?.getGeometryEngine(
        gpuGeometryKey(reprojectionState.leftSource)
    );
    const destinationCanvas = ReprojectionGpuCanvas.canvasForEngine(
        reprojectionGpuCanvas, reprojectionGaussianCanvas, destinationEngine
    );
    if (ReprojectionGpuCanvas.needsLiveOutgoingCanvas(
        source, destinationCanvas
    )) {
        source.classList.add("transition-outgoing");
    }
    // Geometry canvases are transparent. Snapshot the outgoing source's
    // current background before applyGeometryStatus changes the shared CSS
    // variable for the incoming source; otherwise empty mesh regions reveal
    // the Gaussian's black background before the geometry itself switches.
    source.style.background = getComputedStyle(reprojectionViewer)
        .getPropertyValue("--reprojection-bg").trim()
        || getComputedStyle(reprojectionSplit).backgroundImage;
    if (!drawReprojectionFallback(source, source.width, source.height)) {
        return false;
    }
    reprojectionState.gpuFallbackRenderedView = {
        ...reprojectionState.gpuRenderedView,
    };
    reprojectionState.gpuFallbackReady = false;
    reprojectionGpuFallback.dataset.transitionSourceLabel =
        reprojectionSourceLabel(reprojectionState.gpuRenderedSource);
    reprojectionGpuFallback.classList.add("active", "transition-hold");
    applyGpuFallbackViewTransform();
    return true;
}

async function releaseReprojectionTransitionFrame(isCurrent) {
    const transitionSource = [
        reprojectionGpuCanvas, reprojectionGaussianCanvas,
    ].find(canvas => canvas.classList.contains("transition-source")) || null;
    const outgoingCanvas = reprojectionGaussianCanvas.classList.contains(
        "transition-outgoing"
    ) ? reprojectionGaussianCanvas
        : (reprojectionGpuCanvas.classList.contains("transition-outgoing")
            ? reprojectionGpuCanvas : null);
    if (!reprojectionGpuFallback.classList.contains("transition-hold")
            && !outgoingCanvas
            && !transitionSource) {
        clearReprojectionGpuTransitionDebug();
        return true;
    }
    await ReprojectionGpuCanvas.waitForPresentation();
    if (!isCurrent()) {
        clearReprojectionGpuTransitionDebug();
        return false;
    }
    const outgoingLabel =
        reprojectionGpuFallback.dataset.transitionSourceLabel || "outgoing frame";
    const incomingLabel = reprojectionSourceLabel(reprojectionState.leftSource);
    if (!await pauseReprojectionGpuTransitionDebug(
        `Stage 1/2: retained ${outgoingLabel} covers rendered ${incomingLabel}`,
        isCurrent
    )) {
        return false;
    }
    reprojectionGpuFallback.classList.remove("transition-hold");
    if (reprojectionGpuFallback.dataset.transitionCapturedLeft === "true") {
        leftCapturedPresentation.setActive(false);
        reprojectionState.leftCapturedSource = null;
    }
    reprojectionGpuFallback.classList.toggle(
        "active",
        reprojectionState.gpuFallbackReady
    );
    if (outgoingCanvas) {
        outgoingCanvas.classList.remove("transition-outgoing", "active");
    }
    if (transitionSource) {
        transitionSource.classList.remove("transition-source");
        transitionSource.style.background = "";
    }
    if (!await pauseReprojectionGpuTransitionDebug(
        `Stage 2/2: ${incomingLabel} exposed`,
        isCurrent
    )) {
        return false;
    }
    delete reprojectionGpuFallback.dataset.transitionSourceLabel;
    delete reprojectionGpuFallback.dataset.transitionCapturedLeft;
    clearReprojectionGpuTransitionDebug();
    return true;
}

function clearReprojectionGpuFallback() {
    reprojectionState.gpuFallbackReady = false;
    if (!reprojectionGpuFallback.classList.contains("transition-hold")) {
        reprojectionGpuFallback.classList.remove("active");
    }
}

function isFullFrameGpuView(view) {
    return Math.abs(view.scale - 1) < 1e-6
        && Math.abs(view.translateX) < 1e-6
        && Math.abs(view.translateY) < 1e-6;
}

function isDefaultGpuClippingRange() {
    return Math.abs(reprojectionState.nearClipFraction) < 1e-9
        && Math.abs(reprojectionState.farClipFraction - 1) < 1e-9;
}

function currentReprojectionView() {
    return {
        scale: reprojectionState.viewScale,
        translateX: reprojectionState.viewTranslateX,
        translateY: reprojectionState.viewTranslateY,
    };
}

function applyReprojectionGpuViewTransform() {
    const transform = ReprojectionGpu.relativeViewTransform(
        reprojectionState.gpuRenderedView,
        currentReprojectionView()
    );
    reprojectionGpuCanvas.style.transform = `matrix(${transform.scale}, 0, 0, `
        + `${transform.scale}, ${transform.translateX}, ${transform.translateY})`;
    reprojectionGaussianCanvas.style.transform =
        reprojectionGpuCanvas.style.transform;
    applyGeometryFrameClip(reprojectionGpuCanvas, reprojectionState.gpuRenderedView);
    applyGeometryFrameClip(
        reprojectionGaussianCanvas, reprojectionState.gpuRenderedView
    );
}

function applyGpuFallbackViewTransform() {
    // A transition snapshot contains pixels rendered for the outgoing view.
    // Treating it as a full-frame image would apply a settled pan twice while
    // the incoming GPU frame is waiting to be exposed.
    const renderedView = reprojectionState.gpuFallbackRenderedView;
    const transform = ReprojectionGpu.relativeViewTransform(
        renderedView,
        currentReprojectionView()
    );
    reprojectionGpuFallback.style.transform =
        `matrix(${transform.scale}, 0, 0, ${transform.scale}, `
        + `${transform.translateX}, ${transform.translateY})`;
    applyGeometryFrameClip(reprojectionGpuFallback, renderedView);
}

function reprojectionDisplaySize(image) {
    if (reprojectionLayout.value !== "side") {
        return {
            width: reprojectionSplit.clientWidth,
            height: reprojectionSplit.clientHeight,
        };
    }
    const pane = reprojectionLeftPane;
    const bounds = pane.getBoundingClientRect();
    const aspect = image.width / image.height;
    let width = bounds.width;
    let height = width / aspect;
    if (height > bounds.height) {
        height = bounds.height;
        width = height * aspect;
    }
    return {width, height};
}

function configureGpuPointPixelScale(renderer, renderSize, display) {
    const scaleX = renderSize.width / Math.max(display.width, 1);
    const scaleY = renderSize.height / Math.max(display.height, 1);
    renderer.setPointPixelScale(Math.min(scaleX, scaleY));
}

function activeReprojectionInput() {
    return reprojectionLayout.value === "side"
        ? reprojectionInputSide
        : reprojectionInput;
}

function activeReprojectionRightGeometry() {
    return reprojectionLayout.value === "side"
        ? reprojectionRightGeometrySide
        : reprojectionRightGeometry;
}

function applyReprojectionInputSource(url) {
    reprojectionState.currentInputUrl = url;
    const target = activeReprojectionInput();
    if (target.getAttribute("src") !== url) {
        target.src = url;
        return true;
    }
    return false;
}

function applyReprojectionRenderSource(url, renderedView = currentReprojectionView()) {
    reprojectionState.currentRenderUrl = url;
    reprojectionState.currentRenderView = {...renderedView};
    const target = reprojectionLayout.value === "side"
        ? reprojectionCloudSide
        : reprojectionCloud;
    reprojectionCloud.onload = null;
    reprojectionCloudSide.onload = null;
    const commitRenderedView = () => {
        if (reprojectionState.currentRenderUrl !== url
                || activeReprojectionCloud() !== target
                || target.getAttribute("src") !== url) {
            return;
        }
        target.onload = null;
        reprojectionState.pointRenderedView = {...renderedView};
        target.style.background = backgroundGradientForSource("colmap");
        target.style.visibility = "visible";
        applyReprojectionViewTransform();
        if (reprojectionState.renderMode === "server"
                && sourceUsesServer(reprojectionState.leftSource)) {
            void ReprojectionGpuCanvas.waitForPresentation().then(() => {
                if (reprojectionState.currentRenderUrl === url
                        && activeReprojectionCloud() === target
                        && target.getAttribute("src") === url
                        && reprojectionState.renderMode === "server"
                        && sourceUsesServer(reprojectionState.leftSource)) {
                    disableReprojectionGpuCanvas();
                }
            });
        }
    };
    // Decode away from the visible element. Replacing its src immediately can
    // expose an empty image while the server render is still loading, and can
    // also cover a retained GPU frame because the point image is later in the
    // DOM stacking order.
    const preload = new Image();
    preload.onload = () => {
        if (reprojectionState.currentRenderUrl !== url
                || activeReprojectionCloud() !== target) {
            return;
        }
        target.onload = commitRenderedView;
        target.src = url;
        if (target.complete && target.naturalWidth > 0) {
            queueMicrotask(commitRenderedView);
        }
    };
    preload.src = url;
}

function activeReprojectionCloud() {
    return reprojectionLayout.value === "side"
        ? reprojectionCloudSide
        : reprojectionCloud;
}

function syncActiveReprojectionSources() {
    syncRightPaneBackground(reprojectionState.rightRenderedSource);
    if (reprojectionState.currentInputUrl) {
        applyReprojectionInputSource(reprojectionState.currentInputUrl);
    }
    if (reprojectionState.currentRenderUrl) {
        applyReprojectionRenderSource(
            reprojectionState.currentRenderUrl,
            reprojectionState.currentRenderView || reprojectionState.pointRenderedView
        );
    }
    attachReprojectionGpuCanvas();
}

function reprojectionImageBounds(clientX) {
    if (reprojectionLayout.value !== "side") {
        return reprojectionSplit.getBoundingClientRect();
    }
    const panes = [...reprojectionSide.querySelectorAll(".reprojection-pane")];
    const pane = panes.find(candidate => {
        const bounds = candidate.getBoundingClientRect();
        return clientX >= bounds.left && clientX <= bounds.right;
    }) || panes[0];
    const paneBounds = pane.getBoundingClientRect();
    const image = reprojectionState.images[reprojectionState.currentIndex];
    const aspect = image.width / image.height;
    let width = paneBounds.width;
    let height = width / aspect;
    if (height > paneBounds.height) {
        height = paneBounds.height;
        width = height * aspect;
    }
    return {
        left: paneBounds.left + (paneBounds.width - width) / 2,
        top: paneBounds.top + (paneBounds.height - height) / 2,
        width,
        height,
        right: paneBounds.left + (paneBounds.width + width) / 2,
        bottom: paneBounds.top + (paneBounds.height + height) / 2,
    };
}

function zoomReprojectionView(event) {
    if (!reprojectionState.images.length) {
        return;
    }
    const bounds = reprojectionImageBounds(event.clientX);
    const mouseX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const mouseY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    const oldScale = reprojectionState.viewScale;
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.1, Math.min(20, oldScale * factor));
    const ratio = newScale / oldScale;
    reprojectionState.viewTranslateX = mouseX
        - (mouseX - reprojectionState.viewTranslateX) * ratio;
    reprojectionState.viewTranslateY = mouseY
        - (mouseY - reprojectionState.viewTranslateY) * ratio;
    reprojectionState.viewScale = newScale;
    applyReprojectionViewTransform();
    scheduleZoomDetailRefresh();
}

function resetReprojectionViewTransform() {
    reprojectionState.viewScale = 1;
    reprojectionState.viewTranslateX = 0;
    reprojectionState.viewTranslateY = 0;
    applyReprojectionViewTransform();
    if (reprojectionState.renderMode === "gpu") {
        renderReprojectionGpuFrame(reprojectionState.generation, true);
    } else {
        scheduleZoomDetailRefresh(0);
    }
}

function currentZoomDetailMaxSize(image) {
    return ReprojectionGpu.zoomDetailMaxSize(
        image,
        currentPreviewMaxSize(),
        reprojectionState.viewScale,
        reprojectionState.navigationPreview,
        Math.min(reprojectionState.maxInputSize, 8192)
    );
}

function scheduleZoomDetailRefresh(delay = 120) {
    window.clearTimeout(reprojectionState.zoomDetailTimer);
    if (!reprojectionState.loaded) {
        return;
    }
    const generation = reprojectionState.generation;
    reprojectionState.zoomDetailTimer = window.setTimeout(() => {
        if (generation !== reprojectionState.generation) {
            return;
        }
        const image = reprojectionState.images[reprojectionState.currentIndex];
        const maxSize = currentZoomDetailMaxSize(image);
        const urls = reprojectionUrls(image, reprojectionIdentity.id, maxSize);
        if (paneSources.isImage(reprojectionState.rightSource)) {
            applyReprojectionInputSource(urls.input);
        }
        if (reprojectionState.renderMode === "gpu") {
            // Keep both GPU geometries on the same captured view and avoid
            // making the right pane wait for a second delayed refresh.
            renderReprojectionGpuFrame(generation, true);
        } else {
            requestReprojectionPointLayer(generation);
            if (sourceUsesGpu(reprojectionState.rightSource)) {
                renderReprojectionRightPane(generation);
            }
        }
    }, delay);
}

function currentPreviewMaxSize() {
    return reprojectionState.navigationPreview
        ? Math.min(reprojectionState.maxSize, reprojectionState.navigationPreviewSize)
        : reprojectionState.maxSize;
}

function pointRenderParameters(image) {
    const display = reprojectionDisplaySize(image);
    // Server splat radii are measured in output-image pixels, whereas the
    // WebGPU point size is measured in CSS pixels. Render the server layer at
    // one output pixel per displayed pixel so both backends share one unit.
    const baseMaxSize = ReprojectionPointSize.displayRenderMaxSize({
        displayWidth: display.width,
        displayHeight: display.height,
        fallbackMaxSize: currentPreviewMaxSize(),
        navigationPreview: reprojectionState.navigationPreview,
        navigationPreviewSize: reprojectionState.navigationPreviewSize,
        minRenderSize: 320,
        maxRenderSize: reprojectionState.maxRenderSize,
    });
    return ReprojectionPointSize.renderParameters({
        pointSize: reprojectionPointSize.value,
        baseMaxSize,
        navigationPreview: reprojectionState.navigationPreview,
        maxRenderSize: reprojectionState.maxRenderSize,
    });
}

function reprojectionUrls(
    image, requestStream = reprojectionIdentity.id,
    inputMaxSize = currentPreviewMaxSize(),
    renderedView = currentReprojectionView(),
    geometryToken = reprojectionState.geometryCacheToken
) {
    const base = `/api/reprojection/${image.id}`;
    const dataset = encodeURIComponent(reprojectionState.datasetNamespace);
    const stream = encodeURIComponent(requestStream);
    const masked = maskedInputEnabled(image) ? 1 : 0;
    const invertMask = masked && reprojectionInvertMask.checked ? 1 : 0;
    const geometry = geometryToken === null
        ? "" : `&geometry=${encodeURIComponent(geometryToken)}`;
    const customClipping = !isDefaultGpuClippingRange();
    const hasGpuClippingReference = Boolean(
        reprojectionGpuRenderer?.getGeometryKeys().length
    );
    const clipping = customClipping && hasGpuClippingReference
        ? reprojectionGpuRenderer.clippingPlanesForImage(image)
        : null;
    const clippingQuery = clipping
        ? `&near_clip=${clipping.near}&far_clip=${clipping.far}`
        : customClipping
            ? `&near_clip_fraction=${reprojectionState.nearClipFraction}`
                + `&far_clip_fraction=${reprojectionState.farClipFraction}`
            : "";
    const pointRender = pointRenderParameters(image);
    const display = reprojectionDisplaySize(image);
    const region = ReprojectionGpu.zoomViewRegion(
        image,
        display.width || image.width,
        display.height || image.height,
        renderedView.scale,
        renderedView.translateX,
        renderedView.translateY
    );
    return {
        input: `${base}/input?max_size=${inputMaxSize}`
            + `&masked=${masked}&invert_mask=${invertMask}`
            + `&format=jpeg-v1&dataset=${dataset}&stream=${stream}`,
        render: `${base}/render?max_size=${pointRender.maxSize}`
            + `&color=${encodeURIComponent(reprojectionColor.value)}`
            + `&radius=${pointRender.radius}&dataset=${dataset}&stream=${stream}`
            + `${geometry}&format=png-v3`
            + `&left=${region.left}&right=${region.right}`
            + `&top=${region.top}&bottom=${region.bottom}`
            + clippingQuery
            + `&clip_frame=${confineGeometryToImageFrame() ? 1 : 0}`,
    };
}

function supersedeGeometryLoad({clearDropState = false} = {}) {
    reprojectionUploadGeneration += 1;
    ViewerStreamIdentity.writeSession(
        reprojectionUploadGenerationKey,
        String(reprojectionUploadGeneration)
    );
    reprojectionUploadController?.abort();
    reprojectionUploadController = null;
    activeGeometryLoadOperation = null;
    reprojectionState.browserGeometryLoading = false;
    if (clearDropState) {
        reprojectionGeometryDrop.classList.remove("loading", "drag-over");
        reprojectionGeometryFile.value = "";
    }
    return reprojectionUploadGeneration;
}

function cancelConfiguredGeometryLoads() {
    reprojectionState.configuredGeometryQueueGeneration += 1;
    reprojectionState.configuredGeometryLoads.clear();
}

function beginGeometryLoad(owner) {
    // Direct file selections replace pending work. Configured-path loads are
    // additive and serialize through configuredGeometryLoadQueue.
    if (owner === "direct") {
        cancelConfiguredGeometryLoads();
    }
    const generation = supersedeGeometryLoad();
    let resolveFinished;
    const finished = new Promise(resolve => {
        resolveFinished = resolve;
    });
    const operation = {owner, generation, finished, resolveFinished};
    activeGeometryLoadOperation = operation;
    return operation;
}

function finishGeometryLoad(operation) {
    operation.resolveFinished();
    if (activeGeometryLoadOperation === operation) {
        activeGeometryLoadOperation = null;
    }
}

function supersedeDirectGeometryLoad() {
    const operation = activeGeometryLoadOperation;
    if (operation?.owner === "direct") {
        supersedeGeometryLoad({clearDropState: true});
        return operation.finished;
    }
    return Promise.resolve();
}

async function uploadServerGeometry(file) {
    if (!file || !file.name.toLowerCase().endsWith(".ply")) {
        setReprojectionStatus("Only PLY point clouds and meshes are supported.", true);
        return;
    }
    await reprojectionIdentityReady;
    const operation = beginGeometryLoad("direct");
    const generation = operation.generation;
    const uploadController = new AbortController();
    reprojectionUploadController = uploadController;
    stopContinuousNavigation(false);
    reprojectionGeometryDrop.classList.add("loading");
    reprojectionClearGeometries.disabled = true;
    setReprojectionStatus(`Loading ${file.name}…`);
    try {
        const geometry = await reprojectionApi.uploadGeometry(
            file, generation, uploadController.signal
        );
        if (reprojectionUploadController !== uploadController) {
            return;
        }
        await disposeAllGpuGeometry();
        void ensureColmapGpuGeometry();
        reprojectionState.renderMode = "server";
        disableReprojectionGpuCanvas();
        applyGeometryStatus(geometry);
        if (reprojectionState.loaded
                && document.body.dataset.viewerMode === "reprojection") {
            loadReprojectionFrame(reprojectionState.currentIndex);
        }
    } catch (error) {
        if (error.name === "AbortError"
                || reprojectionUploadController !== uploadController) {
            return;
        }
        setReprojectionStatus(`Failed to load ${file.name}: ${error.message}`, true);
    } finally {
        if (reprojectionUploadController === uploadController) {
            reprojectionUploadController = null;
            reprojectionGeometryDrop.classList.remove("loading", "drag-over");
            reprojectionGeometryFile.value = "";
            reprojectionClearGeometries.disabled = !hasClearableGeometry();
        }
        finishGeometryLoad(operation);
    }
}

async function loadReprojectionGeometry(file) {
    if (!file || !file.name.toLowerCase().endsWith(".ply")) {
        setReprojectionStatus("Only PLY point clouds and meshes are supported.", true);
        return;
    }
    await reprojectionIdentityReady;
    const intent = beginGeometryLoad("direct");
    await reprojectionState.configuredGeometryLoadQueue;
    if (activeGeometryLoadOperation !== intent) {
        finishGeometryLoad(intent);
        return;
    }
    const image = reprojectionState.images[reprojectionState.currentIndex];
    let kind;
    try {
        kind = await ReprojectionGpu.ReprojectionGpuRenderer.inspectFile(file);
    } catch (error) {
        setReprojectionStatus(`Failed to inspect ${file.name}: ${error.message}`, true);
        finishGeometryLoad(intent);
        return;
    }
    if (activeGeometryLoadOperation !== intent) {
        finishGeometryLoad(intent);
        return;
    }
    finishGeometryLoad(intent);

    // Distorted cameras still use the numerical renderer, which applies the
    // exact COLMAP camera model. The Three path is exact for pinhole cameras.
    if (!image || !ReprojectionGpu.isPinholeCamera(image)) {
        await uploadServerGeometry(file);
        return;
    }

    await installBrowserGeometry(
        file.name,
        (renderer, isCurrent) => renderer.loadFile(file, kind, isCurrent)
    );
}

function enqueueConfiguredGeometryTask(task) {
    const queueGeneration = reprojectionState.configuredGeometryQueueGeneration;
    const run = () => {
        if (queueGeneration !== reprojectionState.configuredGeometryQueueGeneration) {
            return configuredGeometryLoadResult.failed;
        }
        return task(() => (
            queueGeneration === reprojectionState.configuredGeometryQueueGeneration
        ));
    };
    const queued = reprojectionState.configuredGeometryLoadQueue.then(
        run, run
    );
    reprojectionState.configuredGeometryLoadQueue = queued.catch(() => {});
    return queued;
}

function loadConfiguredReprojectionGeometry(configuredGeometry) {
    const sourceId = configuredGeometry.url;
    if (reprojectionState.loadedGeometries.some(
        geometry => geometry.sourceId === sourceId
    )) {
        return Promise.resolve(configuredGeometryLoadResult.loaded);
    }
    const pendingLoad = reprojectionState.configuredGeometryLoads.get(sourceId);
    if (pendingLoad) {
        return pendingLoad;
    }
    const load = enqueueConfiguredGeometryTask(
        isCurrent => loadConfiguredReprojectionGeometryNow(
            configuredGeometry, isCurrent
        )
    );
    reprojectionState.configuredGeometryLoads.set(sourceId, load);
    const clearPendingLoad = () => {
        if (reprojectionState.configuredGeometryLoads.get(sourceId) === load) {
            reprojectionState.configuredGeometryLoads.delete(sourceId);
        }
    };
    load.then(clearPendingLoad, clearPendingLoad);
    return load;
}

async function loadConfiguredReprojectionGeometryNow(
    configuredGeometry, isCurrent = () => true
) {
    const image = reprojectionState.images[reprojectionState.currentIndex];
    if (!image) {
        return configuredGeometryLoadResult.deferred;
    }
    if (!ReprojectionGpu.isPinholeCamera(image)) {
        return registerConfiguredServerGeometry(configuredGeometry)
            ? configuredGeometryLoadResult.loaded
            : configuredGeometryLoadResult.failed;
    }
    const sourceId = configuredGeometry.url;
    if (reprojectionState.loadedGeometries.some(
        geometry => geometry.sourceId === sourceId
    )) {
        return configuredGeometryLoadResult.loaded;
    }
    const installed = await installBrowserGeometry(
        configuredGeometry.name,
        configuredBrowserGeometryLoader(configuredGeometry, image),
        sourceId,
        "configured",
        configuredGeometry.path || null,
        configuredGeometry
    );
    return installed
        ? configuredGeometryLoadResult.loaded
        : configuredGeometryLoadResult.failed;
}

function registerConfiguredServerGeometry(configuredGeometry) {
    const sourceId = configuredGeometry.url;
    const existing = reprojectionState.loadedGeometries.find(
        geometry => geometry.sourceId === sourceId
    );
    if (existing) {
        reprojectionState.leftSource = existing.gpuKey;
        return true;
    }
    const source = `server:${sourceId}`;
    const label = paneSources.uniqueLabel(
        configuredGeometry.name,
        [
            ...Object.values(builtInReprojectionSourceLabels),
            ...reprojectionState.loadedGeometries.map(loaded => loaded.label),
        ]
    );
    reprojectionState.loadedGeometries.push({
        gpuKey: source,
        sourceId,
        name: configuredGeometry.name,
        label,
        filename: configuredGeometry.name,
        path: configuredGeometry.path || null,
        kind: configuredGeometry.kind || "point cloud",
        count: 0,
        hiddenByDefault: false,
        renderPath: "server",
        configuredGeometry,
    });
    reprojectionState.leftSource = source;
    reprojectionState.renderMode = "server";
    rebuildPaneSourceOptions();
    reprojectionLeftSource.value = source;
    paneSourcePickers.left.sync();
    showReprojectionSourceBadges();
    return true;
}

async function activateConfiguredServerGeometry(configuredGeometry, requestStream) {
    setReprojectionStatus(
        `Preparing ${configuredGeometry.name} for server rendering…`
    );
    const geometryStatus = await reprojectionApi.activateConfiguredGeometry(
        configuredGeometry.activate_url, requestStream
    );
    configuredGeometry.server_loaded = true;
    return geometryStatus;
}

function configuredBrowserGeometryLoader(configuredGeometry, image) {
    return configuredGeometry.mesh_stream
        ? (renderer, isCurrent) => renderer.loadMeshStream(
            configuredGeometry.mesh_stream,
            image,
            isCurrent,
            (completed, total) => setReprojectionStatus(
                `Streaming and preparing ${configuredGeometry.name}: `
                + `${completed} / ${total} chunks…`
            )
        )
        : (renderer, isCurrent) => renderer.loadUrl(
            configuredGeometry.url, configuredGeometry.size, isCurrent,
            configuredGeometry.name, configuredGeometry.kind
        );
}

async function loadLocalReprojectionGeometry() {
    const path = reprojectionLocalPath.value.trim();
    if (!path) {
        setReprojectionStatus("Enter an absolute server-local PLY path.", true);
        return;
    }
    reprojectionLocalPath.disabled = true;
    reprojectionLoadLocalPath.disabled = true;
    setReprojectionStatus(`Queued ${path}…`);
    try {
        await reprojectionIdentityReady;
        const directLoadFinished = supersedeDirectGeometryLoad();
        await enqueueConfiguredGeometryTask(async isCurrent => {
            await directLoadFinished;
            if (!isCurrent()) {
                return configuredGeometryLoadResult.failed;
            }
            setReprojectionStatus(`Inspecting ${path}…`);
            const configuredGeometry =
                await reprojectionApi.loadLocalGeometry(path);
            if (!isCurrent()) {
                return configuredGeometryLoadResult.failed;
            }
            configuredGeometry.path = path;
            reprojectionState.configuredGeometries = [configuredGeometry];
            if (!reprojectionState.images.length) {
                setReprojectionStatus(
                    `${configuredGeometry.name} selected; `
                    + "open 3D reprojection to load it."
                );
                return configuredGeometryLoadResult.deferred;
            }
            const result = await loadConfiguredReprojectionGeometryNow(
                configuredGeometry, isCurrent
            );
            if (result === configuredGeometryLoadResult.loaded
                    && sourceUsesServer(reprojectionState.leftSource)) {
                refreshReprojectionPanes();
            }
            return result;
        });
    } catch (error) {
        setReprojectionStatus(
            `Failed to load local geometry: ${error.message}`, true
        );
    } finally {
        reprojectionLocalPath.disabled = false;
        reprojectionLoadLocalPath.disabled = false;
    }
}

async function installBrowserGeometry(
    name, loadGeometry, sourceId = null, owner = "direct", sourcePath = null,
    configuredGeometry = null
) {
    const renderer = getReprojectionGpuRenderer();

    const operation = beginGeometryLoad(owner);
    const generation = operation.generation;
    reprojectionState.browserGeometryLoading = true;
    stopContinuousNavigation(false);
    reprojectionGeometryDrop.classList.add("loading");
    reprojectionClearGeometries.disabled = true;
    setReprojectionStatus(`Loading ${name} directly in the browser…`);
    try {
        const geometry = await loadGeometry(
            renderer, () => generation === reprojectionUploadGeneration
        );
        if (!geometry || generation !== reprojectionUploadGeneration) {
            if (geometry?.key) {
                await renderer.disposeGeometry(geometry.key);
            }
            return false;
        }
        const image = reprojectionState.images[reprojectionState.currentIndex];
        if (ReprojectionGeometryPreparation.requiresGpuPreparation(
            geometry, image
        )) {
            setReprojectionStatus(`Preparing ${name} for display…`);
            const prepared = await renderer.prepareGeometry(
                geometry.key,
                image,
                () => generation === reprojectionUploadGeneration
            );
            if (!prepared || generation !== reprojectionUploadGeneration) {
                await renderer.disposeGeometry(geometry.key);
                return false;
            }
        }
        const duplicate = sourceId && reprojectionState.loadedGeometries.find(
            loaded => loaded.sourceId === sourceId
        );
        if (duplicate) {
            if (sourcePath) {
                duplicate.path = sourcePath;
            }
            await renderer.disposeGeometry(geometry.key);
            renderer.activateGeometry(duplicate.gpuKey);
            return true;
        }
        const representations = geometry.representations || [{
            key: geometry.key,
            kind: geometry.kind,
            count: geometry.count,
        }];
        representations.forEach(representation => {
            const representationName = representation.label
                ? `${name} (${representation.label})` : name;
            const preferredLabel = representation.key === geometry.key
                ? name : representationName;
            const label = paneSources.uniqueLabel(
                preferredLabel,
                [
                    ...Object.values(builtInReprojectionSourceLabels),
                    ...reprojectionState.loadedGeometries.map(
                        loaded => loaded.label
                    ),
                ]
            );
            reprojectionState.loadedGeometries.push({
                gpuKey: representation.key,
                sourceId,
                name: representationName,
                label,
                filename: name,
                path: sourcePath,
                kind: representation.kind,
                count: representation.count,
                hiddenByDefault: Boolean(representation.hiddenByDefault),
                configuredGeometry,
            });
        });
        reprojectionState.leftSource = geometry.key;
        showReprojectionSourceBadges();
        reprojectionState.renderMode = "gpu";
        disableReprojectionGpuCanvas();
        rebuildPaneSourceOptions();
        reprojectionLeftSource.value = geometry.key;
        paneSourcePickers.left.sync();
        applyGeometryStatus({
            name,
            kind: geometry.kind,
            point_count: geometry.count,
            cache_token: `browser-${generation}`,
            gpu: true,
        });
        attachReprojectionGpuCanvas();
        if (reprojectionState.loaded
                && document.body.dataset.viewerMode === "reprojection") {
            loadReprojectionFrame(reprojectionState.currentIndex);
        }
        return true;
    } catch (error) {
        if (generation === reprojectionUploadGeneration) {
            setReprojectionStatus(`Failed to load ${name}: ${error.message}`, true);
        }
        return false;
    } finally {
        if (generation === reprojectionUploadGeneration) {
            reprojectionState.browserGeometryLoading = false;
            reprojectionGeometryDrop.classList.remove("loading", "drag-over");
            reprojectionGeometryFile.value = "";
            reprojectionClearGeometries.disabled = !hasClearableGeometry();
        }
        finishGeometryLoad(operation);
    }
}

async function clearLoadedGeometries() {
    cancelConfiguredGeometryLoads();
    await reprojectionIdentityReady;
    supersedeGeometryLoad({clearDropState: true});
    await disposeAllGpuGeometry();
    void ensureColmapGpuGeometry();
    reprojectionState.loadedGeometries = [];
    reprojectionState.leftSource = "colmap";
    reprojectionState.rightSource = "image";
    reprojectionState.gpuRenderedSource = null;
    reprojectionState.rightRenderedSource = "image";
    commitRightPanePresentation("image", "independent");
    rebuildPaneSourceOptions();
    reprojectionLeftSource.value = "colmap";
    reprojectionRightSource.value = "image";
    reprojectionState.renderMode = "server";
    disableReprojectionGpuCanvas();
    stopContinuousNavigation(false);
    reprojectionClearGeometries.disabled = true;
    setReprojectionStatus("Clearing loaded geometries…");
    try {
        applyGeometryStatus(await reprojectionApi.resetGeometry());
        if (reprojectionState.loaded) {
            loadReprojectionFrame(reprojectionState.currentIndex);
        }
    } catch (error) {
        reprojectionClearGeometries.disabled = false;
        setReprojectionStatus(
            `Failed to clear loaded geometries: ${error.message}`, true
        );
    }
}

async function heartbeatReprojectionStream() {
    await reprojectionIdentityReady;
    try {
        const geometry = await reprojectionApi.heartbeat();
        if (reprojectionState.renderMode === "gpu") {
            return false;
        }
        const changed = geometry.cache_token
            !== reprojectionState.geometryCacheToken;
        if (changed) {
            applyGeometryStatus(geometry);
            if (reprojectionState.loaded) {
                const generation = ++reprojectionState.generation;
                reprojectionCloud.style.visibility = "hidden";
                reprojectionCloudSide.style.visibility = "hidden";
                requestReprojectionPointLayer(generation);
            }
        }
        return changed;
    } catch (_) {
        return false;
    }
}

function handleGeometryDrag(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === "dragover" || event.type === "dragenter") {
        reprojectionGeometryDrop.classList.add("drag-over");
    } else {
        reprojectionGeometryDrop.classList.remove("drag-over");
    }
}

function handleGeometryDrop(event) {
    handleGeometryDrag(event);
    const file = event.dataTransfer?.files?.[0];
    if (file) {
        loadReprojectionGeometry(file);
    }
}

function prefetchUrl(url) {
    if (reprojectionState.prefetchInFlight.has(url)) {
        return reprojectionState.prefetchInFlight.get(url);
    }
    const pending = fetch(url, {cache: "force-cache"})
        .catch(() => null)
        .finally(() => reprojectionState.prefetchInFlight.delete(url));
    reprojectionState.prefetchInFlight.set(url, pending);
    return pending;
}

let reprojectionRenderCancellation = null;

function cancelReprojectionRender() {
    if (reprojectionRenderCancellation) {
        return reprojectionRenderCancellation;
    }
    const cancellation = (async () => {
        await reprojectionIdentityReady;
        try {
            await reprojectionApi.cancelRender();
        } catch (_) {
            // Navigation still works if cancellation races with server shutdown.
        }
    })();
    reprojectionRenderCancellation = cancellation;
    cancellation.finally(() => {
        if (reprojectionRenderCancellation === cancellation) {
            reprojectionRenderCancellation = null;
        }
    });
    return cancellation;
}

function prefetchReprojectionNeighbors(generation) {
    if (generation !== reprojectionState.generation) {
        return;
    }
    // Next is requested first because forward navigation is most common.
    const neighbors = [
        reprojectionState.currentIndex - 1,
        reprojectionState.currentIndex + 1,
    ];
    neighbors.forEach((index, slot) => {
        if (index < 0 || index >= reprojectionState.images.length) {
            return;
        }
        // Input decoding is safe to preload. Point renders are intentionally
        // never speculative: obsolete camera projections must not queue behind
        // the camera the user is currently requesting.
        // Prefetches use dedicated supersession streams. A canceled speculative
        // 204 must never become the cached response for visible navigation.
        const prefetchStream = `${reprojectionIdentity.id}:prefetch:${slot}`;
        const urls = reprojectionUrls(
            reprojectionState.images[index], prefetchStream
        );
        prefetchUrl(urls.input);
    });
}

async function renderReprojectionGpuFrame(generation, includeRightPane = true) {
    if (generation !== reprojectionState.generation
            || reprojectionState.renderMode !== "gpu"
            || !sourceUsesGpu(reprojectionState.leftSource)) {
        return;
    }
    const image = reprojectionState.images[reprojectionState.currentIndex];
    const frameRequest = ++reprojectionState.gpuFrameRequest;
    const renderer = getReprojectionGpuRenderer();
    if (!renderer.supportsCamera(image)) {
        setReprojectionStatus(
            `${image.name}: browser rendering currently requires a PINHOLE camera`, true
        );
        disableReprojectionGpuCanvas();
        return;
    }
    const display = reprojectionDisplaySize(image);
    if (display.width <= 0 || display.height <= 0) {
        return;
    }
    const renderSize = ReprojectionGpu.screenRenderSize(
        display.width,
        display.height,
        window.devicePixelRatio,
        Math.min(reprojectionState.maxInputSize, 8192)
    );
    configureGpuPointPixelScale(renderer, renderSize, display);
    const renderedView = currentReprojectionView();
    const destinationEngine = renderer.getGeometryEngine(
        gpuGeometryKey(reprojectionState.leftSource)
    );
    const destinationCanvas = ReprojectionGpuCanvas.canvasForEngine(
        reprojectionGpuCanvas, reprojectionGaussianCanvas, destinationEngine
    );
    const switchingEngineCanvas = !destinationCanvas.classList.contains("active");
    const region = ReprojectionGpu.zoomViewRegion(
        image,
        display.width,
        display.height,
        renderedView.scale,
        renderedView.translateX,
        renderedView.translateY
    );
    try {
        const rightSource = reprojectionState.rightSource;
        const rightIsGpu = sourceUsesGpu(rightSource, image);
        const rightFrameKey = rightIsGpu
            ? geometryFrameCacheKey(
                rightSource,
                renderSize.width,
                renderSize.height,
                renderedView
            ) : null;
        if (ReprojectionGpuCanvas.shouldCaptureRightPane({
            includeRightPane,
            rightIsGpu,
            sideBySide: reprojectionLayout.value === "side",
            leftSource: reprojectionState.leftSource,
            rightSource,
            rightFrameCurrent:
                ReprojectionGpuCanvas.isCurrentIndependentFrame({
                    source: rightSource,
                    renderedSource: reprojectionState.rightRenderedSource,
                    renderedMode: reprojectionState.rightRenderedMode,
                    frameKey: rightFrameKey,
                    renderedFrameKey:
                        reprojectionState.rightRenderedFrameKey,
                }),
        })) {
            const {frame, disposable, frameKey} = await getGeometryFrame(
                renderer, rightSource, image, renderSize, region, renderedView
            );
            if (frameRequest !== reprojectionState.gpuFrameRequest
                    || generation !== reprojectionState.generation
                    || reprojectionState.renderMode !== "gpu") {
                if (disposable) {
                    frame?.close?.();
                }
                return;
            }
            installRightGeometryFrame(
                frame,
                rightSource,
                renderedView,
                frameKey,
                () => frameRequest === reprojectionState.gpuFrameRequest
                    && generation === reprojectionState.generation
                    && reprojectionState.renderMode === "gpu"
                    && reprojectionState.rightSource === rightSource
            );
            if (disposable) {
                frame?.close?.();
            }
        }
        await renderer.renderGeometry(
            gpuGeometryKey(reprojectionState.leftSource),
            image, renderSize.width, renderSize.height, region,
            confineGeometryToImageFrame(),
            () => frameRequest === reprojectionState.gpuFrameRequest
                && generation === reprojectionState.generation
                && reprojectionState.renderMode === "gpu"
        );
        if (frameRequest !== reprojectionState.gpuFrameRequest
                || generation !== reprojectionState.generation
                || reprojectionState.renderMode !== "gpu") {
            return;
        }
        let leftCapturedFrame = null;
        let leftCapturedDisposable = false;
        if (destinationEngine === "playcanvas") {
            const captured = await getGeometryFrame(
                renderer,
                reprojectionState.leftSource,
                image,
                renderSize,
                region,
                renderedView
            );
            leftCapturedFrame = captured.frame;
            leftCapturedDisposable = captured.disposable;
            if (frameRequest !== reprojectionState.gpuFrameRequest
                    || generation !== reprojectionState.generation
                    || reprojectionState.renderMode !== "gpu") {
                if (leftCapturedDisposable) {
                    leftCapturedFrame?.close?.();
                }
                return;
            }
        }
        if (switchingEngineCanvas) {
            // PlayCanvas postrender means commands were submitted, not that
            // its hidden canvas has reached the browser compositor. Retain
            // the previous engine canvas across a paint before exposing it.
            await ReprojectionGpuCanvas.waitForPresentation();
            if (frameRequest !== reprojectionState.gpuFrameRequest
                    || generation !== reprojectionState.generation
                    || reprojectionState.renderMode !== "gpu") {
                if (leftCapturedDisposable) {
                    leftCapturedFrame?.close?.();
                }
                return;
            }
        }
        reprojectionState.gpuRenderedView = renderedView;
        reprojectionState.gpuRenderedSource = reprojectionState.leftSource;
        attachReprojectionGpuCanvas();
        applyReprojectionViewTransform();
        const frameIsCurrent = () =>
            frameRequest === reprojectionState.gpuFrameRequest
                && generation === reprojectionState.generation
                && reprojectionState.renderMode === "gpu";
        if (!await releaseReprojectionTransitionFrame(frameIsCurrent)) {
            if (leftCapturedDisposable) {
                leftCapturedFrame?.close?.();
            }
            return;
        }
        if (reprojectionLayout.value === "split"
                && reprojectionState.rightSource === reprojectionState.leftSource) {
            reprojectionState.rightRenderedView = renderedView;
            reprojectionState.rightRenderedSource = reprojectionState.leftSource;
            commitRightPanePresentation(
                reprojectionState.leftSource, "same"
            );
        }
        if (leftCapturedFrame) {
            installLeftGeometryFrame(
                leftCapturedFrame,
                reprojectionState.leftSource,
                renderedView,
                frameIsCurrent
            );
            if (leftCapturedDisposable) {
                leftCapturedFrame.close?.();
            }
        } else if (isFullFrameGpuView(renderedView)
                && isDefaultGpuClippingRange()) {
            captureReprojectionGpuFallback();
        } else {
            clearReprojectionGpuFallback();
        }
        attachReprojectionGpuCanvas();
    } catch (error) {
        if (generation === reprojectionState.generation) {
            setReprojectionStatus(`Failed to render ${image.name}: ${error.message}`, true);
        }
    }
}

function loadReprojectionFrame(index) {
    if (!reprojectionState.images.length) {
        return Promise.resolve(false);
    }
    reprojectionState.frameLoadResolve?.(false);
    let resolveFrameLoad;
    const frameLoaded = new Promise(resolve => { resolveFrameLoad = resolve; });
    reprojectionState.frameLoadResolve = resolveFrameLoad;
    const finishFrameLoad = loaded => {
        if (reprojectionState.frameLoadResolve === resolveFrameLoad) {
            reprojectionState.frameLoadResolve = null;
        }
        resolveFrameLoad(loaded);
    };
    const previousImage = currentReprojectionImage();
    const previousLeftPath = sourceRenderPath(
        reprojectionState.leftSource, previousImage
    );
    const previousRightPath = sourceRenderPath(
        reprojectionState.rightSource, previousImage
    );
    const previousRenderMode = reprojectionState.renderMode;
    reprojectionState.currentIndex = Math.max(
        0, Math.min(reprojectionState.images.length - 1, Number(index))
    );
    const image = reprojectionState.images[reprojectionState.currentIndex];
    syncReprojectionMaskControl();
    const nextLeftPath = sourceRenderPath(reprojectionState.leftSource, image);
    const nextRightPath = sourceRenderPath(reprojectionState.rightSource, image);
    const serverRouteChanged =
        (previousLeftPath !== nextLeftPath
            || previousRightPath !== nextRightPath)
        && (sourceUsesServer(reprojectionState.leftSource, image)
            || sourceUsesServer(reprojectionState.rightSource, image));
    reprojectionState.renderMode = nextLeftPath === "gpu" ? "gpu" : "server";
    reprojectionImageSelect.selectedIndex = reprojectionState.currentIndex;
    const generation = ++reprojectionState.generation;
    window.clearTimeout(reprojectionState.navigationPointTimer);
    window.clearTimeout(reprojectionState.pointSizeRenderTimer);
    window.clearTimeout(reprojectionState.zoomDetailTimer);
    reprojectionState.currentRenderUrl = null;
    reprojectionState.currentRenderView = null;
    reprojectionCloud.style.visibility = "hidden";
    reprojectionCloudSide.style.visibility = "hidden";
    if (previousRenderMode === "gpu") {
        disableReprojectionGpuCanvas();
    }
    setReprojectionStatus(
        `Loading image ${reprojectionState.currentIndex + 1} / ${reprojectionState.images.length}…`
    );

    const urls = reprojectionUrls(image);
    const renderCancellation = previousRenderMode === "server"
        ? cancelReprojectionRender() : Promise.resolve();
    const inputElement = activeReprojectionInput();
    reprojectionInput.onload = null;
    reprojectionInput.onerror = null;
    reprojectionInputSide.onload = null;
    reprojectionInputSide.onerror = null;
    inputElement.onload = () => {
        if (generation !== reprojectionState.generation) {
            return;
        }
        inputElement.onload = null;
        inputElement.onerror = null;
        applyReprojectionViewTransform();
        setReprojectionStatus(
            `${reprojectionState.currentIndex + 1} / ${reprojectionState.images.length}: ${image.name}`
        );
        fitReprojectionSplit();
        // Resolve only after the newly loaded image has had a chance to paint.
        // Otherwise the async repeat loop can replace src from a microtask
        // before the browser ever presents this frame.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => finishFrameLoad(true));
        });
        // Geometry is deliberately delayed until image navigation settles.
        reprojectionState.navigationPointTimer = window.setTimeout(async () => {
            await renderCancellation;
            if (reprojectionState.browserGeometryLoading) {
                return;
            }
            if (sourceUsesGpu(reprojectionState.leftSource, image)) {
                reprojectionState.renderMode = "gpu";
                renderReprojectionGpuFrame(generation);
            } else {
                reprojectionState.renderMode = "server";
                if (serverRouteChanged) {
                    await selectServerSourcesForVisiblePanes(generation);
                } else {
                    requestReprojectionPointLayer(generation);
                }
                const rightSource = reprojectionState.rightSource;
                if (sourceUsesGpu(rightSource, image)) {
                    renderReprojectionRightPane(generation);
                } else if (!serverRouteChanged
                        && sourceUsesServer(rightSource, image)) {
                    renderReprojectionRightPaneServer(generation);
                }
            }
        }, 180);
        window.setTimeout(() => prefetchReprojectionNeighbors(generation), 260);
        if (reprojectionState.viewScale > 1
                && !reprojectionState.navigationPreview) {
            scheduleZoomDetailRefresh(300);
        }
    };
    let inputRetryCount = 0;
    inputElement.onerror = () => {
        if (generation !== reprojectionState.generation) {
            return;
        }
        if (inputRetryCount === 0) {
            inputRetryCount += 1;
            const retryUrl = `${urls.input}&retry=${generation}`;
            reprojectionState.currentInputUrl = retryUrl;
            inputElement.src = retryUrl;
            return;
        }
        setReprojectionStatus(`Failed to load ${image.name}`, true);
        finishFrameLoad(false);
    };
    // Reusing the visible element lets the browser replace an obsolete image
    // request immediately instead of queueing detached preload/decode work.
    const sourceChanged = applyReprojectionInputSource(urls.input);
    if (!sourceChanged && inputElement.complete && inputElement.naturalWidth > 0) {
        queueMicrotask(() => inputElement.onload?.());
    }
    return frameLoaded;
}

function requestReprojectionPointLayer(generation = reprojectionState.generation) {
    if (reprojectionState.renderMode === "gpu") {
        renderReprojectionGpuFrame(generation);
        return;
    }
    reprojectionPointRequester.request(generation);
}

function loadReprojectionPointLayer(delay = 0) {
    window.clearTimeout(reprojectionState.navigationPointTimer);
    window.clearTimeout(reprojectionState.pointSizeRenderTimer);
    if (delay > 0) {
        reprojectionState.pointSizeRenderTimer = window.setTimeout(
            requestReprojectionPointLayer, delay
        );
    } else {
        requestReprojectionPointLayer();
    }
}

async function stepReprojection(direction) {
    const nextIndex = Math.max(0, Math.min(
        reprojectionState.images.length - 1,
        reprojectionState.currentIndex + direction
    ));
    if (nextIndex !== reprojectionState.currentIndex) {
        return await loadReprojectionFrame(nextIndex);
    }
    return false;
}

function stopContinuousNavigation(restoreFullResolution = true) {
    const shouldRestore = reprojectionState.navigationPreview
        && restoreFullResolution
        && reprojectionState.loaded
        && document.body.dataset.viewerMode === "reprojection";
    window.clearTimeout(reprojectionState.navigationHoldDelay);
    window.clearTimeout(reprojectionState.navigationHoldInterval);
    reprojectionState.navigationSession += 1;
    reprojectionState.navigationHoldKey = null;
    reprojectionState.navigationHoldDelay = null;
    reprojectionState.navigationHoldInterval = null;
    reprojectionState.navigationRepeatDelay = 110;
    reprojectionState.navigationPreview = false;
    if (shouldRestore) {
        loadReprojectionFrame(reprojectionState.currentIndex);
    }
}

function startContinuousNavigation(key, direction) {
    if (reprojectionState.navigationHoldKey === key) {
        return;
    }
    stopContinuousNavigation(false);
    reprojectionState.navigationHoldKey = key;
    const session = reprojectionState.navigationSession;
    const startedAt = performance.now();
    const waitForNavigationTimer = (field, delay) => new Promise(resolve => {
        reprojectionState[field] = window.setTimeout(resolve, delay);
    });
    const run = async () => {
        if (!await stepReprojection(direction)) {
            return;
        }
        const initialDelay = Math.max(0, 250 - (performance.now() - startedAt));
        await waitForNavigationTimer("navigationHoldDelay", initialDelay);
        if (reprojectionState.navigationSession !== session
                || reprojectionState.navigationHoldKey !== key) {
            return;
        }
        reprojectionState.navigationPreview = true;
        while (reprojectionState.navigationSession === session
                && reprojectionState.navigationHoldKey === key) {
            if (!await stepReprojection(direction)) {
                break;
            }
            reprojectionState.navigationRepeatDelay = Math.max(
                50, reprojectionState.navigationRepeatDelay - 8
            );
            await waitForNavigationTimer(
                "navigationHoldInterval",
                reprojectionState.navigationRepeatDelay
            );
        }
    };
    void run();
}

function applyReprojectionFlip() {
    applyReprojectionViewTransform();
}

function requestClippingPlaneRender() {
    clippingRenderScheduler.request(async () => {
        const generation = reprojectionState.generation;
        if (reprojectionState.renderMode === "gpu") {
            await renderReprojectionGpuFrame(generation);
        } else if (sourceUsesGpu(reprojectionState.rightSource)) {
            await renderReprojectionRightPane(generation);
        }
        if (sourceUsesServer(reprojectionState.leftSource)) {
            requestReprojectionPointLayer(generation);
        }
        if (sourceUsesServer(reprojectionState.rightSource)) {
            renderReprojectionRightPaneServer(generation);
        }
    });
}

function resetReprojectionClippingPlanes() {
    reprojectionState.nearClipFraction = 0;
    reprojectionState.farClipFraction = 1;
    if (reprojectionGpuRenderer) {
        reprojectionGpuRenderer.setClippingRange(0, 1);
    }
    setReprojectionStatus("Clipping planes reset.");
    requestClippingPlaneRender();
}

function stepReprojectionClippingPlane(plane, direction, increment) {
    const oldNear = reprojectionState.nearClipFraction;
    const oldFar = reprojectionState.farClipFraction;
    const range = ReprojectionClippingScroll.adjustRange(
        oldNear, oldFar, plane, direction, increment
    );
    reprojectionState.nearClipFraction = range.near;
    reprojectionState.farClipFraction = range.far;
    if (oldNear === reprojectionState.nearClipFraction
            && oldFar === reprojectionState.farClipFraction) {
        return;
    }
    reprojectionGpuRenderer?.setClippingRange(
        reprojectionState.nearClipFraction,
        reprojectionState.farClipFraction
    );
    if (!isDefaultGpuClippingRange()) {
        clearReprojectionGpuFallback();
    }
    setReprojectionStatus(
        `Clipping depth: near ${(
            reprojectionState.nearClipFraction * 100
        ).toFixed(1)}%, far ${(
            reprojectionState.farClipFraction * 100
        ).toFixed(1)}%`
    );
    requestClippingPlaneRender();
}

function setReprojectionPointSize(value) {
    const size = ReprojectionPointSize.normalize(value);
    reprojectionPointSize.value = size;
    reprojectionGpuRenderer?.setPointSize(size);
    const leftSource = reprojectionState.leftSource;
    const rightSource = reprojectionState.rightSource;
    const leftIsPoints = paneSources.isPointCloud(
        leftSource, reprojectionState.loadedGeometries
    );
    const rightIsPoints = paneSources.isPointCloud(
        rightSource, reprojectionState.loadedGeometries
    );
    const generation = reprojectionState.generation;
    const delay = size < 1 ? 60 : 0;
    const refreshServerPanes = () => {
        if (generation !== reprojectionState.generation) {
            return;
        }
        if (reprojectionState.renderMode === "server"
                && paneSources.isPointCloud(
                    reprojectionState.leftSource,
                    reprojectionState.loadedGeometries
                )
                && !reprojectionState.serverSelectionPending) {
            requestReprojectionPointLayer(generation);
        }
        if (sourceUsesServer(reprojectionState.rightSource)) {
            renderReprojectionRightPaneServer(generation);
        }
    };
    const scheduleServerRefresh = () => {
        window.clearTimeout(reprojectionState.pointSizeRenderTimer);
        if (delay > 0) {
            reprojectionState.pointSizeRenderTimer = window.setTimeout(
                refreshServerPanes, delay
            );
        } else {
            reprojectionState.pointSizeRenderTimer = null;
            refreshServerPanes();
        }
    };
    if (reprojectionState.renderMode === "gpu") {
        if (leftIsPoints
                || (rightIsPoints && sourceUsesGpu(rightSource))) {
            renderReprojectionGpuFrame(generation);
        }
        if (rightIsPoints && sourceUsesServer(rightSource)) {
            scheduleServerRefresh();
        }
        return;
    }
    // Normal sizes reuse cached projection/splat data and should respond on
    // every wheel step. Only fractional sizes require a cold supersampled
    // render, so coalesce that short three-step range.
    scheduleServerRefresh();
    if (rightIsPoints && sourceUsesGpu(rightSource)) {
        renderReprojectionRightPane(generation);
    }
}

function stepReprojectionPointSize(direction) {
    setReprojectionPointSize(
        ReprojectionPointSize.step(reprojectionPointSize.value, direction)
    );
}

function applyReprojectionPointColor() {
    reprojectionGpuRenderer?.setPointColorMode(reprojectionColor.value);
    if (reprojectionState.renderMode === "gpu") {
        renderReprojectionGpuFrame(reprojectionState.generation);
        return;
    }
    loadReprojectionPointLayer();
    if (sourceUsesGpu(reprojectionState.rightSource)) {
        renderReprojectionRightPane(reprojectionState.generation);
    } else if (sourceUsesServer(reprojectionState.rightSource)) {
        renderReprojectionRightPaneServer(reprojectionState.generation);
    }
}

viewerModeSelect.addEventListener("change", () => setViewerMode(viewerModeSelect.value));
reprojectionImageSelect.addEventListener("change", () => {
    loadReprojectionFrame(reprojectionImageSelect.selectedIndex);
});
reprojectionColor.addEventListener("change", applyReprojectionPointColor);
reprojectionPointSize.addEventListener("change", () => {
    setReprojectionPointSize(reprojectionPointSize.value);
});
reprojectionMeshShading.addEventListener("change", () => {
    getReprojectionGpuRenderer().setMeshShading(reprojectionMeshShading.value);
    if (reprojectionState.renderMode === "gpu") {
        renderReprojectionGpuFrame(reprojectionState.generation);
    }
});
reprojectionMeshColor.addEventListener("change", () => {
    getReprojectionGpuRenderer().setMeshColor(reprojectionMeshColor.value);
    if (reprojectionState.renderMode === "gpu") {
        renderReprojectionGpuFrame(reprojectionState.generation);
    }
});
// Mip-Splatting defaults to a 0.1 kernel; unchecked uses the original 3DGS
// 0.3 dilation with no opacity compensation. The last Mip kernel is remembered
// so toggling the mode restores it (while the disabled input shows the real
// 0.3 value used by the original formula).
const REPROJECTION_ORIGINAL_KERNEL = 0.3;
let reprojectionMipKernel = 0.1;
function commitReprojectionGsplatFilter(mipKernel) {
    const mip = reprojectionGsplatAa.checked;
    reprojectionGsplatKernel.disabled = !mip;
    const kernelSize = mip ? mipKernel : REPROJECTION_ORIGINAL_KERNEL;
    const applied = getReprojectionGpuRenderer().setGaussianSplatFilter({
        antiAlias: mip,
        kernelSize,
    });
    const effective = applied && Number.isFinite(applied.kernelSize)
        ? applied.kernelSize
        : kernelSize;
    reprojectionGsplatKernel.value = effective;
    if (mip) {
        reprojectionMipKernel = effective;
    }
    if (reprojectionState.renderMode === "gpu") {
        renderReprojectionGpuFrame(reprojectionState.generation);
    }
}
reprojectionGsplatAa.addEventListener("change", () => {
    commitReprojectionGsplatFilter(reprojectionMipKernel);
});
reprojectionGsplatKernel.addEventListener("change", () => {
    const value = Number(reprojectionGsplatKernel.value);
    commitReprojectionGsplatFilter(
        Number.isFinite(value) && value > 0 ? value : reprojectionMipKernel
    );
});
function applyMeshBrightness(value = reprojectionMeshBrightnessValue.value) {
    const normalized = getReprojectionGpuRenderer().setMeshBrightness(
        value
    );
    reprojectionMeshBrightness.value = normalized;
    reprojectionMeshBrightnessValue.value = normalized.toFixed(2);
    if (reprojectionState.renderMode === "gpu") {
        renderReprojectionGpuFrame(reprojectionState.generation);
    }
}

reprojectionMeshBrightness.addEventListener("input", () => {
    const value = Number(reprojectionMeshBrightness.value);
    reprojectionMeshBrightnessValue.value = value.toFixed(2);
    window.clearTimeout(reprojectionState.meshBrightnessTimer);
    reprojectionState.meshBrightnessTimer = window.setTimeout(
        () => applyMeshBrightness(value), 120
    );
});
reprojectionMeshBrightness.addEventListener("change", () => {
    window.clearTimeout(reprojectionState.meshBrightnessTimer);
    applyMeshBrightness(reprojectionMeshBrightness.value);
});
reprojectionMeshBrightnessValue.addEventListener("input", () => {
    const value = Number(reprojectionMeshBrightnessValue.value);
    if (!Number.isFinite(value)) {
        return;
    }
    reprojectionMeshBrightness.value = value;
    window.clearTimeout(reprojectionState.meshBrightnessTimer);
    reprojectionState.meshBrightnessTimer = window.setTimeout(
        () => applyMeshBrightness(value), 120
    );
});
reprojectionMeshBrightnessValue.addEventListener("change", () => {
    window.clearTimeout(reprojectionState.meshBrightnessTimer);
    applyMeshBrightness(reprojectionMeshBrightnessValue.value);
});
function applyBackgroundColors() {
    const category = backgroundCategory();
    const colors = reprojectionState.backgroundColors[category];
    colors.top = reprojectionBackgroundTop.value;
    colors.bottom = reprojectionBackgroundBottom.value;
    reprojectionViewer.style.setProperty(
        "--reprojection-bg",
        backgroundGradientForKind(reprojectionState.geometryKind)
    );
    syncRightPaneBackground(reprojectionState.rightRenderedSource);
}

[reprojectionBackgroundTop, reprojectionBackgroundBottom].forEach(input => {
    input.addEventListener("input", () => applyBackgroundColors());
    input.addEventListener("change", () => applyBackgroundColors());
});
reprojectionFlip.addEventListener("change", applyReprojectionFlip);
reprojectionMask.addEventListener("change", () => {
    syncReprojectionMaskControl();
    if (reprojectionState.loaded) {
        refreshReprojectionInputMask();
    }
});
reprojectionInvertMask.addEventListener("change", () => {
    if (reprojectionState.loaded) {
        refreshReprojectionInputMask();
    }
});
reprojectionShowOutsideFrame.addEventListener("change", () => {
    applyReprojectionViewTransform();
    if (!reprojectionState.loaded) {
        return;
    }
    if (reprojectionState.renderMode === "gpu") {
        renderReprojectionGpuFrame(reprojectionState.generation);
    } else {
        requestReprojectionPointLayer(reprojectionState.generation);
        if (sourceUsesServer(reprojectionState.rightSource)) {
            renderReprojectionRightPaneServer(reprojectionState.generation);
        } else if (sourceUsesGpu(reprojectionState.rightSource)) {
            renderReprojectionRightPane(reprojectionState.generation);
        }
    }
});
reprojectionSplitAngle.addEventListener("change", () => {
    reprojectionInteraction.setAngle(
        ReprojectionSplitGeometry.normalizedAngle(reprojectionSplitAngle.value)
    );
});
reprojectionResetView.addEventListener("click", resetReprojectionViewTransform);
reprojectionResetDivider.addEventListener("click", () => {
    reprojectionInteraction.resetDivider();
});
reprojectionResetClipping.addEventListener(
    "click", resetReprojectionClippingPlanes
);
reprojectionGeometryDrop.addEventListener("click", () => reprojectionGeometryFile.click());
reprojectionGeometryDrop.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        reprojectionGeometryFile.click();
    }
});
reprojectionGeometryFile.addEventListener("change", () => {
    loadReprojectionGeometry(reprojectionGeometryFile.files[0]);
});
reprojectionClearGeometries.addEventListener("click", clearLoadedGeometries);
reprojectionLoadLocalPath.addEventListener(
    "click", loadLocalReprojectionGeometry
);
reprojectionLocalPath.addEventListener("keydown", event => {
    if (event.key === "Enter") {
        event.preventDefault();
        loadLocalReprojectionGeometry();
    }
});
reprojectionLeftSource.addEventListener("change", () => applyPaneSource("left"));
reprojectionRightSource.addEventListener("change", () => applyPaneSource("right"));
[reprojectionGeometryDrop, reprojectionViewer].forEach(target => {
    target.addEventListener("dragenter", handleGeometryDrag);
    target.addEventListener("dragover", handleGeometryDrag);
    target.addEventListener("dragleave", handleGeometryDrag);
    target.addEventListener("drop", handleGeometryDrop);
});
reprojectionLayout.addEventListener("change", () => {
    const sideBySide = reprojectionLayout.value === "side";
    reprojectionSplitAngle.disabled = sideBySide;
    reprojectionSplit.hidden = sideBySide;
    reprojectionSide.hidden = !sideBySide;
    if (!sideBySide) {
        fitReprojectionSplit();
    }
    syncActiveReprojectionSources();
    resetReprojectionViewTransform();
    if (reprojectionState.renderMode === "gpu") {
        renderReprojectionGpuFrame(reprojectionState.generation);
    }
});
reprojectionSourceLabelMode.addEventListener(
    "change", showReprojectionSourceBadges
);
showReprojectionSourceBadges();
reprojectionInteraction.attach();
reprojectionViewer.addEventListener("wheel", event => {
    if (event.altKey) {
        event.preventDefault();
        const plane = event.shiftKey ? "near" : "far";
        const elapsedMs = plane === lastClippingWheelPlane
            ? event.timeStamp - lastClippingWheelTime
            : Infinity;
        const increment = ReprojectionClippingScroll.adaptiveStep(
            event.deltaY, elapsedMs, event.deltaMode
        );
        lastClippingWheelTime = event.timeStamp;
        lastClippingWheelPlane = plane;
        const direction = event.deltaY < 0 ? 1 : -1;
        stepReprojectionClippingPlane(plane, direction, increment);
    } else if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const direction = event.deltaY < 0 ? 1 : -1;
        stepReprojectionPointSize(direction);
    } else {
        event.preventDefault();
        zoomReprojectionView(event);
    }
}, {passive: false});
window.addEventListener("resize", () => {
    fitReprojectionSplit();
    if (reprojectionState.renderMode === "gpu") {
        scheduleZoomDetailRefresh(100);
    }
});
window.addEventListener("keydown", event => {
    if (document.body.dataset.viewerMode !== "reprojection") {
        return;
    }
    // Preserve caret/number-field behavior, but intentionally capture arrows
    // even when the registered-image dropdown still has focus.
    const keyTarget = event.target;
    if (keyTarget instanceof HTMLInputElement
            || keyTarget instanceof HTMLTextAreaElement
            || keyTarget.isContentEditable) {
        return;
    }
    if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (!event.repeat) {
            startContinuousNavigation(event.key, -1);
        }
    } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (!event.repeat) {
            startContinuousNavigation(event.key, 1);
        }
    } else if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        cyclePaneSource("left", event.shiftKey ? -1 : 1);
    } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        cyclePaneSource("right", event.shiftKey ? -1 : 1);
    } else if (event.key.toLowerCase() === "m"
            && !event.repeat
            && !reprojectionMask.disabled) {
        event.preventDefault();
        reprojectionMask.click();
    } else if (event.key.toLowerCase() === "i"
            && !event.repeat
            && !reprojectionInvertMask.disabled) {
        event.preventDefault();
        reprojectionInvertMask.click();
    }
});
window.addEventListener("keyup", event => {
    if (event.key === reprojectionState.navigationHoldKey) {
        stopContinuousNavigation();
    }
});
window.addEventListener("blur", stopContinuousNavigation);
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
        heartbeatReprojectionStream();
    }
});
setInterval(heartbeatReprojectionStream, 30_000);
heartbeatReprojectionStream();

const reprojectionCapabilityReady = initializeReprojectionCapability();
reprojectionCapabilityReady.then(async () => {
    if (reprojectionState.configuredGeometries.length) {
        // Preserve startup responsiveness for the default matching viewer.
        // Server-side mesh preparation is already running independently.
        await globalThis.matchingInitialViewReady?.catch(() => {});
        // Warm only lightweight registered-image metadata in the browser.
        // Exact geometry parsing and GPU upload begin when reprojection opens.
        ensureReprojectionImages(false);
    }
});
