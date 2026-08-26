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
const reprojectionDivider = document.getElementById("reprojection-divider");
const reprojectionLayout = document.getElementById("reprojection-layout");
const reprojectionColor = document.getElementById("reprojection-color");
const reprojectionPointSize = document.getElementById("reprojection-point-size");
const reprojectionFlip = document.getElementById("reprojection-flip");
const reprojectionResetView = document.getElementById("reprojection-reset-view");
const reprojectionGeometryDrop = document.getElementById("reprojection-geometry-drop");
const reprojectionGeometryFile = document.getElementById("reprojection-geometry-file");
const reprojectionGeometryStatus = document.getElementById("reprojection-geometry-status");
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
    geometryRevision: 0,
    geometryCacheToken: "colmap",
    geometryKind: "colmap",
    loaded: false,
    currentIndex: 0,
    generation: 0,
    pointGeneration: 0,
    splitPercent: 50,
    viewScale: 1,
    viewTranslateX: 0,
    viewTranslateY: 0,
    pointerMode: null,
    pointerId: null,
    pointerLastX: 0,
    pointerLastY: 0,
    maxSize: 1600,
    pointRenderTimer: null,
    prefetchInFlight: new Map(),
    navigationHoldKey: null,
    navigationHoldDelay: null,
    navigationHoldInterval: null,
    navigationRepeatDelay: 110,
    navigationPreview: false,
    navigationPreviewSize: 768,
};

document.body.dataset.viewerMode = "matches";

function setReprojectionStatus(message, isError = false) {
    reprojectionStatus.textContent = message;
    reprojectionStatus.style.color = isError ? "#a00000" : "#666";
}

function applyGeometryStatus(geometry) {
    reprojectionState.geometryRevision = geometry.revision;
    reprojectionState.geometryCacheToken = geometry.cache_token;
    reprojectionState.geometryKind = geometry.kind;
    const count = Number(geometry.point_count || 0).toLocaleString();
    reprojectionGeometryStatus.textContent =
        `${geometry.name} — ${geometry.kind}, ${count} rendered points`;
    reprojectionUseColmap.disabled = geometry.kind === "colmap";
}

async function initializeReprojectionCapability() {
    await reprojectionIdentityReady;
    try {
        const response = await fetch(
            `/api/capabilities?stream=${encodeURIComponent(reprojectionIdentity.id)}`
        );
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const capabilities = await response.json();
        reprojectionState.datasetNamespace = capabilities.dataset_namespace;
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
        await reprojectionIdentityReady;
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
        const response = await fetch("/api/reprojection/images");
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || `HTTP ${response.status}`);
        }
        reprojectionState.images = await response.json();
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
        loadReprojectionFrame(matchingIndex >= 0 ? matchingIndex : 0);
    } catch (error) {
        setReprojectionStatus(error.message, true);
    }
}

function previewSize(image) {
    const scale = Math.min(1, reprojectionState.maxSize / Math.max(image.width, image.height));
    return {
        width: Math.max(1, Math.round(image.width * scale)),
        height: Math.max(1, Math.round(image.height * scale)),
    };
}

