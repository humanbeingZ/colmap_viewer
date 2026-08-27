const viewerModeSelect = document.getElementById("viewer-mode-select");
const matchingControls = document.getElementById("matching-controls");
const reprojectionControls = document.getElementById("reprojection-controls");
const matchingViewer = document.getElementById("matching-viewer");
const reprojectionViewer = document.getElementById("reprojection-viewer");
const reprojectionImageSelect = document.getElementById("reprojection-image-select");
const reprojectionStatus = document.getElementById("reprojection-status");
const reprojectionSplit = document.getElementById("reprojection-split");
const reprojectionSide = document.getElementById("reprojection-side");
const reprojectionInputLayer = document.getElementById("reprojection-input-layer");
const reprojectionInput = document.getElementById("reprojection-input");
const reprojectionInputSide = document.getElementById("reprojection-input-side");
const reprojectionCloud = document.getElementById("reprojection-cloud");
const reprojectionCloudSide = document.getElementById("reprojection-cloud-side");
const reprojectionGpuFallback = document.getElementById(
    "reprojection-gpu-fallback"
);
const reprojectionGpuCanvas = document.getElementById("reprojection-gpu");
const reprojectionDivider = document.getElementById("reprojection-divider");
const reprojectionLayout = document.getElementById("reprojection-layout");
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
const reprojectionBackgroundTop = document.getElementById(
    "reprojection-background-top"
);
const reprojectionBackgroundBottom = document.getElementById(
    "reprojection-background-bottom"
);
const reprojectionFlip = document.getElementById("reprojection-flip");
const reprojectionResetView = document.getElementById("reprojection-reset-view");
const reprojectionResetDivider = document.getElementById("reprojection-reset-divider");
const reprojectionLeftSource = document.getElementById("reprojection-left-source");
const reprojectionRightSource = document.getElementById("reprojection-right-source");
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

