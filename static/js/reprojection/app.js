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
const reprojectionColor = document.getElementById("reprojection-color");
const reprojectionPointSize = document.getElementById("reprojection-point-size");
const reprojectionMeshShading = document.getElementById(
    "reprojection-mesh-shading"
);
const reprojectionMeshColor = document.getElementById(
    "reprojection-mesh-color"
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
const reprojectionGeometryDrop = document.getElementById("reprojection-geometry-drop");
const reprojectionGeometryFile = document.getElementById("reprojection-geometry-file");
const reprojectionGeometryStatus = document.getElementById("reprojection-geometry-status");
const reprojectionGeometrySummary = document.getElementById("reprojection-geometry-summary");
const reprojectionUseColmap = document.getElementById("reprojection-use-colmap");

const reprojectionStreamStorageKey = "colmap-viewer-reprojection-stream-v1";
const reprojectionUploadGenerationKey = "colmap-viewer-upload-generation-v1";

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
    backgroundRenderTimer: null,
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
    renderMode: "server",
    configuredGeometry: null,
    browserGeometryLoading: false,
    gpuRenderedView: {scale: 1, translateX: 0, translateY: 0},
    gpuFallbackReady: false,
    gpuFrameRequest: 0,
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
    }
    return reprojectionGpuRenderer;
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
});

