// Get DOM elements
const sourceSelect = document.getElementById("source-select");
const image1Select = document.getElementById("image1-select");
const image2Select = document.getElementById("image2-select");
const copyImage1NameButton = document.getElementById("copy-image1-name");
const copyImage2NameButton = document.getElementById("copy-image2-name");
const image1Canvas = document.getElementById("image1-canvas");
const image2Canvas = document.getElementById("image2-canvas");
const matchCanvas = document.getElementById("match-canvas");
const showMarkersCheckbox = document.getElementById("show-markers");
const drawMatchesButton = document.getElementById("draw-matches");
const drawLineMatchesButton = document.getElementById("draw-line-matches");
const lineMatchActions = document.getElementById("line-match-actions");
const drawEpipolarButton = document.getElementById("draw-epipolar");
const showOnlyMatchedCheckbox = document.getElementById("show-only-matched");
const showLinesCheckbox = document.getElementById("show-lines");
const showOnlyMatchedLinesCheckbox = document.getElementById("show-only-matched-lines");
const lineDisplayOptions = document.getElementById("line-display-options");
const showInlierMatchesCheckbox = document.getElementById("show-inlier-matches");
const showWrongMatchesCheckbox = document.getElementById("show-wrong-matches");
const resetViewButton = document.getElementById("reset-view");
const matchSummaryContent = document.getElementById("match-summary-content");
const epipolarCanvas = document.getElementById("epipolar-canvas");
const generatedPairOptions = document.getElementById("generated-pair-options");
const generatedPairMessage = document.getElementById("generated-pair-message");
const poseNeighborLimit = document.getElementById("pose-neighbor-limit");
const matchingApi = new MatchingApi();
SharedClipboard.decorateButton(copyImage1NameButton);
SharedClipboard.decorateButton(copyImage2NameButton);

// Canvas contexts
const ctx1 = image1Canvas.getContext("2d");
const ctx2 = image2Canvas.getContext("2d");
const matchCtx = matchCanvas.getContext("2d");
const LINE_MATCH_CONNECTOR_COLOR = "rgba(0, 180, 255, 0.8)";

// State variables
let allImages = [];
let currentImage1Data = null;
let currentImage2Data = null;
let currentImage1 = new Image();
let currentImage2 = new Image();
let currentMatches = { inlier: [], outlier: [] };
let currentLineMatches = [];
let markerSize = 3;
let onlyShowMatched = false;
let onlyShowMatchedLines = false;
let pointMatchesVisible = false;
let lineMatchesVisible = false;
let pointCorrespondences = MatchingCorrespondence.createIndex([]);
let inlierPointCorrespondences = MatchingCorrespondence.createIndex([]);
let outlierPointCorrespondences = MatchingCorrespondence.createIndex([]);
let lineCorrespondences = MatchingCorrespondence.createIndex([]);
let image1Colors = [];
let line1Colors = [];
let currentMatchSummary = null;
let matchingPreviewGeneration = 0;
let matchingPreviewActive = false;
let matchingPreviewController = null;
const imageLoadGenerations = {image1: 0, image2: 0};

function matchingImageUrl(name, maxSize = null) {
    const path = String(name).split("/").map(encodeURIComponent).join("/");
    const preview = maxSize ? `?max_size=${maxSize}` : "";
    return `/serve_image/${path}${preview}`;
}

function resetMatchState() {
    currentMatches = { inlier: [], outlier: [] };
    currentLineMatches = [];
    pointCorrespondences = MatchingCorrespondence.createIndex([]);
    inlierPointCorrespondences = MatchingCorrespondence.createIndex([]);
    outlierPointCorrespondences = MatchingCorrespondence.createIndex([]);
    lineCorrespondences = MatchingCorrespondence.createIndex([]);
}

function setMatchSummaryMessage(message) {
    if (!matchSummaryContent) {
        return;
    }
    matchSummaryContent.textContent = message;
}

function clearMatchSummary(message = "Select two images to see match statistics.") {
    currentMatchSummary = null;
    setMatchSummaryMessage(message);
}

