const image1Select = document.getElementById('image1-select');
const image2Select = document.getElementById('image2-select');
const image1Canvas = document.getElementById('image1-canvas');
const image2Canvas = document.getElementById('image2-canvas');
const showMarkersCheckbox = document.getElementById('show-markers');
const markerSizeSlider = document.getElementById('marker-size');
const drawMatchesButton = document.getElementById('draw-matches');
const drawEpipolarButton = document.getElementById('draw-epipolar');

const ctx1 = image1Canvas.getContext('2d');
const ctx2 = image2Canvas.getContext('2d');

let allImages = [];
let currentImage1Data = null;
let currentImage2Data = null;
let currentImage1 = new Image();
let currentImage2 = new Image();

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
    image1Select.innerHTML = '<option value="">Select Image 1</option>';
    image2Select.innerHTML = '<option value="">Select Image 2</option>';
    allImages.forEach(image => {
        const option1 = document.createElement('option');
        option1.value = image.id;
        option1.textContent = image.name;
        image1Select.appendChild(option1);

        const option2 = document.createElement('option');
        option2.value = image.id;
        option2.textContent = image.name;
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
        } else {
            currentImage2Data = imageData;
        }

        imageElement.onload = () => {
            // Set canvas dimensions to match its parent panel for consistent sizing
            const panel = canvas.parentElement;
            canvas.width = panel.clientWidth;
            canvas.height = panel.clientHeight;
            console.log(`Panel: ${panel.clientWidth}x${panel.clientHeight}, Canvas: ${canvas.width}x${canvas.height}`);

            // Calculate initial scale to fit image within canvas
            const scaleX = canvas.width / imageElement.width;
            const scaleY = canvas.height / imageElement.height;
            state.scale = Math.min(scaleX, scaleY); // Fit to view
            state.translateX = (canvas.width - imageElement.width * state.scale) / 2;
            state.translateY = (canvas.height - imageElement.height * state.scale) / 2;
            console.log(`Image: ${imageElement.width}x${imageElement.height}, Scale: ${state.scale}, Translate: ${state.translateX}, ${state.translateY}`);
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

    console.log(`redrawCanvas for ${canvasKey}: imageElement.src=${imageElement.src}, imageData=${!!imageData}`);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!imageElement.src || !imageData) {
        console.log(`redrawCanvas for ${canvasKey}: Returning early due to missing image or data.`);
        return; // Nothing to draw yet
    }

    ctx.save(); // Save the un-transformed state

    // Apply transformations
    ctx.translate(state.translateX, state.translateY);
    ctx.scale(state.scale, state.scale);

    // Draw image at its original size (transformations handle scaling and positioning)
    ctx.drawImage(imageElement, 0, 0, imageElement.width, imageElement.height);

    if (showMarkersCheckbox.checked) {
        // Draw feature points - coordinates are already in original image space
        drawFeaturePoints(ctx, imageData.points2D, state.scale);
    }

    ctx.restore(); // Restore the un-transformed state
}

// Function to draw feature points
function drawFeaturePoints(ctx, points, currentScale) {
    let markerSize = parseInt(markerSizeSlider.value); // This is the desired screen-space size
    // We are drawing in the transformed context, so we need to divide by scale
    // to make it appear constant in screen space.
    markerSize = Math.max(1, markerSize / currentScale); // Ensure minimum 1 pixel size

    ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    points.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, markerSize, 0, 2 * Math.PI);
        ctx.fill();
    });
}

// Event Listeners
image1Select.addEventListener('change', () => drawImageAndFeatures(currentImage1, image1Canvas, ctx1, image1Select.value, true));
image2Select.addEventListener('change', () => drawImageAndFeatures(currentImage2, image2Canvas, ctx2, image2Select.value, false));
showMarkersCheckbox.addEventListener('change', () => {
    redrawCanvas(image1Canvas, ctx1, 'image1');
    redrawCanvas(image2Canvas, ctx2, 'image2');
});
markerSizeSlider.addEventListener('input', () => {
    redrawCanvas(image1Canvas, ctx1, 'image1');
    redrawCanvas(image2Canvas, ctx2, 'image2');
});

// Function to get canvas key from canvas element
function getCanvasKey(canvas) {
    return canvas.id === 'image1-canvas' ? 'image1' : 'image2';
}

// Generic event handlers for zoom and pan
function handleWheel(e) {
    e.preventDefault();
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

// Attach event listeners to both canvases
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

// Initial fetch
fetchImages();

// Handle window resize to adjust canvas size
window.addEventListener('resize', () => {
    // Re-initialize scale and translation to fit image on resize
    // This might reset user's zoom/pan, but ensures image is visible
    drawImageAndFeatures(currentImage1, image1Canvas, ctx1, image1Select.value, true);
    drawImageAndFeatures(currentImage2, image2Canvas, ctx2, image2Select.value, false);
    // After redrawing, ensure the zoom/pan state is re-applied for consistency
    redrawCanvas(image1Canvas, ctx1, 'image1');
    redrawCanvas(image2Canvas, ctx2, 'image2');
});

// TODO: Implement drawMatches and drawEpipolar functions and their event listeners

