// Get DOM elements
const sourceSelect = document.getElementById("source-select");
const image1Select = document.getElementById("image1-select");
const image2Select = document.getElementById("image2-select");
const image1Canvas = document.getElementById("image1-canvas");
const image2Canvas = document.getElementById("image2-canvas");
const matchCanvas = document.getElementById("match-canvas");
const showMarkersCheckbox = document.getElementById("show-markers");
const drawMatchesButton = document.getElementById("draw-matches");
const showOnlyMatchedCheckbox = document.getElementById("show-only-matched");
const showInlierMatchesCheckbox = document.getElementById("show-inlier-matches");
const showWrongMatchesCheckbox = document.getElementById("show-wrong-matches");
const resetViewButton = document.getElementById("reset-view");
const matchSummaryContent = document.getElementById("match-summary-content");

// Canvas contexts
const ctx1 = image1Canvas.getContext("2d");
const ctx2 = image2Canvas.getContext("2d");
const matchCtx = matchCanvas.getContext("2d");

// State variables
let allImages = [];
let currentImage1Data = null;
let currentImage2Data = null;
let currentImage1 = new Image();
let currentImage2 = new Image();
let currentMatches = { inlier: [], outlier: [] };
let markerSize = 3;
let onlyShowMatched = false;
let linesVisible = false;
let matchedIndices1 = new Set();
let matchedIndices2 = new Set();
let image1Colors = [];
let matches_map_img2_to_img1 = new Map();
let currentMatchSummary = null;

function resetMatchState() {
    currentMatches = { inlier: [], outlier: [] };
    matches_map_img2_to_img1 = new Map();
    matchedIndices1 = new Set();
    matchedIndices2 = new Set();
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

    const summary = await fetchMatchSummary(imageId1, imageId2);
    if (!summary) {
        setMatchSummaryMessage("Unable to load match statistics.");
        return null;
    }

    currentMatchSummary = summary;
    renderMatchSummary(summary);
    return summary;
}

const canvasStates = {
    image1: { scale: 1, translateX: 0, translateY: 0, isDragging: false, lastMouseX: 0, lastMouseY: 0 },
    image2: { scale: 1, translateX: 0, translateY: 0, isDragging: false, lastMouseX: 0, lastMouseY: 0 },
};

// --- Initialization ---

// Initial setup on page load
init();

async function init() {
    await initializeSources();
    await fetchImages();
}

// --- API Functions ---

showInlierMatchesCheckbox.addEventListener("change", async () => {
    if (image1Select.value && image2Select.value) {
        await handleFetchMatches();
        redrawCanvas(image1Canvas, ctx1, "image1");
        redrawCanvas(image2Canvas, ctx2, "image2");
        drawMatches();
    }
});

showWrongMatchesCheckbox.addEventListener("change", async () => {
    if (image1Select.value && image2Select.value) {
        await handleFetchMatches();
        redrawCanvas(image1Canvas, ctx1, "image1");
        redrawCanvas(image2Canvas, ctx2, "image2");
        drawMatches();
    }
});