function renderMatchSummary(summary) {
    if (!matchSummaryContent) {
        return;
    }

    if (!summary || !summary.available) {
        const reason = summary && summary.reason ? summary.reason : "Match statistics unavailable.";
        setMatchSummaryMessage(reason);
        return;
    }

    matchSummaryContent.innerHTML = "";

    const stats = [
        { label: "total matches:", value: summary.total_matches ?? "N/A" },
    ];

    if (summary.inlier_count !== null) {
        stats.push({ label: "inlier matches:", value: summary.inlier_count ?? "N/A" });
        stats.push({ label: "outlier matches:", value: summary.outlier_count ?? "N/A" });
    }
    if (summary.line_match_count !== undefined
            && summary.line_match_count !== null) {
        stats.push({ label: "line matches:", value: summary.line_match_count });
    }

    stats.forEach(({ label, value }) => {
        const row = document.createElement("div");
        row.classList.add("match-summary-item");

        const labelElement = document.createElement("span");
        labelElement.classList.add("match-summary-label");
        labelElement.textContent = label;
        row.appendChild(labelElement);

        const valueElement = document.createElement("span");
        valueElement.classList.add("match-summary-value");
        valueElement.textContent = value;
        row.appendChild(valueElement);

        matchSummaryContent.appendChild(row);
    });

    if (summary.two_view_geometry_available) {
        const configurationRow = document.createElement("div");
        configurationRow.classList.add("match-summary-item");
        configurationRow.style.flexDirection = "column";

        const configurationLabel = document.createElement("span");
        configurationLabel.classList.add("match-summary-label");
        configurationLabel.textContent = "two-view configuration:";
        configurationRow.appendChild(configurationLabel);

        const configurationValue = document.createElement("span");
        configurationValue.classList.add("match-summary-value");
        configurationValue.style.paddingLeft = "0px";
        const configurationText = summary.two_view_configuration || "Unknown";
        configurationValue.textContent = configurationText;
        configurationRow.appendChild(configurationValue);
        matchSummaryContent.appendChild(configurationRow);
    }

    if (summary.reason) {
        const note = document.createElement("p");
        note.classList.add("match-summary-note");
        note.textContent = summary.reason;
        matchSummaryContent.appendChild(note);
    }
}

async function updateMatchSummary() {
    if (!matchSummaryContent) {
        return null;
    }

    const imageId1 = image1Select.value;
    const imageId2 = image2Select.value;

    if (!imageId1 || !imageId2) {
        clearMatchSummary();
        return null;
    }

    setMatchSummaryMessage("Loading match statistics...");

    let summary;
    try {
        summary = await matchingApi.matchSummary(imageId1, imageId2);
    } catch (error) {
        console.error("Error fetching match summary:", error);
        summary = null;
    }
    if (!summary) {
        setMatchSummaryMessage("Unable to load match statistics.");
        return null;
    }

    currentMatchSummary = summary;
    renderMatchSummary(summary);
    return summary;
}

const canvasStates = {
    image1: MatchingCanvas.createState(),
    image2: MatchingCanvas.createState(),
};

const epipolarTool = new EpipolarTool({
    button: drawEpipolarButton,
    overlay: epipolarCanvas,
    viewer: document.getElementById("matching-viewer"),
    canvases: [image1Canvas, image2Canvas],
    getPair: () => [image1Select.value, image2Select.value],
    getSourceKey: () => sourceSelect.value,
    getImageData: canvasKey => (
        canvasKey === "image1" ? currentImage1Data : currentImage2Data
    ),
    getCanvasState: canvasKey => canvasStates[canvasKey],
    imageToOverlay: imageToCanvas,
});

// --- Initialization ---

// Initial setup on page load
globalThis.matchingInitialViewReady = init();

async function init() {
    await initializeSources();
    await updateLineControlsVisibility();
    await fetchImages();
}

// --- API Functions ---

showInlierMatchesCheckbox.addEventListener("change", () => {
    redrawCanvas(image1Canvas, ctx1, "image1");
    redrawCanvas(image2Canvas, ctx2, "image2");
    drawMatches();
});

showWrongMatchesCheckbox.addEventListener("change", () => {
    redrawCanvas(image1Canvas, ctx1, "image1");
    redrawCanvas(image2Canvas, ctx2, "image2");
    drawMatches();
});

async function initializeSources() {
    try {
        const sources = await matchingApi.sources();

        if (sources.length > 1) {
            sourceSelect.innerHTML = "";
            sources.forEach(source => {
                const option = document.createElement("option");
                option.value = source;
                option.textContent = source;
                sourceSelect.appendChild(option);
            });
            sourceSelect.parentElement.style.display = "block";
        } else {
            sourceSelect.parentElement.style.display = "none";
        }
    } catch (error) {
        console.error("Error initializing sources:", error);
    }
}

async function updateLineControlsVisibility() {
    let available = false;
    try {
        const capabilities = await matchingApi.capabilities();
        available = Boolean(capabilities.lines);
    } catch (error) {
        console.error("Error loading matching capabilities:", error);
    }
    MatchingLineControls.setAvailable({
        displayOptions: lineDisplayOptions,
        matchActions: lineMatchActions,
        showLines: showLinesCheckbox,
        onlyMatchedLines: showOnlyMatchedLinesCheckbox,
        drawMatches: drawLineMatchesButton,
    }, available);
    if (!available) {
        onlyShowMatchedLines = false;
        lineMatchesVisible = false;
    }
}