function fitReprojectionSplit() {
    if (!reprojectionState.images.length || reprojectionViewer.hidden) {
        return;
    }
    const image = reprojectionState.images[reprojectionState.currentIndex];
    const preview = previewSize(image);
    const bounds = reprojectionViewer.getBoundingClientRect();
    const scale = Math.min(bounds.width / preview.width, bounds.height / preview.height);
    reprojectionSplit.style.width = `${preview.width * scale}px`;
    reprojectionSplit.style.height = `${preview.height * scale}px`;
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

function applyReprojectionViewTransform() {
    setImageTransform(reprojectionCloud);
    setImageTransform(reprojectionCloudSide);
    setImageTransform(reprojectionInput, true);
    setImageTransform(reprojectionInputSide, true);
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
}

function resetReprojectionViewTransform() {
    reprojectionState.viewScale = 1;
    reprojectionState.viewTranslateX = 0;
    reprojectionState.viewTranslateY = 0;
    applyReprojectionViewTransform();
}

function reprojectionUrls(image, radius) {
    const base = `/api/reprojection/${image.id}`;
    const dataset = encodeURIComponent(reprojectionState.datasetNamespace);
    const stream = encodeURIComponent(reprojectionIdentity.id);
    const geometry = encodeURIComponent(reprojectionState.geometryCacheToken);
    const maxSize = reprojectionState.navigationPreview
        ? Math.min(reprojectionState.maxSize, reprojectionState.navigationPreviewSize)
        : reprojectionState.maxSize;
    return {
        input: `${base}/input?max_size=${maxSize}`
            + `&format=jpeg-v1&dataset=${dataset}&stream=${stream}`,
        render: `${base}/render?max_size=${maxSize}`
            + `&color=${encodeURIComponent(reprojectionColor.value)}`
            + `&radius=${radius}&dataset=${dataset}&stream=${stream}`
            + `&geometry=${geometry}`,
    };
}

async function uploadReprojectionGeometry(file) {
    if (!file || !file.name.toLowerCase().endsWith(".ply")) {
        setReprojectionStatus("Only PLY point clouds and meshes are supported.", true);
        return;
    }
    await reprojectionIdentityReady;
    reprojectionUploadGeneration += 1;
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
        const response = await fetch(
            `/api/reprojection/geometry?filename=${encodeURIComponent(file.name)}`
                + `&stream=${encodeURIComponent(reprojectionIdentity.id)}`
                + `&generation=${reprojectionUploadGeneration}`,
            {
                method: "POST",
                headers: {"Content-Type": "application/octet-stream"},
                body: file,
                signal: uploadController.signal,
            }
        );
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || `HTTP ${response.status}`);
        }
        const geometry = await response.json();
        if (reprojectionUploadController !== uploadController) {
            return;
        }
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

async function resetReprojectionGeometry() {
    await reprojectionIdentityReady;
    reprojectionUploadController?.abort();
    reprojectionUploadController = null;
    reprojectionGeometryDrop.classList.remove("loading", "drag-over");
    stopContinuousNavigation(false);
    reprojectionUseColmap.disabled = true;
    setReprojectionStatus("Restoring COLMAP points3D…");
    try {
        const response = await fetch(
            `/api/reprojection/geometry?stream=${encodeURIComponent(reprojectionIdentity.id)}`,
            {method: "DELETE"}
        );
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.detail || `HTTP ${response.status}`);
        }
        applyGeometryStatus(await response.json());
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
        const response = await fetch(
            "/api/reprojection/stream/heartbeat"
                + `?stream=${encodeURIComponent(reprojectionIdentity.id)}`,
            {method: "POST"}
        );
        if (!response.ok) {
            return false;
        }
        const geometry = await response.json();
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
        uploadReprojectionGeometry(file);
    }
}