async function initializeSources() {
    try {
        const response = await fetch("/api/sources");
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const sources = await response.json();

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

async function fetchImages() {
    try {
        const response = await fetch("/api/images");
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        allImages = await response.json();
        populateImageSelects();
    } catch (error) {
        console.error("Error fetching images:", error);
    }
}

async function fetchImageData(imageId) {
    try {
        const response = await fetch(`/api/image_data/${imageId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Error fetching image data for ID ${imageId}:`, error);
        return null;
    }
}

async function fetchMatchesForImage(imageId) {
    try {
        const response = await fetch(`/api/matches_for_image/${imageId}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Error fetching matched images:", error);
        return [];
    }
}

async function fetchMatches(imageId1, imageId2, matchType = null) {
    try {
        let url = `/api/matches/${imageId1}/${imageId2}`;
        if (matchType) {
            url += `?match_type=${matchType}`;
        }
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Error fetching matches:", error);
        return null;
    }
}

async function fetchMatchSummary(imageId1, imageId2) {
    try {
        const response = await fetch(`/api/match_summary/${imageId1}/${imageId2}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error("Error fetching match summary:", error);
        return null;
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
}

async function updateImage2List() {
    const imageId1 = image1Select.value;
    if (!imageId1) {
        populateImageSelects(); // Reset to full list if no image is selected
        return;
    }

    const matchedImageIds = await fetchMatchesForImage(imageId1);
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
}

// --- Canvas Drawing Functions ---

function resetCanvasState(canvas, imageElement, state) {
    const panel = canvas.parentElement;
    canvas.width = panel.clientWidth;
    canvas.height = panel.clientHeight;

    const scaleX = canvas.width / imageElement.width;
    const scaleY = canvas.height / imageElement.height;
    state.scale = Math.min(scaleX, scaleY);
    state.translateX = (canvas.width - imageElement.width * state.scale) / 2;
    state.translateY = (canvas.height - imageElement.height * state.scale) / 2;
}

async function drawImageAndFeatures(imageElement, canvas, ctx, imageId, isLeftPanel) {
    const canvasKey = isLeftPanel ? "image1" : "image2";
    const state = canvasStates[canvasKey];

    if (!imageId) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (isLeftPanel) { currentImage1Data = null; } else { currentImage2Data = null; }
        return;
    }

    const imageData = await fetchImageData(imageId);
    if (!imageData) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    if (isLeftPanel) {
        currentImage1Data = imageData;
        image1Colors = imageData.points2D.map((p, i) => getColor(i, 0.5));
    } else {
        currentImage2Data = imageData;
    }

    return new Promise((resolve) => {
        imageElement.onload = () => {
            resetCanvasState(canvas, imageElement, state);
            redrawCanvas(canvas, ctx, canvasKey);
            resolve();
        };
        imageElement.src = `/serve_image/${imageData.name}`;
    });
}

function redrawCanvas(canvas, ctx, canvasKey) {
    const state = canvasStates[canvasKey];
    const imageElement = canvasKey === "image1" ? currentImage1 : currentImage2;
    const imageData = canvasKey === "image1" ? currentImage1Data : currentImage2Data;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!imageElement.src || !imageData) {
        return;
    }

    ctx.save();
    ctx.translate(state.translateX, state.translateY);
    ctx.scale(state.scale, state.scale);
    ctx.drawImage(imageElement, 0, 0, imageElement.width, imageElement.height);

    if (showMarkersCheckbox.checked) {
        drawFeaturePoints(ctx, imageData.points2D, state.scale, canvasKey);
    }

    ctx.restore();
}

function drawFeaturePoints(ctx, points, currentScale, canvasKey) {
    let size = markerSize / currentScale;

    points.forEach((p, index) => {
        if (onlyShowMatched) {
            if (canvasKey === "image1" && !matchedIndices1.has(index)) {
                return;
            }
            if (canvasKey === "image2" && !matchedIndices2.has(index)) {
                return;
            }
        }

        let color;
        if (canvasKey === "image1") {
            color = image1Colors[index];
        } else {
            if (matches_map_img2_to_img1.has(index)) {
                const index_in_img1 = matches_map_img2_to_img1.get(index);
                color = image1Colors[index_in_img1];
            } else {
                color = getColor(index, 0.5);
            }
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size, 0, 2 * Math.PI);
        ctx.fill();
    });
}

function drawMatches() {
    matchCanvas.width = matchCanvas.parentElement.clientWidth;
    matchCanvas.height = matchCanvas.parentElement.clientHeight;
    matchCtx.clearRect(0, 0, matchCanvas.width, matchCanvas.height);

    if (!linesVisible || !currentImage1Data || !currentImage2Data || (!currentMatches.inlier.length && !currentMatches.outlier.length)) {
        return;
    }

    matchCtx.lineWidth = 1;

    // Draw inlier matches in green
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

    // Draw outlier matches in red
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

// --- Event Handlers ---

sourceSelect.addEventListener('change', async () => {
    const newSource = sourceSelect.value;
    const oldImageId1 = image1Select.value;
    const oldImageId2 = image2Select.value;

    resetMatchState();
    clearMatchSummary();

    await fetch(`/api/set_source/${newSource}`, { method: 'POST' });
    await fetchImages();

    image1Select.value = oldImageId1;
    image2Select.value = oldImageId2;

    if (oldImageId1) {
        await drawImageAndFeatures(currentImage1, image1Canvas, ctx1, oldImageId1, true);
    }
    if (oldImageId2) {
        await drawImageAndFeatures(currentImage2, image2Canvas, ctx2, oldImageId2, false);
    }

    const hasPair = Boolean(image1Select.value && image2Select.value);
    const wantsMatches = showInlierMatchesCheckbox.checked || showWrongMatchesCheckbox.checked;

    if (hasPair) {
        if (wantsMatches) {
            await handleFetchMatches();
        } else {
            await updateMatchSummary();
        }
    } else {
        clearMatchSummary();
    }

    // Redraw canvases to update markers based on new matches or reset state
    redrawCanvas(image1Canvas, ctx1, "image1");
    redrawCanvas(image2Canvas, ctx2, "image2");
    drawMatches();
});

image1Select.addEventListener("change", async () => {
    const imageId1 = image1Select.value;
    const oldImageId2 = image2Select.value;

    resetMatchState();

    await drawImageAndFeatures(currentImage1, image1Canvas, ctx1, imageId1, true);
    await updateImage2List();

    const newImage2Options = Array.from(image2Select.options).map(opt => opt.value);
    if (oldImageId2 && newImage2Options.includes(oldImageId2)) {
        image2Select.value = oldImageId2;
        const hasPair = Boolean(image1Select.value && image2Select.value);
        const wantsMatches = showInlierMatchesCheckbox.checked || showWrongMatchesCheckbox.checked;
        if (hasPair) {
            if (wantsMatches) {
                await handleFetchMatches();
            } else {
                await updateMatchSummary();
            }
        } else {
            clearMatchSummary();
        }
        redrawCanvas(image1Canvas, ctx1, "image1");
        redrawCanvas(image2Canvas, ctx2, "image2");
        drawMatches();
    } else {
        image2Select.value = "";
        await drawImageAndFeatures(currentImage2, image2Canvas, ctx2, null, false);
        clearMatchSummary();
        drawMatches();
    }
});

image2Select.addEventListener("change", async () => {
    resetMatchState();

    await drawImageAndFeatures(currentImage2, image2Canvas, ctx2, image2Select.value, false);

    const hasPair = Boolean(image1Select.value && image2Select.value);
    const wantsMatches = showInlierMatchesCheckbox.checked || showWrongMatchesCheckbox.checked;
    if (hasPair) {
        if (wantsMatches) {
            await handleFetchMatches();
        } else {
            await updateMatchSummary();
        }
    } else {
        clearMatchSummary();
    }

    redrawCanvas(image1Canvas, ctx1, "image1");
    redrawCanvas(image2Canvas, ctx2, "image2");
    drawMatches();
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

drawMatchesButton.addEventListener("click", async () => {
    linesVisible = !linesVisible;

    if (linesVisible && currentMatches.inlier.length === 0 && currentMatches.outlier.length === 0) {
        const success = await handleFetchMatches();
        if (!success) {
            linesVisible = false;
            return;
        }
    }

    drawMatches();
});

resetViewButton.addEventListener("click", () => {
    if (currentImage1Data) {
        const state1 = canvasStates['image1'];
        resetCanvasState(image1Canvas, currentImage1, state1);
        redrawCanvas(image1Canvas, ctx1, "image1");
    }
    if (currentImage2Data) {
        const state2 = canvasStates['image2'];
        resetCanvasState(image2Canvas, currentImage2, state2);
        redrawCanvas(image2Canvas, ctx2, "image2");
    }
    drawMatches();
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

    const showInliers = showInlierMatchesCheckbox.checked;
    const showOutliers = showWrongMatchesCheckbox.checked;

    let inlierMatches = [];
    let outlierMatches = [];

    if (showInliers || showOutliers) {
        if (showInliers) {
            inlierMatches = await fetchMatches(imageId1, imageId2, "inlier");
        }
        if (showOutliers) {
            outlierMatches = await fetchMatches(imageId1, imageId2, "outlier");
        }
    } else {
        // If neither is checked, do not fetch any matches.
        inlierMatches = [];
        outlierMatches = [];
    }

    if (inlierMatches === null || outlierMatches === null) {
        resetMatchState();
        await updateMatchSummary();
        return false;
    }

    currentMatches = {
        inlier: inlierMatches || [],
        outlier: outlierMatches || []
    };

    const allCombinedMatches = [...currentMatches.inlier, ...currentMatches.outlier];

    matches_map_img2_to_img1 = new Map(allCombinedMatches.map((m) => [m[1], m[0]]));
    matchedIndices1 = new Set(allCombinedMatches.map((m) => m[0]));
    matchedIndices2 = new Set(allCombinedMatches.map((m) => m[1]));
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
    drawImageAndFeatures(currentImage1, image1Canvas, ctx1, image1Select.value, true);
    drawImageAndFeatures(currentImage2, image2Canvas, ctx2, image2Select.value, false);
    drawMatches();
});

window.addEventListener("keydown", (e) => {
    // Check if a dropdown is focused
    if (document.activeElement.tagName === "SELECT") {
        return;
    }

    if (
        e.key === "ArrowRight" ||
        e.key === "ArrowDown" ||
        e.key === "ArrowLeft" ||
        e.key === "ArrowUp"
    ) {
        e.preventDefault();

        const imageId1 = image1Select.value;
        if (!imageId1) {
            return;
        }

        const currentIndex = image2Select.selectedIndex;
        const numOptions = image2Select.options.length;

        if (numOptions <= 1) {
            return;
        }

        let nextIndex;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            nextIndex = currentIndex + 1;
            if (nextIndex >= numOptions) {
                nextIndex = 1; // Wrap around to the first image, skipping the placeholder
            }
        } else { // ArrowLeft or ArrowUp
            nextIndex = currentIndex - 1;
            if (nextIndex < 1) {
                nextIndex = numOptions - 1; // Wrap around to the last image
            }
        }

        if (nextIndex !== currentIndex) {
            image2Select.selectedIndex = nextIndex;
            image2Select.dispatchEvent(new Event("change"));
        }
    }
});

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

    const x_in_canvas = point.x * state.scale + state.translateX;
    const y_in_canvas = point.y * state.scale + state.translateY;

    const x = x_in_canvas + panel.offsetLeft;
    const y = y_in_canvas + panel.offsetTop;

    return { x, y };
}

function isPointVisible(point, canvasKey) {
    const state = canvasStates[canvasKey];
    const canvas = canvasKey === "image1" ? image1Canvas : image2Canvas;

    const x_in_canvas = point.x * state.scale + state.translateX;
    const y_in_canvas = point.y * state.scale + state.translateY;

    return x_in_canvas >= 0 && x_in_canvas <= canvas.width && y_in_canvas >= 0 && y_in_canvas <= canvas.height;
}