async function fetchImages() {
    try {
        allImages = await matchingApi.images();
        populateImageSelects();
        if (!image1Select.value && allImages.length) {
            image1Select.value = String(allImages[0].id);
            updateImageCopyButtons();
            await drawImageAndFeatures(
                currentImage1, image1Canvas, ctx1,
                image1Select.value, true
            );
            // Populate candidate choices after the visible startup image wins
            // network and decode priority. No second image is selected yet.
            updateImage2List();
        }
    } catch (error) {
        console.error("Error fetching images:", error);
    }
}

async function fetchMatchesForImage(imageId) {
    try {
        const minimum = Number(poseNeighborLimit.min);
        const maximum = Number(poseNeighborLimit.max);
        const fallback = Number(poseNeighborLimit.defaultValue);
        const requested = Number(poseNeighborLimit.value) || fallback;
        const limit = Math.max(minimum, Math.min(maximum, requested));
        poseNeighborLimit.value = limit;
        return await matchingApi.pairCandidates(imageId, limit);
    } catch (error) {
        console.error("Error fetching matched images:", error);
        return {imageIds: [], source: "none"};
    }
}

// --- UI Update Functions ---

function populateImageSelects() {
    allImages.sort((a, b) => a.name.localeCompare(b.name));

    const oldImage1 = image1Select.value;
    const oldImage2 = image2Select.value;

    image1Select.innerHTML = '<option value="">Select Image 1</option>';
    image2Select.innerHTML = '<option value="">Select Image 2</option>';

    allImages.forEach((image, index) => {
        const option1 = document.createElement("option");
        option1.value = image.id;
        option1.textContent = `${index}: ${image.name}`;
        image1Select.appendChild(option1);

        const option2 = document.createElement("option");
        option2.value = image.id;
        option2.textContent = `${index}: ${image.name}`;
        image2Select.appendChild(option2);
    });

    image1Select.value = oldImage1;
    image2Select.value = oldImage2;
    updateImageCopyButtons();
}

function selectedImageName(select) {
    const selected = allImages.find(
        image => String(image.id) === String(select.value)
    );
    return selected ? selected.name : null;
}

function updateImageCopyButtons() {
    copyImage1NameButton.disabled = !selectedImageName(image1Select);
    copyImage2NameButton.disabled = !selectedImageName(image2Select);
}

async function copySelectedImageName(select, button) {
    const name = selectedImageName(select);
    if (!name) {
        return;
    }
    try {
        await SharedClipboard.copyText(name);
        SharedClipboard.showCopied(button, `Copied: ${name}`);
    } catch (error) {
        console.error("Unable to copy image name:", error);
        button.title = "Unable to copy image name";
    }
}

async function updateImage2List() {
    const imageId1 = image1Select.value;
    if (!imageId1) {
        generatedPairOptions.hidden = true;
        populateImageSelects(); // Reset to full list if no image is selected
        return;
    }

    const previousImage2 = image2Select.value;
    const {imageIds: matchedImageIds, source} = await fetchMatchesForImage(imageId1);
    const generated = source === "pose_neighbors";
    generatedPairOptions.hidden = !generated;
    if (generated) {
        generatedPairMessage.textContent =
            `No matching information found. Showing ${matchedImageIds.length} `
            + "pairs generated from camera positions and viewing directions.";
    }
    const matchedImageIdsSet = new Set(matchedImageIds);

    const filteredImages = allImages.filter((image) => matchedImageIdsSet.has(image.id));

    image2Select.innerHTML = '<option value="">Select Image 2</option>';
    filteredImages.forEach((image) => {
        const originalIndex = allImages.findIndex((img) => img.id === image.id);
        const option = document.createElement("option");
        option.value = image.id;
        option.textContent = `${originalIndex}: ${image.name}`;
        image2Select.appendChild(option);
    });
    if (previousImage2 && matchedImageIdsSet.has(Number(previousImage2))) {
        image2Select.value = previousImage2;
    }
    updateImageCopyButtons();
}

// --- Canvas Drawing Functions ---

function resetCanvasState(canvas, imageElement, state, imageData = null) {
    MatchingCanvas.configure(
        canvas, imageElement, state, window.devicePixelRatio || 1, imageData
    );
}

