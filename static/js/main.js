const image1Select = document.getElementById('image1-select');
const image2Select = document.getElementById('image2-select');
const image1Canvas = document.getElementById('image1-canvas');
const image2Canvas = document.getElementById('image2-canvas');
const matchCanvas = document.getElementById('match-canvas');
const showMarkersCheckbox = document.getElementById('show-markers');
let markerSize = 3;
const drawMatchesButton = document.getElementById('draw-matches');
const showOnlyMatchedCheckbox = document.getElementById('show-only-matched');

let onlyShowMatched = false;

showOnlyMatchedCheckbox.addEventListener('change', async () => {
    onlyShowMatched = showOnlyMatchedCheckbox.checked;

    if (onlyShowMatched && currentMatches.length === 0) {
        await fetchMatches();
    }

    redrawCanvas(image1Canvas, ctx1, 'image1');
    redrawCanvas(image2Canvas, ctx2, 'image2');
});

const ctx1 = image1Canvas.getContext('2d');
const ctx2 = image2Canvas.getContext('2d');
const matchCtx = matchCanvas.getContext('2d');

let allImages = [];
let currentImage1Data = null;
let currentImage2Data = null;
let currentImage1 = new Image();
let currentImage2 = new Image();
let currentMatches = [];

const canvasStates = {
    image1: { scale: 1, translateX: 0, translateY: 0, isDragging: false, lastMouseX: 0, lastMouseY: 0 },
    image2: { scale: 1, translateX: 0, translateY: 0, isDragging: false, lastMouseX: 0, lastMouseY: 0 }
};

// Function to fetch all images from the backend
async function fetchImages() {
    try {
        const response = await fetch('/api/images');
        allImages = await response.json();
        populateImageSelects();
    } catch (error) {
        console.error('Error fetching images:', error);
    }
}

// Function to populate the image selection dropdowns
function populateImageSelects() {
    allImages.sort((a, b) => a.name.localeCompare(b.name));

    image1Select.innerHTML = '<option value="">Select Image 1</option>';
    image2Select.innerHTML = '<option value="">Select Image 2</option>';
    allImages.forEach((image, index) => {
        const option1 = document.createElement('option');
        option1.value = image.id;
        option1.textContent = `${index}: ${image.name}`;
        image1Select.appendChild(option1);

        const option2 = document.createElement('option');
        option2.value = image.id;
        option2.textContent = `${index}: ${image.name}`;
        image2Select.appendChild(option2);
    });
}