async function recoverFromLateIdentityCollision(replacementStream) {
    if (reprojectionIdentity.id !== replacementStream) {
        return;
    }
    reprojectionUploadController?.abort();
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

const reprojectionState = {
    images: [],
    datasetNamespace: "uninitialized",
    geometryCacheToken: "colmap",
    geometryKind: "colmap",
    loaded: false,
    currentIndex: 0,
    generation: 0,
    pointGeneration: 0,
    splitPercent: 50,
    splitAngle: 0,
    viewScale: 1,
    viewTranslateX: 0,
    viewTranslateY: 0,
    maxSize: 1600,
    maxRenderSize: null,
    maxInputSize: 8192,
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
    navigationPreview: false,
    navigationPreviewSize: 768,
    currentInputUrl: null,
    currentRenderUrl: null,
    currentRenderView: null,
    renderMode: "server",
    configuredGeometry: null,
    browserGeometryLoading: false,
    pointRenderedView: {scale: 1, translateX: 0, translateY: 0},
    gpuRenderedView: {scale: 1, translateX: 0, translateY: 0},
    gpuFallbackReady: false,
    gpuFrameRequest: 0,
    gpuRenderedSource: null,
    rightRenderedView: {scale: 1, translateX: 0, translateY: 0},
    rightRenderedSource: "image",
    loadedGeometries: [],
    leftSource: "colmap",
    rightSource: "image",
    rightRenderObjectUrl: null,
};

let reprojectionGpuRenderer = null;

function getReprojectionGpuRenderer() {
    if (!reprojectionGpuRenderer) {
        if (!globalThis.ReprojectionGpu?.ReprojectionGpuRenderer) {
            throw new Error("The browser GPU renderer did not load");
        }
        reprojectionGpuRenderer = new ReprojectionGpu.ReprojectionGpuRenderer(
            reprojectionGpuCanvas
        );
        reprojectionGpuRenderer.setPointSize(reprojectionPointSize.value);
    }
    return reprojectionGpuRenderer;
}

function rebuildPaneSourceOptions() {
    const geometries = reprojectionState.loadedGeometries;
    const leftValue = reprojectionLeftSource.value;
    const rightValue = reprojectionRightSource.value;

    reprojectionLeftSource.innerHTML = "";
    reprojectionRightSource.innerHTML = "";

    const leftColmap = document.createElement("option");
    leftColmap.value = "colmap";
    leftColmap.textContent = "COLMAP points";
    reprojectionLeftSource.appendChild(leftColmap);

    const rightImage = document.createElement("option");
    rightImage.value = "image";
    rightImage.textContent = "Camera image";
    reprojectionRightSource.appendChild(rightImage);
    const rightColmap = document.createElement("option");
    rightColmap.value = "colmap";
    rightColmap.textContent = "COLMAP points";
    reprojectionRightSource.appendChild(rightColmap);

    for (const geo of geometries) {
        const leftOpt = document.createElement("option");
        leftOpt.value = geo.gpuKey;
        leftOpt.textContent = geo.name;
        reprojectionLeftSource.appendChild(leftOpt);

        const rightOpt = document.createElement("option");
        rightOpt.value = geo.gpuKey;
        rightOpt.textContent = geo.name;
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
}

function applyPaneSource(pane) {
    const value = pane === "left"
        ? reprojectionLeftSource.value
        : reprojectionRightSource.value;
    if (pane === "left") {
        reprojectionState.leftSource = value;
    } else {
        reprojectionState.rightSource = value;
        reprojectionInputLayer.classList.toggle(
            "geometry-active",
            paneSources.isGeometry(value)
        );
    }
    refreshReprojectionPanes();
}

function cyclePaneSource(pane, direction = 1) {
    const select = pane === "left" ? reprojectionLeftSource : reprojectionRightSource;
    const options = [...select.options];
    if (options.length <= 1) {
        return;
    }
    const currentIndex = options.findIndex(opt => opt.value === select.value);
    const nextIndex = paneSources.cycleIndex(
        currentIndex, options.length, direction
    );
    select.value = options[nextIndex].value;
    applyPaneSource(pane);
}

function refreshReprojectionPanes() {
    const leftSource = reprojectionState.leftSource;
    const rightSource = reprojectionState.rightSource;
    const generation = reprojectionState.generation;

    const leftIsGpu = paneSources.isGpuGeometry(leftSource);
    const rightIsGpu = paneSources.isGpuGeometry(rightSource);
    if (!leftIsGpu || !rightIsGpu || reprojectionLayout.value === "side") {
        reprojectionInputLayer.classList.remove("gpu-composited");
    }
    const sourcesMatch = leftIsGpu && rightIsGpu && leftSource === rightSource;
    const awaitingDifferentRightGeometry = rightIsGpu
        && reprojectionInputLayer.classList.contains("same-geometry")
        && reprojectionState.rightRenderedSource !== rightSource;
    if (sourcesMatch) {
        reprojectionInputLayer.classList.add("same-geometry");
    } else if (!awaitingDifferentRightGeometry) {
        reprojectionInputLayer.classList.remove("same-geometry");
    }

    if (leftIsGpu) {
        const renderer = getReprojectionGpuRenderer();
        const sourceAlreadyVisible =
            reprojectionState.gpuRenderedSource === leftSource;
        const canKeepCurrentFrame =
            reprojectionGpuCanvas.classList.contains("active");
        if (!sourceAlreadyVisible && !canKeepCurrentFrame) {
            disableReprojectionGpuCanvas();
        } else if (!sourceAlreadyVisible) {
            reprojectionState.gpuFallbackReady = false;
            reprojectionGpuFallback.classList.remove("active");
        }
        reprojectionState.renderMode = "gpu";
        const geo = reprojectionState.loadedGeometries.find(
            g => g.gpuKey === leftSource
        );
        if (geo) {
            applyGeometryStatus({
                name: geo.name,
                kind: geo.kind,
                point_count: geo.count,
                cache_token: `browser-${leftSource}`,
                gpu: true,
            });
        }
        if (sourceAlreadyVisible || canKeepCurrentFrame) {
            attachReprojectionGpuCanvas();
        }
        renderReprojectionGpuFrame(generation);
    } else if (paneSources.isColmap(leftSource)) {
        reprojectionState.renderMode = "server";
        disableReprojectionGpuCanvas();
        applyGeometryStatus({
            name: "COLMAP points3D",
            kind: "colmap",
            point_count: 0,
            cache_token: "colmap",
            gpu: false,
        });
        requestReprojectionPointLayer(generation);
    }

    if (rightIsGpu && !leftIsGpu) {
        renderReprojectionRightPane(generation);
    } else if (paneSources.isColmap(rightSource)) {
        renderReprojectionRightPaneServer(generation);
    } else if (paneSources.isImage(rightSource)) {
        refreshReprojectionInputVisibility();
    }
}

function clearRightPaneGeometry() {
    if (reprojectionState.rightRenderObjectUrl) {
        URL.revokeObjectURL(reprojectionState.rightRenderObjectUrl);
        reprojectionState.rightRenderObjectUrl = null;
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
                target.style.visibility = "";
                clearRightPaneGeometry();
                applyReprojectionViewTransform();
            };
            preload.src = url;
            return;
        }
        inputElement.style.visibility = "";
        reprojectionState.rightRenderedSource = "image";
    }
}