async function drawImageAndFeatures(imageElement, canvas, ctx, imageId, isLeftPanel) {
    const canvasKey = isLeftPanel ? "image1" : "image2";
    const state = canvasStates[canvasKey];
    const generation = ++imageLoadGenerations[canvasKey];

    if (!imageId) {
        MatchingCanvas.clear(canvas, ctx);
        if (isLeftPanel) { currentImage1Data = null; } else { currentImage2Data = null; }
        return true;
    }

    let imageData;
    try {
        imageData = await matchingApi.imageData(imageId);
    } catch (error) {
        console.error(`Error fetching image data for ID ${imageId}:`, error);
        imageData = null;
    }
    if (!imageData) {
        MatchingCanvas.clear(canvas, ctx);
        return false;
    }
    const select = isLeftPanel ? image1Select : image2Select;
    if (generation !== imageLoadGenerations[canvasKey]
            || String(select.value) !== String(imageId)) {
        return false;
    }

    if (isLeftPanel) {
        currentImage1Data = imageData;
        image1Colors = imageData.points2D.map((p, i) => getColor(i, 0.5));
        line1Colors = (imageData.lines2D || []).map(
            (line, i) => getColor(i, 0.85)
        );
    } else {
        currentImage2Data = imageData;
    }

    return new Promise((resolve) => {
        imageElement.onload = () => {
            if (generation !== imageLoadGenerations[canvasKey]
                    || String(select.value) !== String(imageId)) {
                resolve(false);
                return;
            }
            imageElement.onerror = null;
            resetCanvasState(canvas, imageElement, state, imageData);
            redrawCanvas(canvas, ctx, canvasKey);
            resolve(true);
        };
        imageElement.onerror = () => {
            imageElement.onload = null;
            console.error(`Error loading image ${imageData.name}`);
            resolve(false);
        };
        imageElement.src = matchingImageUrl(imageData.name);
    });
}

function clearMatchingPreviewOverlays() {
    matchCtx.clearRect(0, 0, matchCanvas.width, matchCanvas.height);
    epipolarTool.setSuspended(true);
}

async function loadMatchingNavigationPreview(target, generation, signal) {
    const imageId = target.select.value;
    const image = allImages.find(
        candidate => String(candidate.id) === String(imageId)
    );
    if (!image) {
        return false;
    }
    try {
        const response = await fetch(matchingImageUrl(image.name, 768), {
            signal,
        });
        if (!response.ok) {
            return false;
        }
        const blob = await response.blob();
        if (generation !== matchingPreviewGeneration
                || String(target.select.value) !== String(imageId)) {
            return false;
        }
        const objectUrl = URL.createObjectURL(blob);
        const preview = new Image();
        return await new Promise(resolve => {
            preview.onload = () => {
                URL.revokeObjectURL(objectUrl);
                if (generation !== matchingPreviewGeneration
                        || String(target.select.value) !== String(imageId)) {
                    resolve(false);
                    return;
                }
                const state = canvasStates[target.canvasKey];
                resetCanvasState(target.canvas, preview, state, image);
                MatchingCanvas.clear(target.canvas, target.context);
                target.context.save();
                MatchingCanvas.applyTransform(target.context, state);
                target.context.imageSmoothingEnabled = true;
                const previewSize = MatchingCanvas.imageSize(preview, image);
                target.context.drawImage(
                    preview, 0, 0, previewSize.width, previewSize.height
                );
                target.context.restore();
                // Let the canvas reach the screen before another held-key
                // repeat is allowed to replace it.
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => resolve(true));
                });
            };
            preview.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                resolve(false);
            };
            preview.src = objectUrl;
        });
    } catch (error) {
        if (error.name !== "AbortError") {
            console.error(`Error loading preview for ${image.name}:`, error);
        }
        return false;
    }
}

function showMatchingNavigationPreview(target) {
    matchingPreviewActive = true;
    imageLoadGenerations[target.canvasKey] += 1;
    clearMatchingPreviewOverlays();
    const generation = ++matchingPreviewGeneration;
    const controller = new AbortController();
    matchingPreviewController = controller;
    return loadMatchingNavigationPreview(target, generation, controller.signal)
        .finally(() => {
            if (matchingPreviewController === controller) {
                matchingPreviewController = null;
            }
        });
}

function commitMatchingNavigation(target) {
    matchingPreviewController?.abort();
    matchingPreviewController = null;
    matchingPreviewGeneration += 1;
    matchingPreviewActive = false;
    epipolarTool.setSuspended(false);
    target.select.dispatchEvent(new Event("change"));
}

function redrawCanvas(canvas, ctx, canvasKey) {
    const state = canvasStates[canvasKey];
    const imageElement = canvasKey === "image1" ? currentImage1 : currentImage2;
    const imageData = canvasKey === "image1" ? currentImage1Data : currentImage2Data;

    MatchingCanvas.clear(canvas, ctx);

    if (!imageElement.src || !imageData) {
        return;
    }

    ctx.save();
    MatchingCanvas.applyTransform(ctx, state);
    ctx.imageSmoothingEnabled = state.scale * state.pixelRatio < 1;
    const imageSize = MatchingCanvas.imageSize(imageElement, imageData);
    ctx.drawImage(imageElement, 0, 0, imageSize.width, imageSize.height);

    if (showMarkersCheckbox.checked) {
        drawFeaturePoints(ctx, imageData.points2D, state.scale, canvasKey);
    }
    if (showLinesCheckbox.checked) {
        drawFeatureLines(ctx, imageData.lines2D || [], state.scale, canvasKey);
    }

    ctx.restore();
}

