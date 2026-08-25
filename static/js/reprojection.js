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

const reprojectionStreamId = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const reprojectionState = {
    images: [],
    datasetNamespace: "uninitialized",
    loaded: false,
    currentIndex: 0,
    generation: 0,
    splitPercent: 50,
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

async function initializeReprojectionCapability() {
    try {
        const response = await fetch("/api/capabilities");
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const capabilities = await response.json();
        reprojectionState.datasetNamespace = capabilities.dataset_namespace;
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
}

function reprojectionUrls(image, radius) {
    const base = `/api/reprojection/${image.id}`;
    const dataset = encodeURIComponent(reprojectionState.datasetNamespace);
    const stream = encodeURIComponent(reprojectionStreamId);
    const maxSize = reprojectionState.navigationPreview
        ? Math.min(reprojectionState.maxSize, reprojectionState.navigationPreviewSize)
        : reprojectionState.maxSize;
    return {
        input: `${base}/input?max_size=${maxSize}`
            + `&format=jpeg-v1&dataset=${dataset}&stream=${stream}`,
        render: `${base}/render?max_size=${maxSize}`
            + `&color=${encodeURIComponent(reprojectionColor.value)}`
            + `&radius=${radius}&dataset=${dataset}&stream=${stream}`,
    };
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
    const pointLoader = new Image();
    pointLoader.onload = () => {
        if (generation !== reprojectionState.generation) {
            return;
        }
        reprojectionCloud.src = renderUrl;
        reprojectionCloudSide.src = renderUrl;
        reprojectionCloud.style.visibility = "visible";
        reprojectionCloudSide.style.visibility = "visible";
    };
    pointLoader.onerror = () => {
        if (generation === reprojectionState.generation) {
            setReprojectionStatus(`Failed to render points for ${image.name}`, true);
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

function applyReprojectionFlip() {
    const transforms = {
        none: "none",
        horizontal: "scaleX(-1)",
        vertical: "scaleY(-1)",
        both: "scale(-1)",
    };
    const transform = transforms[reprojectionFlip.value];
    reprojectionInput.style.transform = transform;
    reprojectionInputSide.style.transform = transform;
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
reprojectionLayout.addEventListener("change", () => {
    const sideBySide = reprojectionLayout.value === "side";
    reprojectionSplit.hidden = sideBySide;
    reprojectionSide.hidden = !sideBySide;
    if (!sideBySide) {
        fitReprojectionSplit();
    }
});
reprojectionSplit.addEventListener("pointerdown", event => {
    reprojectionSplit.setPointerCapture(event.pointerId);
    setReprojectionSplit(event.clientX);
});
reprojectionSplit.addEventListener("pointermove", event => {
    if (reprojectionSplit.hasPointerCapture(event.pointerId)) {
        setReprojectionSplit(event.clientX);
    }
});
reprojectionViewer.addEventListener("wheel", event => {
    if (!event.altKey) {
        return;
    }
    event.preventDefault();
    const direction = event.deltaY < 0 ? 2 : -2;
    setReprojectionPointSize(Number(reprojectionPointSize.value) + direction);
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

initializeReprojectionCapability();