const reprojectionPointRequester = new ReprojectionPointRequester({
    state: reprojectionState,
    renderUrl: image => reprojectionUrls(image).render,
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

function applyGeometryStatus(geometry) {
    reprojectionState.geometryCacheToken = geometry.cache_token;
    reprojectionState.geometryKind = geometry.kind;
    const count = Number(geometry.point_count || 0).toLocaleString();
    const countLabel = geometry.gpu ? "vertices" : "rendered points";
    reprojectionGeometryStatus.textContent =
        `${geometry.name} — ${geometry.kind}, ${count} ${countLabel}`;
    reprojectionGeometrySummary.textContent = geometry.name;
    reprojectionGeometrySummary.title = geometry.name;
    reprojectionUseColmap.disabled = geometry.kind === "colmap";
    const meshControlsDisabled = geometry.kind !== "triangle mesh";
    reprojectionMeshShading.disabled = meshControlsDisabled;
    reprojectionMeshColor.disabled = meshControlsDisabled;
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
        getReprojectionGpuRenderer().setBackgroundColors(colors.top, colors.bottom);
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
            loadConfiguredReprojectionGeometry(
                reprojectionState.configuredGeometry
            ).then(loaded => {
                if (!loaded && reprojectionState.renderMode === "server") {
                    requestReprojectionPointLayer(reprojectionState.generation);
                }
            });
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
    if (reprojectionLayout.value === "side") {
        setImageTransform(reprojectionCloudSide);
        if (reprojectionState.renderMode === "gpu") {
            setImageTransform(reprojectionGpuFallback);
            applyReprojectionGpuViewTransform();
        }
        setImageTransform(reprojectionInputSide, true);
    } else {
        setImageTransform(reprojectionCloud);
        if (reprojectionState.renderMode === "gpu") {
            setImageTransform(reprojectionGpuFallback);
            applyReprojectionGpuViewTransform();
        }
        setImageTransform(reprojectionInput, true);
    }
}

function applyInteractiveReprojectionViewTransform() {
    applyReprojectionViewTransform();
    if (reprojectionState.renderMode === "gpu") {
        scheduleZoomDetailRefresh(80);
    }
}

function captureReprojectionGpuFallback() {
    const context = reprojectionGpuFallback.getContext("2d", {alpha: false});
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

function applyReprojectionRenderSource(url) {
    reprojectionState.currentRenderUrl = url;
    const target = reprojectionLayout.value === "side"
        ? reprojectionCloudSide
        : reprojectionCloud;
    target.src = url;
    target.style.visibility = "visible";
}

function syncActiveReprojectionSources() {
    if (reprojectionState.currentInputUrl) {
        applyReprojectionInputSource(reprojectionState.currentInputUrl);
    }
    if (reprojectionState.currentRenderUrl) {
        applyReprojectionRenderSource(reprojectionState.currentRenderUrl);
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
    scheduleZoomDetailRefresh(0);
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
        applyReprojectionInputSource(urls.input);
        if (reprojectionState.renderMode === "gpu") {
            renderReprojectionGpuFrame(generation);
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
    inputMaxSize = currentPreviewMaxSize()
) {
    const base = `/api/reprojection/${image.id}`;
    const dataset = encodeURIComponent(reprojectionState.datasetNamespace);
    const stream = encodeURIComponent(requestStream);
    const geometry = encodeURIComponent(reprojectionState.geometryCacheToken);
    const pointRender = pointRenderParameters();
    return {
        input: `${base}/input?max_size=${inputMaxSize}`
            + `&format=jpeg-v1&dataset=${dataset}&stream=${stream}`,
        render: `${base}/render?max_size=${pointRender.maxSize}`
            + `&color=${encodeURIComponent(reprojectionColor.value)}`
            + `&radius=${pointRender.radius}&dataset=${dataset}&stream=${stream}`
            + `&geometry=${geometry}&format=png-v2`,
    };
}

async function uploadServerGeometry(file) {
    if (!file || !file.name.toLowerCase().endsWith(".ply")) {
        setReprojectionStatus("Only PLY point clouds and meshes are supported.", true);
        return;
    }
    await reprojectionIdentityReady;
    reprojectionUploadGeneration += 1;
    reprojectionState.browserGeometryLoading = false;
    ViewerStreamIdentity.writeSession(
        reprojectionUploadGenerationKey,
        String(reprojectionUploadGeneration)
    );
    reprojectionUploadController?.abort();
    const uploadController = new AbortController();
    reprojectionUploadController = uploadController;
    stopContinuousNavigation(false);
    reprojectionGeometryDrop.classList.add("loading");
    reprojectionUseColmap.disabled = true;
    setReprojectionStatus(`Loading ${file.name}…`);
    try {
        const geometry = await reprojectionApi.uploadGeometry(
            file, reprojectionUploadGeneration, uploadController.signal
        );
        if (reprojectionUploadController !== uploadController) {
            return;
        }
        reprojectionGpuRenderer?.disposeGeometry();
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
            reprojectionUseColmap.disabled = reprojectionState.geometryKind === "colmap";
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
    if (!image || !ReprojectionGpu.isPinholeCamera(image)) {
        return false;
    }
    const loadGeometry = configuredGeometry.mesh_stream
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
    return installBrowserGeometry(configuredGeometry.name, loadGeometry);
}

async function installBrowserGeometry(name, loadGeometry) {
    const renderer = getReprojectionGpuRenderer();

    reprojectionUploadGeneration += 1;
    const generation = reprojectionUploadGeneration;
    ViewerStreamIdentity.writeSession(reprojectionUploadGenerationKey, String(generation));
    reprojectionUploadController?.abort();
    reprojectionUploadController = null;
    reprojectionState.browserGeometryLoading = true;
    stopContinuousNavigation(false);
    reprojectionGeometryDrop.classList.add("loading");
    reprojectionUseColmap.disabled = true;
    setReprojectionStatus(`Loading ${name} directly in the browser…`);
    try {
        const geometry = await loadGeometry(
            renderer, () => generation === reprojectionUploadGeneration
        );
        if (!geometry || generation !== reprojectionUploadGeneration) {
            return false;
        }
        reprojectionState.renderMode = "gpu";
        disableReprojectionGpuCanvas();
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
            reprojectionUseColmap.disabled = reprojectionState.geometryKind === "colmap";
        }
    }
}

async function resetReprojectionGeometry() {
    await reprojectionIdentityReady;
    reprojectionUploadController?.abort();
    reprojectionUploadController = null;
    reprojectionGeometryDrop.classList.remove("loading", "drag-over");
    reprojectionUploadGeneration += 1;
    reprojectionState.browserGeometryLoading = false;
    reprojectionGpuRenderer?.disposeGeometry();
    reprojectionState.renderMode = "server";
    disableReprojectionGpuCanvas();
    stopContinuousNavigation(false);
    reprojectionUseColmap.disabled = true;
    setReprojectionStatus("Restoring COLMAP points3D…");
    try {
        applyGeometryStatus(await reprojectionApi.resetGeometry());
        if (reprojectionState.loaded) {
            loadReprojectionFrame(reprojectionState.currentIndex);
        }
    } catch (error) {
        reprojectionUseColmap.disabled = false;
        setReprojectionStatus(`Failed to restore points3D: ${error.message}`, true);
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

async function renderReprojectionGpuFrame(generation) {
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
        await renderer.render(
            image, renderSize.width, renderSize.height, region
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
    if (reprojectionState.renderMode === "gpu") {
        reprojectionGpuRenderer?.setPointSize(size);
        renderReprojectionGpuFrame(reprojectionState.generation);
        return;
    }
    // Normal sizes reuse cached projection/splat data and should respond on
    // every wheel step. Only fractional sizes require a cold supersampled
    // render, so coalesce that short three-step range.
    loadReprojectionPointLayer(size < 1 ? 60 : 0);
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
document.getElementById("reprojection-prev").addEventListener("click", () => stepReprojection(-1));
document.getElementById("reprojection-next").addEventListener("click", () => stepReprojection(1));
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
function applyBackgroundColors(renderDelay = 60) {
    const category = backgroundCategory();
    const colors = reprojectionState.backgroundColors[category];
    colors.top = reprojectionBackgroundTop.value;
    colors.bottom = reprojectionBackgroundBottom.value;
    getReprojectionGpuRenderer().setBackgroundColors(colors.top, colors.bottom);
    window.clearTimeout(reprojectionState.backgroundRenderTimer);
    if (reprojectionState.renderMode !== "gpu") {
        return;
    }
    const generation = reprojectionState.generation;
    reprojectionState.backgroundRenderTimer = window.setTimeout(() => {
        if (generation === reprojectionState.generation
                && category === backgroundCategory()) {
            renderReprojectionGpuFrame(generation);
        }
    }, renderDelay);
}

[reprojectionBackgroundTop, reprojectionBackgroundBottom].forEach(input => {
    input.addEventListener("input", () => applyBackgroundColors());
    input.addEventListener("change", () => applyBackgroundColors(0));
});
reprojectionFlip.addEventListener("change", applyReprojectionFlip);
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
reprojectionUseColmap.addEventListener("click", resetReprojectionGeometry);
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