function drawFeatureLines(ctx, lines, currentScale, canvasKey) {
    ctx.lineWidth = 2 / currentScale;
    lines.forEach((line, index) => {
        const matchedIndices = MatchingCorrespondence.indices(
            lineCorrespondences, canvasKey
        );
        if (onlyShowMatchedLines && !matchedIndices.has(index)) {
            return;
        }

        ctx.strokeStyle = MatchingCorrespondence.color(
            index, canvasKey, line1Colors, lineCorrespondences,
            fallbackIndex => getColor(fallbackIndex, 0.85)
        );
        ctx.beginPath();
        ctx.moveTo(line.start[0], line.start[1]);
        ctx.lineTo(line.end[0], line.end[1]);
        ctx.stroke();
    });
}

function lineMidpoint(line) {
    return {
        x: (line.start[0] + line.end[0]) / 2,
        y: (line.start[1] + line.end[1]) / 2,
    };
}

function drawFeaturePoints(ctx, points, currentScale, canvasKey) {
    let size = markerSize / currentScale;

    points.forEach((p, index) => {
        if (onlyShowMatched) {
            let shouldDraw = false;
            if (showInlierMatchesCheckbox.checked) {
                shouldDraw = MatchingCorrespondence.indices(
                    inlierPointCorrespondences, canvasKey
                ).has(index);
            }
            if (!shouldDraw && showWrongMatchesCheckbox.checked) {
                shouldDraw = MatchingCorrespondence.indices(
                    outlierPointCorrespondences, canvasKey
                ).has(index);
            }
            if (!shouldDraw) {
                return;
            }
        }

        ctx.fillStyle = MatchingCorrespondence.color(
            index, canvasKey, image1Colors, pointCorrespondences,
            fallbackIndex => getColor(fallbackIndex, 0.5)
        );
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, 2 * Math.PI);
        ctx.fill();
    });
}

function drawMatches() {
    epipolarTool.syncPair();
    matchCanvas.width = matchCanvas.parentElement.clientWidth;
    matchCanvas.height = matchCanvas.parentElement.clientHeight;
    matchCtx.clearRect(0, 0, matchCanvas.width, matchCanvas.height);

    if (matchingPreviewActive) {
        return;
    }
    if ((!pointMatchesVisible && !lineMatchesVisible)
            || !currentImage1Data || !currentImage2Data) {
        return;
    }

    matchCtx.lineWidth = 1;

    // Draw inlier matches in green
    if (pointMatchesVisible && showInlierMatchesCheckbox.checked) {
        matchCtx.strokeStyle = "rgba(0, 255, 0, 0.5)";
        currentMatches.inlier.forEach((match) => {
            const p1 = currentImage1Data.points2D[match[0]];
            const p2 = currentImage2Data.points2D[match[1]];

            if (p1 && p2 && isPointVisible(p1, "image1") && isPointVisible(p2, "image2")) {
                const p1Canvas = imageToCanvas(p1, "image1");
                const p2Canvas = imageToCanvas(p2, "image2");

                matchCtx.beginPath();
                matchCtx.moveTo(p1Canvas.x, p1Canvas.y);
                matchCtx.lineTo(p2Canvas.x, p2Canvas.y);
                matchCtx.stroke();
            }
        });
    }

    // Draw outlier matches in red
    if (pointMatchesVisible && showWrongMatchesCheckbox.checked) {
        matchCtx.strokeStyle = "rgba(255, 0, 0, 0.5)";
        currentMatches.outlier.forEach((match) => {
            const p1 = currentImage1Data.points2D[match[0]];
            const p2 = currentImage2Data.points2D[match[1]];

            if (p1 && p2 && isPointVisible(p1, "image1") && isPointVisible(p2, "image2")) {
                const p1Canvas = imageToCanvas(p1, "image1");
                const p2Canvas = imageToCanvas(p2, "image2");

                matchCtx.beginPath();
                matchCtx.moveTo(p1Canvas.x, p1Canvas.y);
                matchCtx.lineTo(p2Canvas.x, p2Canvas.y);
                matchCtx.stroke();
            }
        });
    }

    // A line track relates complete segments; its endpoints need not
    // correspond. Connect segment midpoints to avoid implying that they do.
    if (lineMatchesVisible) {
        matchCtx.strokeStyle = LINE_MATCH_CONNECTOR_COLOR;
        currentLineMatches.forEach((match) => {
            const line1 = (currentImage1Data.lines2D || [])[match[0]];
            const line2 = (currentImage2Data.lines2D || [])[match[1]];
            if (!line1 || !line2) {
                return;
            }
            const midpoint1 = lineMidpoint(line1);
            const midpoint2 = lineMidpoint(line2);
            if (!isPointVisible(midpoint1, "image1")
                    || !isPointVisible(midpoint2, "image2")) {
                return;
            }
            const p1Canvas = imageToCanvas(midpoint1, "image1");
            const p2Canvas = imageToCanvas(midpoint2, "image2");
            matchCtx.beginPath();
            matchCtx.moveTo(p1Canvas.x, p1Canvas.y);
            matchCtx.lineTo(p2Canvas.x, p2Canvas.y);
            matchCtx.stroke();
        });
    }
}