async function installRightGeometryBlob(blob, source, renderedView, isCurrent) {
    if (!blob) {
        return false;
    }
    const url = URL.createObjectURL(blob);
    const preload = new Image();
    preload.src = url;
    try {
        await preload.decode();
    } catch (error) {
        URL.revokeObjectURL(url);
        throw new Error(`Unable to decode the right-pane render: ${error.message}`);
    }
    if (!isCurrent()) {
        URL.revokeObjectURL(url);
        return false;
    }
    const oldUrl = reprojectionState.rightRenderObjectUrl;
    reprojectionState.rightRenderObjectUrl = url;
    reprojectionState.rightRenderedView = {...renderedView};
    reprojectionState.rightRenderedSource = source;
    const inputElement = activeReprojectionInput();
    inputElement.src = url;
    reprojectionInputLayer.classList.remove("same-geometry");
    inputElement.style.visibility = "";
    applyRightPaneCaptureTransform(inputElement);
    if (oldUrl) {
        URL.revokeObjectURL(oldUrl);
    }
    return true;
}

async function renderReprojectionRightPane(generation) {
    const rightSource = reprojectionState.rightSource;
    if (!paneSources.isGpuGeometry(rightSource)) {
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
        const blob = await renderer.captureGeometry(
            rightSource, image, renderSize.width, renderSize.height, region,
            confineGeometryToImageFrame()
        );
        await installRightGeometryBlob(
            blob,
            rightSource,
            renderedView,
            () => generation === reprojectionState.generation
                && reprojectionState.rightSource === rightSource
        );
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
    if (!paneSources.isColmap(reprojectionState.rightSource)) {
        return;
    }
    const image = reprojectionState.images[reprojectionState.currentIndex];
    if (!image) {
        return;
    }
    const renderedView = currentReprojectionView();
    const urls = reprojectionUrls(
        image, reprojectionIdentity.id, currentPreviewMaxSize(), renderedView,
        null
    );
    const preload = new Image();
    preload.onload = () => {
        if (generation !== reprojectionState.generation
                || !paneSources.isColmap(reprojectionState.rightSource)) {
            return;
        }
        const inputElement = activeReprojectionInput();
        reprojectionState.rightRenderedView = {...renderedView};
        reprojectionState.rightRenderedSource = "colmap";
        inputElement.src = urls.render;
        inputElement.style.visibility = "";
        clearRightPaneGeometry();
        applyRightPaneCaptureTransform(inputElement);
    };
    preload.src = urls.render;
}

function applyGpuComparisonSplit(split) {
    if (!reprojectionInputLayer.classList.contains("gpu-composited")
            || !reprojectionGpuRenderer
            || reprojectionLayout.value !== "split") {
        return;
    }
    if (!reprojectionGpuRenderer.hasComparison(
        reprojectionState.leftSource,
        reprojectionState.rightSource
    )) {
        return;
    }
    reprojectionGpuRenderer.updateComparisonSplit(
        reprojectionGpuCanvas.width,
        reprojectionGpuCanvas.height,
        split
    );
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
    applySplitRender: applyGpuComparisonSplit,
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
    syncReprojectionBackgroundControls(geometry.kind, Boolean(geometry.gpu));
}

function backgroundCategory(kind = reprojectionState.geometryKind) {
    return kind === "gaussian splats" ? "gaussian" : "surface";
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
            `linear-gradient(to bottom, ${colors.top}, ${colors.bottom})`
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
        reprojectionState.configuredGeometry = capabilities.configured_geometry;
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

async function ensureReprojectionImages() {
    if (reprojectionState.loaded) {
        return;
    }
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

        // When possible, carry Image 1 across from match mode.
        const matchImageId = image1Select.value;
        const matchingIndex = reprojectionState.images.findIndex(
            image => String(image.id) === String(matchImageId)
        );
        reprojectionState.currentIndex = matchingIndex >= 0 ? matchingIndex : 0;
        reprojectionImageSelect.selectedIndex = reprojectionState.currentIndex;
        loadReprojectionFrame(reprojectionState.currentIndex);
        if (reprojectionState.configuredGeometry) {
            const result = await loadConfiguredReprojectionGeometry(
                reprojectionState.configuredGeometry
            );
            if (result !== configuredGeometryLoadResult.loaded
                    && reprojectionState.renderMode === "server") {
                requestReprojectionPointLayer(reprojectionState.generation);
            }
            return;
        }
    } catch (error) {
        setReprojectionStatus(error.message, true);
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
        const pane = reprojectionSide.querySelector(".reprojection-pane");
        if (reprojectionGpuFallback.parentElement !== pane) {
            pane.insertBefore(reprojectionGpuFallback, reprojectionCloudSide);
        }
        if (reprojectionGpuCanvas.parentElement !== pane) {
            pane.insertBefore(reprojectionGpuCanvas, reprojectionCloudSide);
        }
    } else {
        reprojectionGpuFallback.style.left = "";
        reprojectionGpuFallback.style.top = "";
        reprojectionGpuFallback.style.width = "";
        reprojectionGpuFallback.style.height = "";
        if (reprojectionGpuFallback.parentElement !== reprojectionSplit) {
            reprojectionSplit.insertBefore(reprojectionGpuFallback, reprojectionCloud);
        }
        if (reprojectionGpuCanvas.parentElement !== reprojectionSplit) {
            reprojectionSplit.insertBefore(reprojectionGpuCanvas, reprojectionCloud);
        }
    }
    reprojectionGpuFallback.classList.toggle(
        "active", reprojectionState.gpuFallbackReady
    );
    reprojectionGpuCanvas.classList.add("active");
    if (reprojectionLayout.value === "side") {
        // The detailed canvas remains the centered flex item. Overlay the
        // snapshot on its exact untransformed box without adding a second
        // flex item that would shrink or displace it.
        reprojectionGpuFallback.style.left = `${reprojectionGpuCanvas.offsetLeft}px`;
        reprojectionGpuFallback.style.top = `${reprojectionGpuCanvas.offsetTop}px`;
        reprojectionGpuFallback.style.width = `${reprojectionGpuCanvas.clientWidth}px`;
        reprojectionGpuFallback.style.height = `${reprojectionGpuCanvas.clientHeight}px`;
    }
    reprojectionCloud.style.visibility = "hidden";
    reprojectionCloudSide.style.visibility = "hidden";
}

function disableReprojectionGpuCanvas() {
    reprojectionState.gpuFallbackReady = false;
    reprojectionGpuFallback.classList.remove("active");
    reprojectionGpuFallback.style.transform = "";
    reprojectionGpuCanvas.classList.remove("active");
    reprojectionGpuCanvas.style.transform = "";
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
            setImageTransform(reprojectionGpuFallback);
            applyGeometryFrameClip(
                reprojectionGpuFallback,
                {scale: 1, translateX: 0, translateY: 0}
            );
            applyReprojectionGpuViewTransform();
        }
        if (rightIsRenderedGeometry) {
            applyRightPaneCaptureTransform(reprojectionInputSide);
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
            setImageTransform(reprojectionGpuFallback);
            applyGeometryFrameClip(
                reprojectionGpuFallback,
                {scale: 1, translateX: 0, translateY: 0}
            );
            applyReprojectionGpuViewTransform();
        }
        if (rightIsRenderedGeometry) {
            applyRightPaneCaptureTransform(reprojectionInput);
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
    const context = reprojectionGpuFallback.getContext("2d", {alpha: true});
    reprojectionGpuFallback.width = reprojectionGpuCanvas.width;
    reprojectionGpuFallback.height = reprojectionGpuCanvas.height;
    context.drawImage(reprojectionGpuCanvas, 0, 0);
    reprojectionState.gpuFallbackReady = true;
}

function isFullFrameGpuView(view) {
    return Math.abs(view.scale - 1) < 1e-6
        && Math.abs(view.translateX) < 1e-6
        && Math.abs(view.translateY) < 1e-6;
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
    applyGeometryFrameClip(reprojectionGpuCanvas, reprojectionState.gpuRenderedView);
}

function reprojectionDisplaySize(image) {
    if (reprojectionLayout.value !== "side") {
        return {
            width: reprojectionSplit.clientWidth,
            height: reprojectionSplit.clientHeight,
        };
    }
    const pane = reprojectionSide.querySelector(".reprojection-pane");
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

function activeReprojectionInput() {
    return reprojectionLayout.value === "side"
        ? reprojectionInputSide
        : reprojectionInput;
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
        target.style.visibility = "visible";
        applyReprojectionViewTransform();
    };
    target.onload = commitRenderedView;
    target.src = url;
    target.style.visibility = "visible";
    if (target.complete && target.naturalWidth > 0) {
        queueMicrotask(commitRenderedView);
    }
}

function activeReprojectionCloud() {
    return reprojectionLayout.value === "side"
        ? reprojectionCloudSide
        : reprojectionCloud;
}

function syncActiveReprojectionSources() {
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
            if (paneSources.isGpuGeometry(reprojectionState.rightSource)) {
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

function pointRenderParameters() {
    return ReprojectionPointSize.renderParameters({
        pointSize: reprojectionPointSize.value,
        baseMaxSize: currentPreviewMaxSize(),
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
    const geometry = geometryToken === null
        ? "" : `&geometry=${encodeURIComponent(geometryToken)}`;
    const pointRender = pointRenderParameters();
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
            + `&format=jpeg-v1&dataset=${dataset}&stream=${stream}`,
        render: `${base}/render?max_size=${pointRender.maxSize}`
            + `&color=${encodeURIComponent(reprojectionColor.value)}`
            + `&radius=${pointRender.radius}&dataset=${dataset}&stream=${stream}`
            + `${geometry}&format=png-v3`
            + `&left=${region.left}&right=${region.right}`
            + `&top=${region.top}&bottom=${region.bottom}`
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
    reprojectionState.browserGeometryLoading = false;
    if (clearDropState) {
        reprojectionGeometryDrop.classList.remove("loading", "drag-over");
    }
    return reprojectionUploadGeneration;
}

async function uploadServerGeometry(file) {
    if (!file || !file.name.toLowerCase().endsWith(".ply")) {
        setReprojectionStatus("Only PLY point clouds and meshes are supported.", true);
        return;
    }
    await reprojectionIdentityReady;
    const generation = supersedeGeometryLoad();
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
        if (reprojectionGpuRenderer) {
            await reprojectionGpuRenderer.disposeGeometry();
        }
        reprojectionState.renderMode = "server";
        disableReprojectionGpuCanvas();
        applyGeometryStatus(geometry);
        if (reprojectionState.loaded) {
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
    }
}

async function loadReprojectionGeometry(file) {
    if (!file || !file.name.toLowerCase().endsWith(".ply")) {
        setReprojectionStatus("Only PLY point clouds and meshes are supported.", true);
        return;
    }
    const image = reprojectionState.images[reprojectionState.currentIndex];
    let kind;
    try {
        kind = await ReprojectionGpu.ReprojectionGpuRenderer.inspectFile(file);
    } catch (error) {
        setReprojectionStatus(`Failed to inspect ${file.name}: ${error.message}`, true);
        return;
    }

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

async function loadConfiguredReprojectionGeometry(configuredGeometry) {
    const image = reprojectionState.images[reprojectionState.currentIndex];
    if (!image) {
        return configuredGeometryLoadResult.deferred;
    }
    if (!ReprojectionGpu.isPinholeCamera(image)) {
        await activateConfiguredServerGeometry(configuredGeometry);
        return configuredGeometryLoadResult.loaded;
    }
    const installed = await installBrowserGeometry(
        configuredGeometry.name,
        configuredBrowserGeometryLoader(configuredGeometry, image)
    );
    return installed
        ? configuredGeometryLoadResult.loaded
        : configuredGeometryLoadResult.failed;
}

async function activateConfiguredServerGeometry(configuredGeometry) {
    setReprojectionStatus(
        `Preparing ${configuredGeometry.name} for server rendering…`
    );
    if (!configuredGeometry.server_loaded) {
        const geometryStatus = await reprojectionApi.activateConfiguredGeometry(
            configuredGeometry.activate_url
        );
        configuredGeometry.server_loaded = true;
        applyGeometryStatus(geometryStatus);
    }
    reprojectionState.renderMode = "server";
    if (reprojectionState.loaded) {
        requestReprojectionPointLayer(reprojectionState.generation);
    }
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
            configuredGeometry.url, configuredGeometry.size, isCurrent
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
    setReprojectionStatus(`Inspecting ${path}…`);
    try {
        await reprojectionIdentityReady;
        supersedeGeometryLoad({clearDropState: true});
        const configuredGeometry = await reprojectionApi.loadLocalGeometry(path);
        reprojectionState.configuredGeometry = configuredGeometry;
        if (!reprojectionState.images.length) {
            setReprojectionStatus(
                `${configuredGeometry.name} selected; open 3D reprojection to load it.`
            );
            return;
        }
        await loadConfiguredReprojectionGeometry(configuredGeometry);
    } catch (error) {
        setReprojectionStatus(
            `Failed to load local geometry: ${error.message}`, true
        );
    } finally {
        reprojectionLocalPath.disabled = false;
        reprojectionLoadLocalPath.disabled = false;
    }
}

async function installBrowserGeometry(name, loadGeometry) {
    const renderer = getReprojectionGpuRenderer();

    const generation = supersedeGeometryLoad();
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
        if (image) {
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
        reprojectionState.loadedGeometries.push({
            gpuKey: geometry.key,
            name,
            kind: geometry.kind,
            count: geometry.count,
        });
        reprojectionState.leftSource = geometry.key;
        reprojectionState.renderMode = "gpu";
        disableReprojectionGpuCanvas();
        rebuildPaneSourceOptions();
        reprojectionLeftSource.value = geometry.key;
        applyGeometryStatus({
            name,
            kind: geometry.kind,
            point_count: geometry.count,
            cache_token: `browser-${generation}`,
            gpu: true,
        });
        attachReprojectionGpuCanvas();
        if (reprojectionState.loaded) {
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
    }
}

async function clearLoadedGeometries() {
    await reprojectionIdentityReady;
    supersedeGeometryLoad({clearDropState: true});
    if (reprojectionGpuRenderer) {
        await reprojectionGpuRenderer.disposeGeometry();
    }
    reprojectionState.loadedGeometries = [];
    reprojectionState.leftSource = "colmap";
    reprojectionState.rightSource = "image";
    reprojectionState.gpuRenderedSource = null;
    reprojectionState.rightRenderedSource = "image";
    reprojectionInputLayer.classList.remove("geometry-active", "same-geometry");
    clearRightPaneGeometry();
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
            || reprojectionState.renderMode !== "gpu") {
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
        const rightSource = reprojectionState.rightSource;
        const rightIsGpu = paneSources.isGpuGeometry(rightSource);
        const useGpuComparison = includeRightPane
            && reprojectionLayout.value === "split"
            && rightIsGpu
            && rightSource !== reprojectionState.leftSource;
        if (useGpuComparison) {
            const split = ReprojectionSplitGeometry.geometry(
                display.width,
                display.height,
                reprojectionState.splitPercent,
                reprojectionState.splitAngle
            );
            await renderer.renderComparison(
                reprojectionState.leftSource,
                rightSource,
                image,
                renderSize.width,
                renderSize.height,
                region,
                split,
                confineGeometryToImageFrame()
            );
            if (frameRequest !== reprojectionState.gpuFrameRequest
                    || generation !== reprojectionState.generation
                    || reprojectionState.renderMode !== "gpu"
                    || reprojectionState.rightSource !== rightSource) {
                return;
            }
            reprojectionState.gpuRenderedView = renderedView;
            reprojectionState.gpuRenderedSource = reprojectionState.leftSource;
            reprojectionState.rightRenderedView = renderedView;
            reprojectionState.rightRenderedSource = rightSource;
            reprojectionState.gpuFallbackReady = false;
            reprojectionGpuFallback.classList.remove("active");
            reprojectionInputLayer.classList.remove("same-geometry");
            reprojectionInputLayer.classList.add("gpu-composited");
            attachReprojectionGpuCanvas();
            applyReprojectionViewTransform();
            return;
        }
        reprojectionInputLayer.classList.remove("gpu-composited");
        // Side-by-side layout still uses a full-resolution offscreen image
        // because its right pane is a separate DOM surface.
        if (includeRightPane && paneSources.isGpuGeometry(rightSource)
                && reprojectionLayout.value === "side") {
            const blob = await renderer.captureGeometry(
                rightSource, image, renderSize.width, renderSize.height, region,
                confineGeometryToImageFrame()
            );
            if (frameRequest !== reprojectionState.gpuFrameRequest
                    || generation !== reprojectionState.generation
                    || reprojectionState.renderMode !== "gpu") {
                return;
            }
            await installRightGeometryBlob(
                blob,
                rightSource,
                renderedView,
                () => frameRequest === reprojectionState.gpuFrameRequest
                    && generation === reprojectionState.generation
                    && reprojectionState.renderMode === "gpu"
                    && reprojectionState.rightSource === rightSource
            );
        }
        await renderer.renderGeometry(
            reprojectionState.leftSource,
            image, renderSize.width, renderSize.height, region,
            confineGeometryToImageFrame()
        );
        if (frameRequest !== reprojectionState.gpuFrameRequest
                || generation !== reprojectionState.generation
                || reprojectionState.renderMode !== "gpu") {
            return;
        }
        if (isFullFrameGpuView(renderedView)) {
            captureReprojectionGpuFallback();
        }
        reprojectionState.gpuRenderedView = renderedView;
        reprojectionState.gpuRenderedSource = reprojectionState.leftSource;
        attachReprojectionGpuCanvas();
        applyReprojectionViewTransform();
    } catch (error) {
        if (generation === reprojectionState.generation) {
            setReprojectionStatus(`Failed to render ${image.name}: ${error.message}`, true);
        }
    }
}

function loadReprojectionFrame(index) {
    if (!reprojectionState.images.length) {
        return;
    }
    reprojectionState.currentIndex = Math.max(
        0, Math.min(reprojectionState.images.length - 1, Number(index))
    );
    const image = reprojectionState.images[reprojectionState.currentIndex];
    reprojectionImageSelect.selectedIndex = reprojectionState.currentIndex;
    const generation = ++reprojectionState.generation;
    window.clearTimeout(reprojectionState.navigationPointTimer);
    window.clearTimeout(reprojectionState.pointSizeRenderTimer);
    window.clearTimeout(reprojectionState.zoomDetailTimer);
    reprojectionState.currentRenderUrl = null;
    reprojectionState.currentRenderView = null;
    reprojectionCloud.style.visibility = "hidden";
    reprojectionCloudSide.style.visibility = "hidden";
    if (reprojectionState.renderMode === "gpu") {
        disableReprojectionGpuCanvas();
    }
    setReprojectionStatus(
        `Loading image ${reprojectionState.currentIndex + 1} / ${reprojectionState.images.length}…`
    );

    const urls = reprojectionUrls(image);
    const renderCancellation = reprojectionState.renderMode === "server"
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
        // Geometry is deliberately delayed until image navigation settles.
        reprojectionState.navigationPointTimer = window.setTimeout(async () => {
            await renderCancellation;
            if (reprojectionState.browserGeometryLoading) {
                return;
            }
            if (reprojectionState.renderMode === "gpu") {
                renderReprojectionGpuFrame(generation);
            } else {
                requestReprojectionPointLayer(generation);
                const rightSource = reprojectionState.rightSource;
                if (paneSources.isGpuGeometry(rightSource)) {
                    renderReprojectionRightPane(generation);
                } else if (paneSources.isColmap(rightSource)) {
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
    };
    // Reusing the visible element lets the browser replace an obsolete image
    // request immediately instead of queueing detached preload/decode work.
    const sourceChanged = applyReprojectionInputSource(urls.input);
    if (!sourceChanged && inputElement.complete && inputElement.naturalWidth > 0) {
        queueMicrotask(() => inputElement.onload?.());
    }
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

function stepReprojection(direction) {
    const nextIndex = Math.max(0, Math.min(
        reprojectionState.images.length - 1,
        reprojectionState.currentIndex + direction
    ));
    if (nextIndex !== reprojectionState.currentIndex) {
        loadReprojectionFrame(nextIndex);
        return true;
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
    stepReprojection(direction);
    reprojectionState.navigationHoldDelay = window.setTimeout(() => {
        reprojectionState.navigationPreview = true;
        const repeat = () => {
            if (reprojectionState.navigationHoldKey !== key) {
                return;
            }
            if (!stepReprojection(direction)) {
                return;
            }
            reprojectionState.navigationRepeatDelay = Math.max(
                50, reprojectionState.navigationRepeatDelay - 8
            );
            reprojectionState.navigationHoldInterval = window.setTimeout(
                repeat, reprojectionState.navigationRepeatDelay
            );
        };
        repeat();
    }, 250);
}

function applyReprojectionFlip() {
    applyReprojectionViewTransform();
}

function setReprojectionPointSize(value) {
    const size = ReprojectionPointSize.normalize(value);
    reprojectionPointSize.value = size;
    reprojectionGpuRenderer?.setPointSize(size);
    if (reprojectionState.renderMode === "gpu") {
        renderReprojectionGpuFrame(reprojectionState.generation);
        return;
    }
    // Normal sizes reuse cached projection/splat data and should respond on
    // every wheel step. Only fractional sizes require a cold supersampled
    // render, so coalesce that short three-step range.
    loadReprojectionPointLayer(size < 1 ? 60 : 0);
    if (paneSources.isGpuGeometry(reprojectionState.rightSource)) {
        renderReprojectionRightPane(reprojectionState.generation);
    }
}

function stepReprojectionPointSize(direction) {
    setReprojectionPointSize(
        ReprojectionPointSize.step(reprojectionPointSize.value, direction)
    );
}

viewerModeSelect.addEventListener("change", () => setViewerMode(viewerModeSelect.value));
reprojectionImageSelect.addEventListener("change", () => {
    loadReprojectionFrame(reprojectionImageSelect.selectedIndex);
});
reprojectionColor.addEventListener("change", loadReprojectionPointLayer);
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
        `linear-gradient(to bottom, ${colors.top}, ${colors.bottom})`
    );
}

[reprojectionBackgroundTop, reprojectionBackgroundBottom].forEach(input => {
    input.addEventListener("input", () => applyBackgroundColors());
    input.addEventListener("change", () => applyBackgroundColors());
});
reprojectionFlip.addEventListener("change", applyReprojectionFlip);
reprojectionShowOutsideFrame.addEventListener("change", () => {
    applyReprojectionViewTransform();
    if (!reprojectionState.loaded) {
        return;
    }
    if (reprojectionState.renderMode === "gpu") {
        renderReprojectionGpuFrame(reprojectionState.generation);
    } else {
        requestReprojectionPointLayer(reprojectionState.generation);
        if (paneSources.isColmap(reprojectionState.rightSource)) {
            renderReprojectionRightPaneServer(reprojectionState.generation);
        } else if (paneSources.isGpuGeometry(reprojectionState.rightSource)) {
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
reprojectionInteraction.attach();
reprojectionViewer.addEventListener("wheel", event => {
    if (event.ctrlKey || event.metaKey) {
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
    if (document.activeElement.tagName === "INPUT") {
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