// Function to draw an image and its feature points on a canvas
async function drawImageAndFeatures(imageElement, canvas, ctx, imageId, isLeftPanel) {
    const canvasKey = isLeftPanel ? 'image1' : 'image2';
    const state = canvasStates[canvasKey];

    if (!imageId) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    try {
        const response = await fetch(`/api/image_data/${imageId}`);
        const imageData = await response.json();

        if (isLeftPanel) {
            currentImage1Data = imageData;
            image1Colors = imageData.points2D.map((p, i) => getColor(i, 0.5));
        } else {
            currentImage2Data = imageData;
        }

        imageElement.onload = () => {
            const panel = canvas.parentElement;
            canvas.width = panel.clientWidth;
            canvas.height = panel.clientHeight;

            const scaleX = canvas.width / imageElement.width;
            const scaleY = canvas.height / imageElement.height;
            state.scale = Math.min(scaleX, scaleY);
            state.translateX = (canvas.width - imageElement.width * state.scale) / 2;
            state.translateY = (canvas.height - imageElement.height * state.scale) / 2;
            
            redrawCanvas(canvas, ctx, canvasKey);
        };
        imageElement.src = `/serve_image/${imageData.name}`;
    } catch (error) {
        console.error(`Error fetching image data for ID ${imageId}:`, error);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

function redrawCanvas(canvas, ctx, canvasKey) {
    const state = canvasStates[canvasKey];
    const imageElement = (canvasKey === 'image1') ? currentImage1 : currentImage2;
    const imageData = (canvasKey === 'image1') ? currentImage1Data : currentImage2Data;

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

let image1Colors = [];
let matches_map_img2_to_img1 = new Map();

function getColor(index, alpha = 1.0) {
    const magicNum = (index * 11) % 36;
    const hue = (magicNum / 36) * 360;
    return `hsla(${hue}, 100%, 50%, ${alpha})`;
}

function drawFeaturePoints(ctx, points, currentScale, canvasKey) {
    let size = markerSize;
    size = Math.max(1, size / currentScale);

    points.forEach((p, index) => {
        if (onlyShowMatched) {
            if (canvasKey === 'image1' && !matchedIndices1.has(index)) {
                return;
            }
            if (canvasKey === 'image2' && !matchedIndices2.has(index)) {
                return;
            }
        }

        let color;
        if (canvasKey === 'image1') {
            color = image1Colors[index];
        } else { // image2
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

function imageToCanvas(point, canvasKey) {
    const state = canvasStates[canvasKey];
    const canvas = (canvasKey === 'image1') ? image1Canvas : image2Canvas;
    const panel = canvas.parentElement;

    const x_in_canvas = point.x * state.scale + state.translateX;
    const y_in_canvas = point.y * state.scale + state.translateY;

    const x = x_in_canvas + panel.offsetLeft;
    const y = y_in_canvas + panel.offsetTop;

    return { x, y };
}

function isPointVisible(point, canvasKey) {
    const state = canvasStates[canvasKey];
    const canvas = (canvasKey === 'image1') ? image1Canvas : image2Canvas;

    const x_in_canvas = point.x * state.scale + state.translateX;
    const y_in_canvas = point.y * state.scale + state.translateY;

    return x_in_canvas >= 0 && x_in_canvas <= canvas.width &&
           y_in_canvas >= 0 && y_in_canvas <= canvas.height;
}

function drawMatches() {
    matchCanvas.width = matchCanvas.parentElement.clientWidth;
    matchCanvas.height = matchCanvas.parentElement.clientHeight;
    matchCtx.clearRect(0, 0, matchCanvas.width, matchCanvas.height);

    if (!linesVisible || !currentImage1Data || !currentImage2Data || currentMatches.length === 0) {
        return;
    }

    matchCtx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
    matchCtx.lineWidth = 1;

    currentMatches.forEach(match => {
        const p1 = currentImage1Data.points2D[match[0]];
        const p2 = currentImage2Data.points2D[match[1]];

        if (isPointVisible(p1, 'image1') && isPointVisible(p2, 'image2')) {
            const p1Canvas = imageToCanvas(p1, 'image1');
            const p2Canvas = imageToCanvas(p2, 'image2');

            matchCtx.beginPath();
            matchCtx.moveTo(p1Canvas.x, p1Canvas.y);
            matchCtx.lineTo(p2Canvas.x, p2Canvas.y);
            matchCtx.stroke();
        }
    });
}

async function updateImage2List() {
    const imageId1 = image1Select.value;
    if (!imageId1) {
        populateImageSelects(); // Reset to full list if no image is selected
        return;
    }

    try {
        const response = await fetch(`/api/matches_for_image/${imageId1}`);
        const matchedImageIds = await response.json();
        const matchedImageIdsSet = new Set(matchedImageIds);

        const filteredImages = allImages.filter(image => matchedImageIdsSet.has(image.id));

        image2Select.innerHTML = '<option value="">Select Image 2</option>';
        filteredImages.forEach(image => {
            const originalIndex = allImages.findIndex(img => img.id === image.id);
            const option = document.createElement('option');
            option.value = image.id;
            option.textContent = `${originalIndex}: ${image.name}`;
            image2Select.appendChild(option);
        });

    } catch (error) {
        console.error('Error fetching matched images:', error);
    }
}

// Event Listeners
image1Select.addEventListener('change', () => {
    drawImageAndFeatures(currentImage1, image1Canvas, ctx1, image1Select.value, true);
    currentMatches = [];
    drawMatches();
    updateImage2List();
});
image2Select.addEventListener('change', () => {
    drawImageAndFeatures(currentImage2, image2Canvas, ctx2, image2Select.value, false);
    currentMatches = [];
    drawMatches();
});

showMarkersCheckbox.addEventListener('change', () => {
    redrawCanvas(image1Canvas, ctx1, 'image1');
    redrawCanvas(image2Canvas, ctx2, 'image2');
});


let matchedIndices1 = new Set();
let matchedIndices2 = new Set();

let linesVisible = false;

async function fetchMatches() {
    const imageId1 = image1Select.value;
    const imageId2 = image2Select.value;

    if (!imageId1 || !imageId2) {
        alert('Please select two images.');
        return false;
    }

    try {
        const response = await fetch(`/api/matches/${imageId1}/${imageId2}`);
        currentMatches = await response.json();
        matches_map_img2_to_img1 = new Map(currentMatches.map(m => [m[1], m[0]]));
        matchedIndices1 = new Set(currentMatches.map(m => m[0]));
        matchedIndices2 = new Set(currentMatches.map(m => m[1]));
        return true;
    } catch (error) {
        console.error('Error fetching matches:', error);
        return false;
    }
}

drawMatchesButton.addEventListener('click', async () => {
    linesVisible = !linesVisible;

    if (linesVisible && currentMatches.length === 0) {
        const success = await fetchMatches();
        if (!success) {
            linesVisible = false;
            return;
        }
    }

    if (linesVisible) {
        drawMatchesButton.textContent = 'Hide Matches';
    } else {
        drawMatchesButton.textContent = 'Draw Matches';
    }

    drawMatches();
});

function getCanvasKey(canvas) {
    return canvas.id === 'image1-canvas' ? 'image1' : 'image2';
}

function handleWheel(e) {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
        if (e.deltaY < 0) {
            markerSize *= 1.25;
        } else {
            markerSize /= 1.25;
        }
        redrawCanvas(image1Canvas, ctx1, 'image1');
        redrawCanvas(image2Canvas, ctx2, 'image2');
        return;
    }

    const canvas = e.target;
    const ctx = canvas.getContext('2d');
    const canvasKey = getCanvasKey(canvas);
    const state = canvasStates[canvasKey];

    const scaleAmount = 1.1;
    const mouseX = e.clientX - canvas.getBoundingClientRect().left;
    const mouseY = e.clientY - canvas.getBoundingClientRect().top;

    const oldScale = state.scale;
    if (e.deltaY < 0) { // Zoom in
        state.scale *= scaleAmount;
    } else { // Zoom out
        state.scale /= scaleAmount;
    }

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
    const ctx = canvas.getContext('2d');
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

image1Canvas.addEventListener('wheel', handleWheel);
image1Canvas.addEventListener('mousedown', handleMouseDown);
image1Canvas.addEventListener('mousemove', handleMouseMove);
image1Canvas.addEventListener('mouseup', handleMouseUp);
image1Canvas.addEventListener('mouseout', handleMouseOut);

image2Canvas.addEventListener('wheel', handleWheel);
image2Canvas.addEventListener('mousedown', handleMouseDown);
image2Canvas.addEventListener('mousemove', handleMouseMove);
image2Canvas.addEventListener('mouseup', handleMouseUp);
image2Canvas.addEventListener('mouseout', handleMouseOut);

window.addEventListener('resize', () => {
    drawImageAndFeatures(currentImage1, image1Canvas, ctx1, image1Select.value, true);
    drawImageAndFeatures(currentImage2, image2Canvas, ctx2, image2Select.value, false);
    drawMatches();
});

fetchImages();