function shouldFetchPairMatches() {
    return showInlierMatchesCheckbox.checked
        || showWrongMatchesCheckbox.checked
        || onlyShowMatchedLines
        || lineMatchesVisible;
}

async function refreshSelectedPair() {
    if (!image1Select.value || !image2Select.value) {
        clearMatchSummary();
        return;
    }
    if (shouldFetchPairMatches()) {
        await handleFetchMatches();
    } else {
        await updateMatchSummary();
    }
}

function redrawMatchingView() {
    redrawCanvas(image1Canvas, ctx1, "image1");
    redrawCanvas(image2Canvas, ctx2, "image2");
    drawMatches();
}

// --- Event Handlers ---

sourceSelect.addEventListener('change', async () => {
    const newSource = sourceSelect.value;
    const oldImageId1 = image1Select.value;
    const oldImageId2 = image2Select.value;

    resetMatchState();
    clearMatchSummary();

    await fetch(`/api/set_source/${newSource}`, { method: 'POST' });
    await updateLineControlsVisibility();
    await fetchImages();

    image1Select.value = oldImageId1;
    image2Select.value = oldImageId2;

    if (oldImageId1) {
        await drawImageAndFeatures(currentImage1, image1Canvas, ctx1, oldImageId1, true);
    }
    if (oldImageId2) {
        await drawImageAndFeatures(currentImage2, image2Canvas, ctx2, oldImageId2, false);
    }

    await refreshSelectedPair();

    // Redraw canvases to update markers based on new matches or reset state
    redrawMatchingView();
});

image1Select.addEventListener("change", async () => {
    updateImageCopyButtons();
    const imageId1 = image1Select.value;
    const oldImageId2 = image2Select.value;

    resetMatchState();

    const loaded = await drawImageAndFeatures(
        currentImage1, image1Canvas, ctx1, imageId1, true
    );
    if (!loaded || image1Select.value !== imageId1) {
        return;
    }
    await updateImage2List();

    const newImage2Options = Array.from(image2Select.options).map(opt => opt.value);
    if (oldImageId2 && newImage2Options.includes(oldImageId2)) {
        image2Select.value = oldImageId2;
        await refreshSelectedPair();
        redrawMatchingView();
    } else {
        image2Select.value = "";
        await drawImageAndFeatures(currentImage2, image2Canvas, ctx2, null, false);
        clearMatchSummary();
        drawMatches();
    }
});

image2Select.addEventListener("change", async () => {
    updateImageCopyButtons();
    resetMatchState();

    const imageId2 = image2Select.value;
    const loaded = await drawImageAndFeatures(
        currentImage2, image2Canvas, ctx2, imageId2, false
    );
    if (!loaded || image2Select.value !== imageId2) {
        return;
    }

    await refreshSelectedPair();
    redrawMatchingView();
});

copyImage1NameButton.addEventListener("click", () => {
    copySelectedImageName(image1Select, copyImage1NameButton);
});

copyImage2NameButton.addEventListener("click", () => {
    copySelectedImageName(image2Select, copyImage2NameButton);
});

poseNeighborLimit.addEventListener("change", async () => {
    if (generatedPairOptions.hidden || !image1Select.value) {
        return;
    }
    const previousImage2 = image2Select.value;
    await updateImage2List();
    if (previousImage2 && image2Select.value !== previousImage2) {
        image2Select.dispatchEvent(new Event("change"));
    }
});

showMarkersCheckbox.addEventListener("change", () => {
    redrawCanvas(image1Canvas, ctx1, "image1");
    redrawCanvas(image2Canvas, ctx2, "image2");
});

showOnlyMatchedCheckbox.addEventListener("change", async () => {
    onlyShowMatched = showOnlyMatchedCheckbox.checked;

    if (onlyShowMatched && currentMatches.inlier.length === 0 && currentMatches.outlier.length === 0 && image1Select.value && image2Select.value) {
        await handleFetchMatches();
    }

    redrawCanvas(image1Canvas, ctx1, "image1");
    redrawCanvas(image2Canvas, ctx2, "image2");
});