function currentPointRadius() {
    return Math.floor(normalizePointSize(reprojectionPointSize.value) / 2);
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

function prefetchReprojectionNeighbors(generation) {
    if (generation !== reprojectionState.generation) {
        return;
    }
    // Next is requested first because forward navigation is most common.
    const neighbors = [
        reprojectionState.currentIndex - 1,
        reprojectionState.currentIndex + 1,
    ];
    neighbors.forEach(index => {
        if (index < 0 || index >= reprojectionState.images.length) {
            return;
        }
        // Input decoding is safe to preload. Point renders are intentionally
        // never speculative: obsolete camera projections must not queue behind
        // the camera the user is currently requesting.
        const urls = reprojectionUrls(reprojectionState.images[index], 0);
        prefetchUrl(urls.input);
    });
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
    window.clearTimeout(reprojectionState.pointRenderTimer);
    reprojectionCloud.style.visibility = "hidden";
    reprojectionCloudSide.style.visibility = "hidden";
    setReprojectionStatus(
        `Loading image ${reprojectionState.currentIndex + 1} / ${reprojectionState.images.length}…`
    );

    const urls = reprojectionUrls(image, currentPointRadius());
    const inputLoader = new Image();
    inputLoader.onload = () => {
        if (generation !== reprojectionState.generation) {
            return;
        }
        reprojectionInput.src = urls.input;
        reprojectionInputSide.src = urls.input;
        applyReprojectionViewTransform();
        setReprojectionStatus(
            `${reprojectionState.currentIndex + 1} / ${reprojectionState.images.length}: ${image.name}`
        );
        fitReprojectionSplit();
        // Geometry is deliberately delayed until image navigation settles.
        reprojectionState.pointRenderTimer = window.setTimeout(
            () => requestReprojectionPointLayer(generation), 180
        );
        window.setTimeout(() => prefetchReprojectionNeighbors(generation), 260);
    };
    inputLoader.onerror = () => {
        if (generation === reprojectionState.generation) {
            setReprojectionStatus(`Failed to load ${image.name}`, true);
        }
    };
    inputLoader.src = urls.input;
    fitReprojectionSplit();
}

function requestReprojectionPointLayer(generation = reprojectionState.generation) {
    if (!reprojectionState.images.length) {
        return;
    }
    const image = reprojectionState.images[reprojectionState.currentIndex];
    const renderUrl = reprojectionUrls(image, currentPointRadius()).render;
    const pointGeneration = ++reprojectionState.pointGeneration;
    const pointLoader = new Image();
    pointLoader.onload = () => {
        if (generation !== reprojectionState.generation
                || pointGeneration !== reprojectionState.pointGeneration) {
            return;
        }
        reprojectionCloud.src = renderUrl;
        reprojectionCloudSide.src = renderUrl;
        reprojectionCloud.style.visibility = "visible";
        reprojectionCloudSide.style.visibility = "visible";
        applyReprojectionViewTransform();
    };
    pointLoader.onerror = async () => {
        if (generation === reprojectionState.generation
                && pointGeneration === reprojectionState.pointGeneration) {
            const geometryChanged = await heartbeatReprojectionStream();
            if (!geometryChanged
                    && generation === reprojectionState.generation
                    && pointGeneration === reprojectionState.pointGeneration) {
                setReprojectionStatus(`Failed to render points for ${image.name}`, true);
            }
        }
    };
    pointLoader.src = renderUrl;
}

function loadReprojectionPointLayer() {
    window.clearTimeout(reprojectionState.pointRenderTimer);
    requestReprojectionPointLayer();
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

function setReprojectionSplit(clientX) {
    const bounds = reprojectionSplit.getBoundingClientRect();
    const percent = 100 * (clientX - bounds.left) / bounds.width;
    reprojectionState.splitPercent = Math.max(0, Math.min(100, percent));
    reprojectionInputLayer.style.clipPath =
        `inset(0 0 0 ${reprojectionState.splitPercent}%)`;
    reprojectionDivider.style.left = `${reprojectionState.splitPercent}%`;
}

function pointerNearReprojectionDivider(clientX) {
    if (reprojectionLayout.value === "side") {
        return false;
    }
    const bounds = reprojectionSplit.getBoundingClientRect();
    const dividerX = bounds.left
        + bounds.width * reprojectionState.splitPercent / 100;
    return Math.abs(clientX - dividerX) <= 7;
}

function updateReprojectionPointerCursor(clientX) {
    if (reprojectionState.pointerMode === "split") {
        reprojectionViewer.style.cursor = "ew-resize";
    } else if (reprojectionState.pointerMode === "pan") {
        reprojectionViewer.style.cursor = "grabbing";
    } else {
        reprojectionViewer.style.cursor = pointerNearReprojectionDivider(clientX)
            ? "ew-resize"
            : "grab";
    }
}

function startReprojectionPointerDrag(event) {
    if (event.button !== 0) {
        return;
    }
    event.preventDefault();
    reprojectionState.pointerMode = pointerNearReprojectionDivider(event.clientX)
        ? "split"
        : "pan";
    reprojectionState.pointerId = event.pointerId;
    reprojectionState.pointerLastX = event.clientX;
    reprojectionState.pointerLastY = event.clientY;
    reprojectionViewer.setPointerCapture(event.pointerId);
    if (reprojectionState.pointerMode === "split") {
        setReprojectionSplit(event.clientX);
    }
    updateReprojectionPointerCursor(event.clientX);
}

function moveReprojectionPointerDrag(event) {
    if (reprojectionState.pointerId !== event.pointerId) {
        updateReprojectionPointerCursor(event.clientX);
        return;
    }
    event.preventDefault();
    if (reprojectionState.pointerMode === "split") {
        setReprojectionSplit(event.clientX);
    } else if (reprojectionState.pointerMode === "pan") {
        reprojectionState.viewTranslateX += event.clientX
            - reprojectionState.pointerLastX;
        reprojectionState.viewTranslateY += event.clientY
            - reprojectionState.pointerLastY;
        applyReprojectionViewTransform();
    }
    reprojectionState.pointerLastX = event.clientX;
    reprojectionState.pointerLastY = event.clientY;
}

function stopReprojectionPointerDrag(event) {
    if (reprojectionState.pointerId !== event.pointerId) {
        return;
    }
    if (reprojectionViewer.hasPointerCapture(event.pointerId)) {
        reprojectionViewer.releasePointerCapture(event.pointerId);
    }
    reprojectionState.pointerMode = null;
    reprojectionState.pointerId = null;
    updateReprojectionPointerCursor(event.clientX);
}

function applyReprojectionFlip() {
    applyReprojectionViewTransform();
}

function normalizePointSize(value) {
    let size = Math.round(Number(value));
    if (!Number.isFinite(size)) {
        size = 3;
    }
    size = Math.max(1, Math.min(15, size));
    // Odd diameters keep the rendered point centered on its projected pixel.
    if (size % 2 === 0) {
        size += size === 15 ? -1 : 1;
    }
    return size;
}

function setReprojectionPointSize(value) {
    const size = normalizePointSize(value);
    reprojectionPointSize.value = size;
    loadReprojectionPointLayer();
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
reprojectionFlip.addEventListener("change", applyReprojectionFlip);
reprojectionResetView.addEventListener("click", resetReprojectionViewTransform);
reprojectionGeometryDrop.addEventListener("click", () => reprojectionGeometryFile.click());
reprojectionGeometryDrop.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        reprojectionGeometryFile.click();
    }
});
reprojectionGeometryFile.addEventListener("change", () => {
    uploadReprojectionGeometry(reprojectionGeometryFile.files[0]);
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
    reprojectionSplit.hidden = sideBySide;
    reprojectionSide.hidden = !sideBySide;
    if (!sideBySide) {
        fitReprojectionSplit();
    }
    resetReprojectionViewTransform();
});
reprojectionViewer.addEventListener("pointerdown", startReprojectionPointerDrag);
reprojectionViewer.addEventListener("pointermove", moveReprojectionPointerDrag);
reprojectionViewer.addEventListener("pointerup", stopReprojectionPointerDrag);
reprojectionViewer.addEventListener("pointercancel", stopReprojectionPointerDrag);
reprojectionViewer.addEventListener("pointerleave", event => {
    if (reprojectionState.pointerMode === null) {
        reprojectionViewer.style.cursor = "grab";
    }
});
reprojectionViewer.addEventListener("wheel", event => {
    if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const direction = event.deltaY < 0 ? 2 : -2;
        setReprojectionPointSize(Number(reprojectionPointSize.value) + direction);
    } else {
        event.preventDefault();
        zoomReprojectionView(event);
    }
}, {passive: false});
window.addEventListener("resize", fitReprojectionSplit);
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

initializeReprojectionCapability();