showLinesCheckbox.addEventListener("change", () => {
    redrawCanvas(image1Canvas, ctx1, "image1");
    redrawCanvas(image2Canvas, ctx2, "image2");
});

showOnlyMatchedLinesCheckbox.addEventListener("change", async () => {
    onlyShowMatchedLines = showOnlyMatchedLinesCheckbox.checked;
    if (onlyShowMatchedLines && currentLineMatches.length === 0
            && image1Select.value && image2Select.value) {
        await handleFetchMatches();
    }
    redrawCanvas(image1Canvas, ctx1, "image1");
    redrawCanvas(image2Canvas, ctx2, "image2");
});

drawMatchesButton.addEventListener("click", async () => {
    pointMatchesVisible = !pointMatchesVisible;
    drawMatchesButton.classList.toggle("active", pointMatchesVisible);

    if (pointMatchesVisible && currentMatches.inlier.length === 0
            && currentMatches.outlier.length === 0
            && currentLineMatches.length === 0) {
        const success = await handleFetchMatches();
        if (!success) {
            pointMatchesVisible = false;
            drawMatchesButton.classList.remove("active");
            return;
        }
    }

    drawMatches();
});

drawLineMatchesButton.addEventListener("click", async () => {
    lineMatchesVisible = !lineMatchesVisible;
    drawLineMatchesButton.classList.toggle("active", lineMatchesVisible);

    if (lineMatchesVisible && currentLineMatches.length === 0) {
        const success = await handleFetchMatches();
        if (!success) {
            lineMatchesVisible = false;
            drawLineMatchesButton.classList.remove("active");
            return;
        }
    }

    redrawCanvas(image1Canvas, ctx1, "image1");
    redrawCanvas(image2Canvas, ctx2, "image2");
    drawMatches();
});

resetViewButton.addEventListener("click", () => {
    if (currentImage1Data) {
        const state1 = canvasStates['image1'];
        resetCanvasState(
            image1Canvas, currentImage1, state1, currentImage1Data
        );
        redrawCanvas(image1Canvas, ctx1, "image1");
    }
    if (currentImage2Data) {
        const state2 = canvasStates['image2'];
        resetCanvasState(
            image2Canvas, currentImage2, state2, currentImage2Data
        );
        redrawCanvas(image2Canvas, ctx2, "image2");
    }
    drawMatches();
    epipolarTool.scheduleDraw();
});

async function handleFetchMatches() {
    const imageId1 = image1Select.value;
    const imageId2 = image2Select.value;

    if (!imageId1 || !imageId2) {
        alert("Please select two images.");
        return false;
    }

    clearMatchSummary("Loading match statistics...");
    resetMatchState();

    let inlierMatches;
    let outlierMatches;
    let lineMatches;
    try {
        [inlierMatches, outlierMatches, lineMatches] = await Promise.all([
            matchingApi.matches(imageId1, imageId2, "inlier"),
            matchingApi.matches(imageId1, imageId2, "outlier"),
            matchingApi.lineMatches(imageId1, imageId2),
        ]);
    } catch (error) {
        console.error("Error fetching matches:", error);
        inlierMatches = null;
        outlierMatches = null;
        lineMatches = null;
    }

    if (inlierMatches === null || outlierMatches === null || lineMatches === null) {
        resetMatchState();
        await updateMatchSummary();
        return false;
    }

    currentMatches = {
        inlier: inlierMatches || [],
        outlier: outlierMatches || []
    };
    currentLineMatches = lineMatches || [];

    const allCombinedMatches = [...currentMatches.inlier, ...currentMatches.outlier];
    pointCorrespondences = MatchingCorrespondence.createIndex(allCombinedMatches);
    inlierPointCorrespondences = MatchingCorrespondence.createIndex(currentMatches.inlier);
    outlierPointCorrespondences = MatchingCorrespondence.createIndex(currentMatches.outlier);
    lineCorrespondences = MatchingCorrespondence.createIndex(currentLineMatches);
    redrawCanvas(image1Canvas, ctx1, "image1");
    redrawCanvas(image2Canvas, ctx2, "image2");
    await updateMatchSummary();
    return true;
}

// --- Canvas Interaction Handlers ---

function getCanvasKey(canvas) {
    return canvas.id === "image1-canvas" ? "image1" : "image2";
}

function handleWheel(e) {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
        markerSize *= e.deltaY < 0 ? 1.25 : 0.8;
        redrawCanvas(image1Canvas, ctx1, "image1");
        redrawCanvas(image2Canvas, ctx2, "image2");
        return;
    }

    const canvas = e.target;
    const ctx = canvas.getContext("2d");
    const canvasKey = getCanvasKey(canvas);
    const state = canvasStates[canvasKey];

    const scaleAmount = 1.1;
    const mouseX = e.clientX - canvas.getBoundingClientRect().left;
    const mouseY = e.clientY - canvas.getBoundingClientRect().top;

    const oldScale = state.scale;
    state.scale *= e.deltaY < 0 ? scaleAmount : 1 / scaleAmount;

    state.translateX = mouseX - (mouseX - state.translateX) * (state.scale / oldScale);
    state.translateY = mouseY - (mouseY - state.translateY) * (state.scale / oldScale);

    redrawCanvas(canvas, ctx, canvasKey);
    drawMatches();
}

function handleMouseDown(e) {
    const canvas = e.target;
    const canvasKey = getCanvasKey(canvas);
    const state = canvasStates[canvasKey];
    state.isDragging = true;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
}

function handleMouseMove(e) {
    const canvas = e.target;
    const ctx = canvas.getContext("2d");
    const canvasKey = getCanvasKey(canvas);
    const state = canvasStates[canvasKey];

    if (state.isDragging) {
        const dx = e.clientX - state.lastMouseX;
        const dy = e.clientY - state.lastMouseY;
        state.translateX += dx;
        state.translateY += dy;
        state.lastMouseX = e.clientX;
        state.lastMouseY = e.clientY;
        redrawCanvas(canvas, ctx, canvasKey);
        drawMatches();
    }
}

function handleMouseUp(e) {
    const canvas = e.target;
    const canvasKey = getCanvasKey(canvas);
    const state = canvasStates[canvasKey];
    state.isDragging = false;
}

function handleMouseOut(e) {
    const canvas = e.target;
    const canvasKey = getCanvasKey(canvas);
    const state = canvasStates[canvasKey];
    state.isDragging = false;
}

[image1Canvas, image2Canvas].forEach(canvas => {
    canvas.addEventListener("wheel", handleWheel);
    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseup", handleMouseUp);
    canvas.addEventListener("mouseout", handleMouseOut);
});

window.addEventListener("resize", () => {
    if (document.body.dataset.viewerMode === "reprojection"
            || matchingPreviewActive) {
        return;
    }
    drawImageAndFeatures(currentImage1, image1Canvas, ctx1, image1Select.value, true);
    drawImageAndFeatures(currentImage2, image2Canvas, ctx2, image2Select.value, false);
    drawMatches();
});

const matchingHoldNavigation = new MatchingNavigation.MatchingHoldNavigation({
    targets: {
        ArrowLeft: {
            select: image1Select,
            direction: "backward",
            canvas: image1Canvas,
            context: ctx1,
            canvasKey: "image1",
        },
        ArrowRight: {
            select: image1Select,
            direction: "forward",
            canvas: image1Canvas,
            context: ctx1,
            canvasKey: "image1",
        },
        ArrowUp: {
            select: image2Select,
            direction: "backward",
            canvas: image2Canvas,
            context: ctx2,
            canvasKey: "image2",
            enabled: () => Boolean(image1Select.value),
        },
        ArrowDown: {
            select: image2Select,
            direction: "forward",
            canvas: image2Canvas,
            context: ctx2,
            canvasKey: "image2",
            enabled: () => Boolean(image1Select.value),
        },
    },
    onPreview: showMatchingNavigationPreview,
    onCommit: commitMatchingNavigation,
});

window.addEventListener("keydown", (e) => {
    if (document.body.dataset.viewerMode === "reprojection") {
        return;
    }
    // Preserve native arrow behavior for unrelated dropdowns. The two image
    // dropdowns intentionally use live navigation even while focused.
    if (document.activeElement.tagName === "SELECT"
            && document.activeElement !== image1Select
            && document.activeElement !== image2Select) {
        return;
    }

    if (matchingHoldNavigation.keyDown(e.key)) {
        e.preventDefault();
    }
});

window.addEventListener("keyup", (e) => {
    if (matchingHoldNavigation.keyUp(e.key)) {
        e.preventDefault();
    }
});
window.addEventListener("blur", () => matchingHoldNavigation.commit());

// --- Utility Functions ---

function getColor(index, alpha = 1.0) {
    const magicNum = (index * 11) % 36;
    const hue = (magicNum / 36) * 360;
    return `hsla(${hue}, 100%, 50%, ${alpha})`;
}

function imageToCanvas(point, canvasKey) {
    const state = canvasStates[canvasKey];
    const canvas = canvasKey === "image1" ? image1Canvas : image2Canvas;
    const panel = canvas.parentElement;

    const viewport = MatchingCanvas.imageToViewport(point, state);
    const x = viewport.x + panel.offsetLeft;
    const y = viewport.y + panel.offsetTop;

    return { x, y };
}

function isPointVisible(point, canvasKey) {
    const state = canvasStates[canvasKey];
    return MatchingCanvas.isVisible(point, state);
}
