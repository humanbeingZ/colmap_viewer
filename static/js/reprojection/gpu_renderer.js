import * as THREE from "three/webgpu";
import {PLYLoader} from "three/addons/loaders/PLYLoader.js";
import {
    instancedBufferAttribute,
    mix,
    modelViewMatrix,
    normalView,
    sRGBTransferEOTF,
    shapeCircle,
    uniform,
    varying,
    vec3,
    vec4,
    vertexColor,
} from "three/tsl";

import {
    clippedDepthRange,
    depthRangesForClipping,
    depthRangeForSphere,
    detectPlyKind,
    imageFrameScissor,
    isPinholeCamera,
    projectionFrustum,
    relativeViewTransform,
    screenRenderSize,
    threeViewRows,
    zoomDetailMaxSize,
    zoomViewRegion,
} from "./gpu_camera.mjs";
import {
    DEFAULT_MESH_COLOR,
    DEFAULT_MESH_BRIGHTNESS,
    DEFAULT_MESH_SHADING,
    meshColor,
    meshBrightness,
    meshMaterialDescription,
    meshShading,
} from "./gpu_mesh_appearance.mjs";
import {normalizeGeometryAttributesForGpu} from "./gpu_geometry.mjs";
import {
    instancedAttributeView,
    needsVisiblePointDepthRange,
    visiblePointDepthPercentiles,
} from "./gpu_point_cloud.mjs";
import {
    DEFAULT_GAUSSIAN_SPLAT_FILTER,
    gaussianSplatFilter,
} from "./gpu_gaussian_filter.mjs";
import {parseMeshChunk} from "./gpu_mesh_chunk.mjs";

const PLAYCANVAS_RENDERER_MODULE =
    "/static/vendor/playcanvas_gaussian_renderer.js";

const POINT_COLOR_MODE_VALUES = Object.freeze({
    rgb: 0,
    depth: 1,
    white: 2,
});

function normalizedPointColorMode(mode) {
    return Object.hasOwn(POINT_COLOR_MODE_VALUES, mode) ? mode : "rgb";
}

function playcanvasRendererModuleUrl() {
    const version = globalThis.REPROJECTION_ASSET_VERSION;
    return version
        ? `${PLAYCANVAS_RENDERER_MODULE}?v=${encodeURIComponent(version)}`
        : PLAYCANVAS_RENDERER_MODULE;
}

function disposeObject(object) {
    if (!object) {
        return;
    }
    const geometries = new Set();
    const materials = new Set();
    object.traverse(node => {
        // Sprite geometry is an internal singleton shared by every Three.js
        // Sprite. Disposing it with one point cloud breaks all later sprites.
        if (node.geometry && !node.isSprite) {
            geometries.add(node.geometry);
        }
        if (node.userData.pointGeometry) {
            geometries.add(node.userData.pointGeometry);
        }
        if (node.splatGeometry) {
            geometries.add(node.splatGeometry);
        }
        const nodeMaterials = Array.isArray(node.material)
            ? node.material : [node.material];
        nodeMaterials.filter(Boolean).forEach(material => materials.add(material));
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
}

function formatFileSize(bytes) {
    if (bytes < 1024 ** 3) {
        return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
    }
    return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}

// Three.js gives explicit offscreen render targets a `depth24plus` attachment.
// Upgrade the capture targets we own before their first use so
// they retain floating-point depth precision. Do not replace the renderer's
// private on-screen framebuffer attachment: mutating that internal target can
// invalidate an already cached WebGPU render pass and drop the graphics device.
function forceFloatDepthTarget(target) {
    if (!target || target.depthBuffer === false) {
        return;
    }
    const width = Math.max(1, target.width | 0);
    const height = Math.max(1, target.height | 0);
    // The depth attachment must match the owning target's sample count; a
    // single-sample depth texture on an MSAA capture target makes the render
    // pass invalid on strict WebGPU backends.
    const samples = Math.max(0, target.samples | 0);
    if (!target.depthTexture) {
        target.depthTexture = new THREE.DepthTexture(width, height);
    }
    const depthTexture = target.depthTexture;
    depthTexture.type = THREE.FloatType;
    depthTexture.image.width = width;
    depthTexture.image.height = height;
    depthTexture.samples = samples;
}

export class ReprojectionGpuRenderer {
    constructor(canvas, gaussianCanvas = null) {
        this.canvas = canvas;
        this.gaussianCanvas = gaussianCanvas;
        // PlayCanvas owns a separate graphics device. Creating it eagerly can
        // destabilize or exhaust the Three.js WebGPU device even when the
        // selected geometry is an ordinary mesh. Initialize it only after a
        // Gaussian PLY has actually been detected.
        this.gaussianRenderer = null;
        this.gaussianRendererPromise = null;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera();
        this.camera.matrixAutoUpdate = false;
        this.camera.matrixWorldAutoUpdate = false;
        this.meshFrustum = new THREE.Frustum();
        this.projectionViewMatrix = new THREE.Matrix4();
        this.cullProjectionMatrix = new THREE.Matrix4();
        this.chunkWorldBounds = new THREE.Box3();
        this.geometries = new Map();
        this.activeKey = null;
        this._nextId = 0;
        this.object = null;
        this.kind = null;
        this.pointSize = 1;
        this.pointSizeNode = uniform(this.pointSize);
        this.pointPixelScaleNode = uniform(1);
        this.pointColorMode = "rgb";
        this.pointColorModeNode = uniform(POINT_COLOR_MODE_VALUES.rgb);
        this.pointDepthNearNode = uniform(0);
        this.pointDepthFarNode = uniform(1);
        this.meshShading = DEFAULT_MESH_SHADING;
        this.meshColor = DEFAULT_MESH_COLOR;
        this.meshBrightness = DEFAULT_MESH_BRIGHTNESS;
        this.gaussianSplatFilter = {...DEFAULT_GAUSSIAN_SPLAT_FILTER};
        this.nearClipFraction = 0;
        this.farClipFraction = 1;
        this.clippingReferenceKey = null;
        this.meshBrightnessNode = uniform(this.meshBrightness);
        this.renderer = new THREE.WebGPURenderer({
            canvas,
            antialias: true,
            alpha: true,
            // Match MeshLab's conventional depth direction. Reversed-Z is
            // attractive for large worlds, but this viewer already fits the
            // projection to each mesh and its WebGPU path produced incorrect
            // winners for closely layered surfaces in dense meshes.
            reversedDepthBuffer: false,
            // The viewer displays ordinary 8-bit imagery. Avoid a half-float
            // color target whose memory cost becomes excessive when zoom
            // detail raises the canvas backing resolution.
            outputBufferType: THREE.UnsignedByteType,
        });
        this.ready = this.renderer.init();
        this._operationQueue = Promise.resolve();
    }

    async ensureGaussianRenderer() {
        if (this.gaussianRenderer) {
            return this.gaussianRenderer;
        }
        if (!this.gaussianCanvas) {
            throw new Error(
                "The dedicated PlayCanvas Gaussian canvas is unavailable"
            );
        }
        if (!this.gaussianRendererPromise) {
            this.gaussianRendererPromise = this._createGaussianRenderer()
                .then(renderer => {
                    this.gaussianRenderer = renderer;
                    return renderer;
                })
                .catch(error => {
                    this.gaussianRenderer = null;
                    this.gaussianRendererPromise = null;
                    throw error;
                });
        }
        return this.gaussianRendererPromise;
    }

    async _loadGaussianRendererClass() {
        const module = await import(playcanvasRendererModuleUrl());
        return module.PlayCanvasGaussianRenderer;
    }

    async _createGaussianRenderer() {
        const PlayCanvasGaussianRenderer =
            await this._loadGaussianRendererClass();
        const renderer = new PlayCanvasGaussianRenderer(this.gaussianCanvas);
        try {
            await renderer.ready;
            renderer.setClippingRange(
                this.nearClipFraction, this.farClipFraction
            );
            renderer.setSplatFilter(this.gaussianSplatFilter);
            return renderer;
        } catch (error) {
            renderer.destroy();
            throw error;
        }
    }

    runGpuOperation(operation) {
        const result = this._operationQueue.then(operation, operation);
        this._operationQueue = result.catch(() => {});
        return result;
    }

    createMeshMaterial(hasVertexColors) {
        const description = meshMaterialDescription(
            this.meshShading, this.meshColor, hasVertexColors
        );
        const options = {
            color: description.color,
            // Vertex colors are connected explicitly below so their source
            // color space can be declared. Letting NodeMaterial multiply the
            // attribute automatically would treat sRGB PLY bytes as linear.
            vertexColors: false,
            side: THREE.FrontSide,
        };
        // Face shading below is derived directly from position derivatives;
        // MeshBasicNodeMaterial does not expose the legacy flatShading flag.
        const material = new THREE.MeshBasicNodeMaterial(options);
        const sourceSrgb = description.vertexColors
            ? vertexColor().rgb
            : vec3(192 / 255);
        // Adjust albedo with a gamma-style curve before lighting. Unlike a
        // post-lighting multiply-and-clamp, this approaches white gradually
        // and leaves the face-normal illumination contrast intact. At 1x the
        // exponent is exactly one, preserving stored unshaded sRGB values.
        let displaySrgb = sourceSrgb.clamp(0, 1).pow(
            this.meshBrightnessNode.reciprocal()
        );
        if (description.lit) {
            // Reproduce MeshLab's legacy fixed-function face lighting in the
            // display-encoded color space. This intentionally differs from a
            // physically linear Lambert material and gives MeshLab's stronger
            // faceted contrast: global ambient 0.2, light ambient 32/255, and
            // a camera-facing diffuse light of 204/255.
            // Only front faces are rendered. Use the magnitude of the
            // view-space incidence so WebGPU's derivative-normal orientation
            // cannot invert the headlight response. With a consistently
            // oriented normal this is identical to max(dot(N, +Z), 0).
            const facing = normalView.dot(vec3(0, 0, 1)).abs();
            const illumination = facing.mul(204 / 255)
                .add(0.2 + 32 / 255);
            // Fixed-function OpenGL clamps the final lit material color, not
            // the illumination sum. The sum may reach 1.1255, allowing a
            // gray albedo to become brighter without saturating to white.
            displaySrgb = displaySrgb.mul(illumination).clamp(0, 1);
        }
        // A direct fragment node bypasses colorNode's implicit treatment of
        // vertexColor(). PLY/MeshLab RGB is display-encoded, so decode it once
        // before the renderer performs its final linear-to-sRGB output pass.
        material.fragmentNode = vec4(sRGBTransferEOTF(displaySrgb), 1);
        return material;
    }

    createPointCloudSprite(geometry) {
        const position = geometry.getAttribute("position");
        const color = geometry.getAttribute("color");
        const instancedPosition = instancedAttributeView(position);
        const positionNode = instancedBufferAttribute(instancedPosition);
        let sourceColor = color
            // Preserve the attribute's normalized flag while reading one
            // color per sprite instance. PLYLoader colors are already linear;
            // Gaussian DC colors are tagged and decoded immediately below.
            ? instancedBufferAttribute(instancedAttributeView(color)).rgb
            : uniform(new THREE.Color(0xb0b0b0));
        if (color && geometry.userData.vertexColorsAreSrgb) {
            sourceColor = sRGBTransferEOTF(sourceColor);
        }

        // Match the server renderer's four-stop display-sRGB depth palette.
        // Visible-depth percentiles are supplied by configureCamera() only in
        // depth mode, keeping RGB and white navigation free of sampling work.
        const pointDepth = varying(
            modelViewMatrix.mul(vec4(positionNode, 1)).z.negate()
        );
        const depthFraction = pointDepth.sub(this.pointDepthNearNode).div(
            this.pointDepthFarNode.sub(this.pointDepthNearNode).max(1e-6)
        ).clamp(0, 1).mul(3);
        let depthSrgb = mix(
            vec3(1, 40 / 255, 40 / 255),
            vec3(1, 220 / 255, 30 / 255),
            depthFraction.clamp(0, 1)
        );
        depthSrgb = mix(
            depthSrgb,
            vec3(20 / 255, 220 / 255, 220 / 255),
            depthFraction.sub(1).clamp(0, 1)
        );
        depthSrgb = mix(
            depthSrgb,
            vec3(40 / 255, 80 / 255, 1),
            depthFraction.sub(2).clamp(0, 1)
        );
        const depthColor = sRGBTransferEOTF(depthSrgb);
        const selectedColor = this.pointColorModeNode.equal(
            POINT_COLOR_MODE_VALUES.white
        ).select(
            vec3(1),
            this.pointColorModeNode.equal(POINT_COLOR_MODE_VALUES.depth)
                .select(depthColor, sourceColor)
        );
        // The server renderer expands points with an elliptical OpenCV
        // kernel. Mask the instanced sprite's square quad to the equivalent
        // circular footprint, including antialiasing when MSAA is available.
        // The mask also prevents transparent corners from writing depth.
        const pointShape = shapeCircle();
        const materialOptions = {
            color: 0xffffff,
            colorNode: selectedColor,
            maskNode: pointShape.greaterThan(0),
            opacityNode: pointShape,
            positionNode,
            sizeNode: this.pointSizeNode.mul(this.pointPixelScaleNode),
            sizeAttenuation: false,
        };
        const sprite = new THREE.Sprite(
            new THREE.PointsNodeMaterial(materialOptions)
        );
        sprite.count = position.count;
        // Sprite's built-in frustum test only represents one sprite at the
        // origin, not the entire instanced cloud. Camera projection already
        // clips instances efficiently on the GPU.
        sprite.frustumCulled = false;
        sprite.userData.pointGeometry = geometry;
        sprite.userData.boundingSphere = geometry.boundingSphere?.clone();
        sprite.userData.depthColorRanges = new Map();
        return sprite;
    }

    static async inspectFile(file) {
        const header = await file.slice(0, 1024 * 1024).text();
        return ReprojectionGpuRenderer.inspectHeader(header);
    }

    static inspectHeader(header) {
        if (!header.startsWith("ply") || !header.includes("end_header")) {
            throw new Error("The selected file is not a valid PLY file");
        }
        return detectPlyKind(header.slice(0, header.indexOf("end_header") + 10));
    }

    async loadFile(file, expectedKind = null, isCurrent = () => true) {
        await this.ready;
        const kind = expectedKind || await ReprojectionGpuRenderer.inspectFile(file);
        if (kind === "gaussian splats") {
            const renderer = await this.ensureGaussianRenderer();
            const loaded = await renderer.loadFile(
                file, isCurrent
            );
            return loaded && this.installGaussian(loaded);
        }
        let bytes;
        try {
            bytes = await file.arrayBuffer();
        } catch (error) {
            const message = `The browser could not read ${formatFileSize(file.size)} `
                + "into one contiguous buffer. Direct Three.js PLY rendering "
                + "currently requires the complete file in memory; simplify or "
                + "partition the geometry, or use the CLI geometry fallback.";
            throw new Error(message, {cause: error});
        }
        return this.loadArrayBuffer(bytes, kind, isCurrent);
    }

    async loadUrl(
        url, fileSize, isCurrent = () => true, filename = "geometry.ply",
        expectedKind = null
    ) {
        await this.ready;
        if (expectedKind === "gaussian splats") {
            const renderer = await this.ensureGaussianRenderer();
            const loaded = await renderer.loadUrl(
                url, filename, isCurrent
            );
            return loaded && this.installGaussian(loaded);
        }
        const response = await fetch(url, {
            headers: expectedKind ? {} : {Range: "bytes=0-1048575"},
        });
        if (!response.ok) {
            throw new Error(`Unable to read configured geometry: HTTP ${response.status}`);
        }
        let inspectionBytes;
        try {
            inspectionBytes = await response.arrayBuffer();
        } catch (error) {
            const message = `The browser could not buffer ${formatFileSize(fileSize)} `
                + "of configured geometry. Simplify or partition the file.";
            throw new Error(message, {cause: error});
        }
        const header = new TextDecoder().decode(
            inspectionBytes.slice(0, 1024 * 1024)
        );
        const kind = expectedKind
            || ReprojectionGpuRenderer.inspectHeader(header);
        if (kind === "gaussian splats") {
            const renderer = await this.ensureGaussianRenderer();
            const loaded = await renderer.loadUrl(
                url, filename, isCurrent
            );
            return loaded && this.installGaussian(loaded);
        }
        let bytes = inspectionBytes;
        if (response.status === 206) {
            const fullResponse = await fetch(url);
            if (!fullResponse.ok) {
                throw new Error(
                    `Unable to read configured geometry: HTTP ${fullResponse.status}`
                );
            }
            bytes = await fullResponse.arrayBuffer();
        }
        return this.loadArrayBuffer(bytes, kind, isCurrent);
    }

    async loadMeshStream(
        manifest, image, isCurrent = () => true, onProgress = () => {}
    ) {
        await this.ready;
        if (!this.supportsCamera(image)) {
            throw new Error("Streamed mesh GPU preparation requires a PINHOLE camera");
        }
        this.configureCamera(image);
        const material = this.createMeshMaterial(true);
        const group = this.createMeshClippingGroup();
        const chunks = new Array(manifest.chunk_count);
        const controller = new AbortController();
        let nextChunk = 0;
        let completed = 0;
        // compileAsync mutates renderer preparation state, so keep GPU uploads
        // serialized while allowing all network/NumPy chunk work to remain
        // six-way parallel. This overlaps the two expensive pipeline stages.
        let gpuPreparation = Promise.resolve();
        const queueGpuPreparation = (mesh) => {
            gpuPreparation = gpuPreparation.then(async () => {
                if (!isCurrent()) {
                    return;
                }
                await this.runGpuOperation(() => {
                    this.configureCamera(image);
                    return this.renderer.compileAsync(
                        mesh, this.camera, this.scene
                    );
                });
                completed += 1;
                onProgress(completed, manifest.chunk_count);
            });
        };
        const loadNext = async () => {
            while (isCurrent()) {
                const chunkIndex = nextChunk++;
                if (chunkIndex >= manifest.chunk_count) {
                    return;
                }
                const url = manifest.chunk_url.replace("{chunk_index}", chunkIndex);
                const response = await fetch(url, {
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new Error(
                        `Unable to stream mesh chunk ${chunkIndex + 1}: `
                        + `HTTP ${response.status}`
                    );
                }
                const meshChunk = ReprojectionGpuRenderer.createMeshChunk(
                    await response.arrayBuffer(), material
                );
                // Manual chunk AABB culling is applied before real renders.
                // Disable the default sphere test here so compileAsync always
                // uploads the chunk, regardless of the preparation camera.
                meshChunk.traverse(node => {
                    if (node.isMesh) {
                        node.frustumCulled = false;
                    }
                });
                chunks[chunkIndex] = meshChunk;
                queueGpuPreparation(meshChunk);
            }
        };
        // The local FastAPI endpoint encodes chunks in its thread pool, and
        // NumPy releases the GIL while remapping them. Six requests fill the
        // usual per-origin HTTP/1.1 connection budget without creating a large
        // queue of 40 MiB responses in browser memory.
        const workerCount = Math.min(6, manifest.chunk_count);
        const workers = Array.from({length: workerCount}, loadNext);
        const disposeChunks = () => {
            chunks.filter(Boolean).forEach(chunk => group.add(chunk));
            if (group.children.length) {
                disposeObject(group);
            } else {
                material.dispose();
            }
        };
        try {
            await Promise.all(workers);
            await gpuPreparation;
            if (!isCurrent()) {
                controller.abort();
                disposeChunks();
                return null;
            }
        } catch (error) {
            controller.abort();
            await Promise.allSettled(workers);
            await gpuPreparation.catch(() => {});
            disposeChunks();
            throw error;
        }
        chunks.forEach(chunk => group.add(chunk));
        group.userData.streamedMesh = true;
        const bounds = new THREE.Box3();
        chunks.forEach(chunk => bounds.union(chunk.userData.boundingBox));
        group.userData.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
        const key = this.installObject(group, "triangle mesh");
        return {
            kind: "triangle mesh",
            count: manifest.vertex_count,
            key,
            // Every chunk was compiled above before it was installed. Tell
            // the caller not to compile the complete group a second time.
            gpuPrepared: true,
        };
    }

    static createMeshChunk(bytes, material) {
        const chunk = parseMeshChunk(bytes);
        const position = new THREE.BufferAttribute(chunk.positions, 3);
        const color = new THREE.BufferAttribute(chunk.colors, 3, true);
        const index = new THREE.BufferAttribute(chunk.indices, 1);
        const root = new THREE.Group();
        const bounds = new THREE.Box3();
        const draws = chunk.draws.length ? chunk.draws : [{
            faceStart: 0,
            faceCount: chunk.faceCount,
            minimum: null,
            maximum: null,
        }];
        const fineMeshes = draws.map(draw => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", position);
            geometry.setAttribute("color", color);
            const indexStart = draw.faceStart * 3;
            geometry.setIndex(index);
            geometry.setDrawRange(indexStart, draw.faceCount * 3);
            if (draw.minimum && draw.maximum) {
                geometry.boundingBox = new THREE.Box3(
                    new THREE.Vector3(...draw.minimum),
                    new THREE.Vector3(...draw.maximum)
                );
            } else {
                geometry.computeBoundingBox();
            }
            bounds.union(geometry.boundingBox);
            return new THREE.Mesh(geometry, material);
        });
        const coarseGeometry = new THREE.BufferGeometry();
        coarseGeometry.setAttribute("position", position);
        coarseGeometry.setAttribute("color", color);
        coarseGeometry.setIndex(index);
        coarseGeometry.boundingBox = bounds.clone();
        const coarseMesh = new THREE.Mesh(coarseGeometry, material);
        const fineGroup = new THREE.Group();
        fineMeshes.forEach(mesh => fineGroup.add(mesh));
        root.add(coarseMesh, fineGroup);
        root.userData.boundingBox = bounds;
        root.userData.coarseMesh = coarseMesh;
        root.userData.fineMeshes = fineMeshes;
        return root;
    }

    loadArrayBuffer(bytes, kind, isCurrent = () => true) {
        if (kind === "gaussian splats") {
            return this.ensureGaussianRenderer()
                .then(renderer => renderer.loadArrayBuffer(bytes, isCurrent))
                .then(loaded => loaded && this.installGaussian(loaded));
        }
        let geometry;
        let object;
        geometry = new PLYLoader().parse(bytes);
        normalizeGeometryAttributesForGpu(geometry);
        geometry.computeBoundingSphere();
        if (kind === "triangle mesh") {
                // Remove any PLY vertex normals so normalView is computed from
                // position derivatives, giving true per-face flat shading.
                geometry.deleteAttribute("normal");
                object = new THREE.Mesh(
                    geometry,
                    this.createMeshMaterial(Boolean(geometry.getAttribute("color")))
                );
        } else {
            object = this.createPointCloudSprite(geometry);
        }
        if (!isCurrent()) {
            disposeObject(object);
            return null;
        }
        const key = this.installObject(object, kind);
        return {
            kind,
            count: geometry.getAttribute("position")?.count || 0,
            key,
        };
    }

    installObject(object, kind) {
        const key = String(this._nextId++);
        if (kind === "triangle mesh" && !object.isClippingGroup) {
            const mesh = object;
            object = this.createMeshClippingGroup();
            object.add(mesh);
            const sphere = mesh.geometry?.boundingSphere;
            if (sphere) {
                object.userData.boundingSphere = sphere.clone();
            }
        }
        object.visible = false;
        this.scene.add(object);
        this.geometries.set(key, {object, kind, engine: "three"});
        this.activateGeometry(key);
        return key;
    }

    installGaussian(loaded) {
        try {
            const pointCloud = loaded.pointCloud
                || this.gaussianRenderer.getPointCloudData?.(loaded.key);
            return this._installGaussian({...loaded, pointCloud});
        } catch (error) {
            this.gaussianRenderer.dispose(loaded.key);
            throw error;
        }
    }

    _installGaussian(loaded) {
        const gaussianKey = String(this._nextId++);
        const pointKey = loaded.pointCloud ? String(this._nextId++) : null;
        const linkedKeys = pointKey
            ? [gaussianKey, pointKey] : [gaussianKey];
        let pointObject = null;
        if (pointKey) {
            const pointGeometry = new THREE.BufferGeometry();
            pointGeometry.setAttribute(
                "position", new THREE.BufferAttribute(
                    loaded.pointCloud.positions, 3
                )
            );
            pointGeometry.userData.vertexColorsAreSrgb = true;
            pointGeometry.setAttribute(
                "color", new THREE.BufferAttribute(
                    loaded.pointCloud.colors, 3, true
                )
            );
            pointGeometry.computeBoundingSphere();
            pointObject = this.createPointCloudSprite(pointGeometry);
            pointObject.visible = false;
        }
        this.geometries.set(gaussianKey, {
            adapterKey: loaded.key,
            count: loaded.count,
            kind: "gaussian splats",
            engine: "playcanvas",
            linkedKeys,
        });
        if (pointKey) {
            this.scene.add(pointObject);
            this.geometries.set(pointKey, {
                object: pointObject,
                count: loaded.count,
                kind: "point cloud",
                engine: "three",
                linkedKeys,
            });
        }
        this.activateGeometry(gaussianKey);
        const representations = [{
            key: gaussianKey,
            kind: "gaussian splats",
            count: loaded.count,
            label: "Gaussian",
        }];
        if (pointKey) {
            representations.push({
                key: pointKey,
                kind: "point cloud",
                count: loaded.count,
                label: "points",
                hiddenByDefault: true,
            });
        }
        return {
            kind: "gaussian splats",
            count: loaded.count,
            key: gaussianKey,
            representations,
        };
    }

    createMeshClippingGroup() {
        const group = new THREE.ClippingGroup();
        // Keep the plane count constant while clipping is active so scrolling
        // only updates uniforms and never recompiles the mesh pipelines.
        group.clippingPlanes = [new THREE.Plane(), new THREE.Plane()];
        group.enabled = false;
        return group;
    }

    configureMeshClipping(group, near, far) {
        if (!group?.isClippingGroup) {
            return;
        }
        // Plane distances are evaluated in world space by ClippingGroup. Build
        // the desired planes in camera/view space, then transform them back to
        // world space. The retained interval is -far <= viewZ <= -near.
        group.clippingPlanes[0]
            .set(new THREE.Vector3(0, 0, -1), -near)
            .applyMatrix4(this.camera.matrixWorld);
        group.clippingPlanes[1]
            .set(new THREE.Vector3(0, 0, 1), far)
            .applyMatrix4(this.camera.matrixWorld);
        group.enabled = this.nearClipFraction > 1e-9
            || this.farClipFraction < 1 - 1e-9;
    }

    activateGeometry(key) {
        if (this.activeKey === key) {
            return;
        }
        const previous = this.geometries.get(this.activeKey);
        if (previous?.object) {
            previous.object.visible = false;
        }
        const entry = this.geometries.get(key);
        if (entry?.engine === "playcanvas") {
            this.gaussianRenderer.activate(entry.adapterKey);
            this.object = null;
            this.kind = entry.kind;
        } else if (entry) {
            // PlayCanvas owns a separate canvas from Three.js. Leave its last
            // Gaussian frame untouched while the mesh engine renders so that
            // the DOM handoff can retain that real outgoing frame. Calling
            // activate(null) here schedules a PlayCanvas clear and turns the
            // still-visible transition canvas black.
            entry.object.visible = true;
            this.object = entry.object;
            this.kind = entry.kind;
        } else {
            this.gaussianRenderer?.activate(null);
            this.object = null;
            this.kind = null;
        }
        this.activeKey = key;
    }

    getActiveKey() {
        return this.activeKey;
    }

    getGeometryKeys() {
        return [...this.geometries.keys()];
    }

    getGeometryEngine(key) {
        return this.geometries.get(key)?.engine || null;
    }

    prepareGeometry(key, image, isCurrent = () => true) {
        return this.runGpuOperation(
            () => this._prepareGeometry(key, image, isCurrent)
        );
    }

    async _prepareGeometry(key, image, isCurrent) {
        const entry = this.geometries.get(key);
        if (!entry || !this.supportsCamera(image)) {
            return false;
        }
        await this.ready;
        if (!isCurrent()) {
            return false;
        }
        if (entry.engine === "playcanvas") {
            this.activateGeometry(key);
            this.gaussianRenderer.configureCamera(image);
            return isCurrent();
        }
        const previousKey = this.activeKey;
        this.activateGeometry(key);
        try {
            this.configureCamera(image);
            this.cullMeshChunks();
            await this.renderer.compileAsync(
                entry.object, this.camera, this.scene
            );
            return isCurrent();
        } finally {
            if (previousKey !== key && this.geometries.has(previousKey)) {
                this.activateGeometry(previousKey);
            }
        }
    }

    supportsCamera(image) {
        return isPinholeCamera(image);
    }

    geometryDepthRange(
        entry, viewMatrix = this.camera.matrixWorldInverse
    ) {
        if (entry?.engine === "playcanvas") {
            const sphere = this.gaussianRenderer.getSphere(entry.adapterKey);
            if (!sphere) {
                return {near: 1e-4, far: 1e7};
            }
            const center = new THREE.Vector3(...sphere.center)
                .applyMatrix4(viewMatrix);
            return depthRangeForSphere(
                -center.z, Math.max(sphere.radius, 1e-6), false
            );
        }
        const object = entry?.object;
        const sourceGeometry = object?.userData?.pointGeometry
            || object?.splatGeometry || object?.geometry;
        const sphere = object?.userData?.boundingSphere
            || sourceGeometry?.boundingSphere;
        if (!sphere) {
            return {near: 1e-4, far: 1e7};
        }
        const center = sphere.center.clone().applyMatrix4(
            viewMatrix
        );
        return depthRangeForSphere(
            -center.z,
            Math.max(sphere.radius, 1e-6),
            this.renderer.reversedDepthBuffer
        );
    }

    clippingDepthRange(viewMatrix = this.camera.matrixWorldInverse) {
        const customClipping = this.nearClipFraction > 1e-9
            || this.farClipFraction < 1 - 1e-9;
        let reference = customClipping
            ? this.geometries.get(this.clippingReferenceKey)
            : this.geometries.get(this.activeKey);
        if (customClipping && !reference) {
            this.clippingReferenceKey = this.activeKey;
            reference = this.geometries.get(this.activeKey);
        }
        return this.geometryDepthRange(reference, viewMatrix);
    }

    clippingPlanesForImage(image) {
        const viewMatrix = new THREE.Matrix4();
        const rows = threeViewRows(image.cam_from_world);
        viewMatrix.set(...rows.flat());
        return clippedDepthRange(
            this.clippingDepthRange(viewMatrix),
            this.nearClipFraction,
            this.farClipFraction
        );
    }

    configureCamera(image, region = null) {
        const rows = threeViewRows(image.cam_from_world);
        this.camera.matrixWorldInverse.set(...rows.flat());
        this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert();
        this.camera.matrix.copy(this.camera.matrixWorld);

        const {near, far} = this.clippingDepthRange();
        this.camera.coordinateSystem = this.renderer.coordinateSystem;
        this.camera._reversedDepth = Boolean(this.renderer.reversedDepthBuffer);
        const stableMeshDepth = this.kind === "triangle mesh";
        const depthRanges = depthRangesForClipping(
            {near, far}, this.nearClipFraction, this.farClipFraction,
            stableMeshDepth
        );
        const clipped = depthRanges.clipping;
        // Mesh clipping must not alter the projection matrix: changing its far
        // term shifts all quantized depth values and can change the winner for
        // nearly coplanar triangles. ClippingGroup removes geometry with real
        // planes while a fixed full-range projection preserves the occlusion
        // ordering of every surviving fragment.
        const projectionRange = depthRanges.projection;
        const frustum = projectionFrustum(
            image, projectionRange.near, projectionRange.far, region
        );
        if (needsVisiblePointDepthRange(this.kind, this.pointColorMode)) {
            const pointGeometry = this.object?.userData?.pointGeometry;
            const rangeCache = this.object?.userData?.depthColorRanges;
            const rangeKey = JSON.stringify([
                ...this.camera.matrixWorldInverse.elements,
                frustum.left, frustum.right, frustum.top, frustum.bottom,
                clipped.near, clipped.far,
            ]);
            let depthColorRange = rangeCache?.get(rangeKey);
            if (!depthColorRange) {
                depthColorRange = visiblePointDepthPercentiles(
                    pointGeometry?.getAttribute("position"),
                    this.camera.matrixWorldInverse,
                    frustum,
                    clipped
                ) || clipped;
                if (rangeCache) {
                    rangeCache.set(rangeKey, depthColorRange);
                    if (rangeCache.size > 32) {
                        rangeCache.delete(rangeCache.keys().next().value);
                    }
                }
            }
            this.pointDepthNearNode.value = depthColorRange.near;
            this.pointDepthFarNode.value = depthColorRange.far;
        } else {
            this.pointDepthNearNode.value = clipped.near;
            this.pointDepthFarNode.value = clipped.far;
        }
        this.camera.near = frustum.near;
        this.camera.far = frustum.far;
        this.camera.projectionMatrix.makePerspective(
            frustum.left, frustum.right, frustum.top, frustum.bottom,
            frustum.near, frustum.far, this.camera.coordinateSystem,
            this.camera.reversedDepth
        );
        this.camera.projectionMatrixInverse.copy(
            this.camera.projectionMatrix
        ).invert();
        if (stableMeshDepth) {
            this.configureMeshClipping(this.object, clipped.near, clipped.far);
        }

        // Chunk culling must ignore the user's near/far clipping planes: the
        // ClippingGroup enforces them after chunk selection. Build a separate
        // culling frustum from the active geometry's full depth extent so a
        // chunk intersecting a plane is never removed as a whole (which would
        // otherwise flicker while the plane scrolls through it).
        const activeEntry = this.geometries.get(this.activeKey);
        const cullRange = this.geometryDepthRange(activeEntry);
        const cullFrustum = projectionFrustum(
            image, cullRange.near, cullRange.far, region
        );
        this.cullProjectionMatrix.makePerspective(
            cullFrustum.left, cullFrustum.right, cullFrustum.top,
            cullFrustum.bottom, cullFrustum.near, cullFrustum.far,
            this.camera.coordinateSystem, this.camera.reversedDepth
        );
    }

    cullMeshChunks() {
        if (this.kind !== "triangle mesh" || !this.object) {
            return;
        }
        this.object.updateMatrixWorld(true);
        this.projectionViewMatrix.multiplyMatrices(
            this.cullProjectionMatrix, this.camera.matrixWorldInverse
        );
        this.meshFrustum.setFromProjectionMatrix(
            this.projectionViewMatrix,
            this.camera.coordinateSystem,
            this.camera.reversedDepth
        );
        if (this.object.userData.streamedMesh) {
            for (const chunk of this.object.children) {
                const {coarseMesh, fineMeshes} = chunk.userData;
                this.chunkWorldBounds.copy(chunk.userData.boundingBox)
                    .applyMatrix4(chunk.matrixWorld);
                if (!this.meshFrustum.intersectsBox(this.chunkWorldBounds)) {
                    coarseMesh.visible = false;
                    fineMeshes.forEach(mesh => {
                        mesh.visible = false;
                    });
                    continue;
                }
                let visibleCount = 0;
                fineMeshes.forEach(mesh => {
                    this.chunkWorldBounds.copy(mesh.geometry.boundingBox)
                        .applyMatrix4(mesh.matrixWorld);
                    mesh.visible = this.meshFrustum.intersectsBox(
                        this.chunkWorldBounds
                    );
                    visibleCount += mesh.visible ? 1 : 0;
                });
                const useCoarseDraw = visibleCount === fineMeshes.length;
                coarseMesh.visible = useCoarseDraw;
                if (useCoarseDraw) {
                    fineMeshes.forEach(mesh => {
                        mesh.visible = false;
                    });
                }
            }
            return;
        }
        this.object.traverse(node => {
            if (!node.isMesh || !node.geometry?.boundingBox) {
                return;
            }
            this.chunkWorldBounds.copy(node.geometry.boundingBox)
                .applyMatrix4(node.matrixWorld);
            node.visible = this.meshFrustum.intersectsBox(this.chunkWorldBounds);
            // The explicit AABB test is tighter than Three's default sphere
            // test, so do not repeat the looser test during render traversal.
            node.frustumCulled = false;
        });
    }

    configureFrameScissor(image, width, height, region, enabled, target = null) {
        if (!enabled) {
            this.renderer.setScissorTest(false);
            return;
        }
        const scissor = imageFrameScissor(image, width, height, region);
        if (target) {
            target.scissor.set(
                scissor.x, scissor.y, scissor.width, scissor.height
            );
            target.scissorTest = true;
        } else {
            this.renderer.setScissor(
                scissor.x, scissor.y, scissor.width, scissor.height
            );
        }
        this.renderer.setScissorTest(true);
    }

    render(image, width, height, region = null, clipFrame = false) {
        return this.runGpuOperation(
            () => this._render(image, width, height, region, clipFrame)
        );
    }

    renderGeometry(
        key, image, width, height, region = null, clipFrame = false,
        isCurrent = () => true
    ) {
        return this.runGpuOperation(async () => {
            if (!isCurrent()) {
                return false;
            }
            const previousKey = this.activeKey;
            this.activateGeometry(key);
            try {
                await this._render(image, width, height, region, clipFrame);
                const current = isCurrent();
                if (!current && previousKey !== key) {
                    this.activateGeometry(
                        this.geometries.has(previousKey) ? previousKey : null
                    );
                }
                return current;
            } catch (error) {
                if (previousKey !== key) {
                    this.activateGeometry(
                        this.geometries.has(previousKey) ? previousKey : null
                    );
                }
                throw error;
            }
        });
    }

    async _render(image, width, height, region, clipFrame) {
        const entry = this.geometries.get(this.activeKey);
        if (!entry) {
            return;
        }
        if (!this.supportsCamera(image)) {
            throw new Error(
                `True GPU rendering is not yet calibrated for ${image.camera.model}`
            );
        }
        await this.ready;
        if (entry.engine === "playcanvas") {
            const clippingPlanes = this.clippingPlanesForImage(image);
            await this.gaussianRenderer.render(
                entry.adapterKey, image, width, height, region, clipFrame,
                clippingPlanes
            );
            return;
        }
        this.configureCamera(image, region);
        this.cullMeshChunks();
        this.renderer.setSize(width, height, false);
        this.configureFrameScissor(
            image, width, height, region, clipFrame
        );
        try {
            this.renderer.render(this.scene, this.camera);
        } finally {
            this.renderer.setScissorTest(false);
        }
        // WebGPURenderer.render() only submits commands. Keep the preceding
        // transformed frame visible until the new cropped frame is actually
        // complete; otherwise the frontend changes coordinate systems while
        // partially rendered canvas contents are still being presented.
        const gpuQueue = this.renderer.backend?.device?.queue;
        if (gpuQueue?.onSubmittedWorkDone) {
            await gpuQueue.onSubmittedWorkDone();
        }
    }

    setPointSize(size) {
        this.pointSize = Number(size);
        this.pointSizeNode.value = this.pointSize;
    }

    setPointPixelScale(scale) {
        this.pointPixelScaleNode.value = Math.max(Number(scale) || 1, 1e-6);
    }

    setPointColorMode(mode) {
        this.pointColorMode = normalizedPointColorMode(mode);
        this.pointColorModeNode.value = POINT_COLOR_MODE_VALUES[
            this.pointColorMode
        ];
        return this.pointColorMode;
    }

    setClippingRange(nearFraction, farFraction) {
        const wasDefault = this.nearClipFraction <= 1e-9
            && this.farClipFraction >= 1 - 1e-9;
        const range = clippedDepthRange(
            {near: 0, far: 1}, nearFraction, farFraction
        );
        this.nearClipFraction = range.near;
        this.farClipFraction = range.far;
        this.gaussianRenderer?.setClippingRange(range.near, range.far);
        const isDefault = this.nearClipFraction <= 1e-9
            && this.farClipFraction >= 1 - 1e-9;
        if (wasDefault && !isDefault) {
            this.clippingReferenceKey = this.activeKey;
        } else if (isDefault) {
            this.clippingReferenceKey = null;
        }
        return {
            near: this.nearClipFraction,
            far: this.farClipFraction,
        };
    }

    // Retain the desired filter independently of the disposable PlayCanvas
    // engine so recreating that engine cannot reset the visible UI state.
    setGaussianSplatFilter(options) {
        this.gaussianSplatFilter = gaussianSplatFilter(
            this.gaussianSplatFilter, options
        );
        this.gaussianRenderer?.setSplatFilter(this.gaussianSplatFilter);
        return {...this.gaussianSplatFilter};
    }

    getGaussianSplatFilter() {
        return {...this.gaussianSplatFilter};
    }

    updateMeshMaterial() {
        for (const [, entry] of this.geometries) {
            if (entry.kind !== "triangle mesh" || !entry.object) {
                continue;
            }
            const meshes = [];
            const previousMaterials = new Set();
            entry.object.traverse(node => {
                if (node.isMesh && node.geometry) {
                    meshes.push(node);
                    if (node.material) {
                        previousMaterials.add(node.material);
                    }
                }
            });
            if (!meshes.length) {
                continue;
            }
            const hasVertexColors = meshes.some(
                mesh => Boolean(mesh.geometry.getAttribute("color"))
            );
            const material = this.createMeshMaterial(hasVertexColors);
            meshes.forEach(mesh => {
                mesh.material = material;
            });
            previousMaterials.forEach(previous => previous.dispose());
        }
    }

    setMeshShading(value) {
        this.meshShading = meshShading(value);
        this.updateMeshMaterial();
    }

    setMeshColor(value) {
        this.meshColor = meshColor(value);
        this.updateMeshMaterial();
    }

    setMeshBrightness(value) {
        this.meshBrightness = meshBrightness(value);
        this.meshBrightnessNode.value = this.meshBrightness;
        return this.meshBrightness;
    }

    renderWithGeometry(key, image, width, height, region = null) {
        return this.renderGeometry(key, image, width, height, region);
    }

    captureGeometryFrame(
        key, image, width, height, region = null, clipFrame = false
    ) {
        return this.runGpuOperation(() => this._captureGeometryFrame(
            key, image, width, height, region, clipFrame
        ));
    }

    async _captureGeometryFrame(
        key, image, width, height, region, clipFrame
    ) {
        const entry = this.geometries.get(key);
        if (!entry) {
            return null;
        }
        if (entry.engine === "playcanvas") {
            this.activateGeometry(key);
            const clippingPlanes = this.clippingPlanesForImage(image);
            // Keep this source active until the caller copies the ImageBitmap.
            // Re-activating the previous Gaussian here can update shared
            // PlayCanvas renderer state before the next queued render.
            return await this.gaussianRenderer.captureFrame(
                entry.adapterKey, image, width, height, region, clipFrame,
                clippingPlanes
            );
        }
        const previousKey = this.activeKey;
        this.activateGeometry(key);
        try {
            await this.ready;
            this.configureCamera(image, region);
            this.cullMeshChunks();
            if (!this._captureTarget
                    || this._captureTarget.width !== width
                    || this._captureTarget.height !== height) {
                if (this._captureTarget) {
                    this._captureTarget.dispose();
                }
                this._captureTarget = new THREE.RenderTarget(width, height);
                forceFloatDepthTarget(this._captureTarget);
            }
            const previousRenderTarget = this.renderer.getRenderTarget();
            const previousOutputTarget = this.renderer.getOutputRenderTarget();
            let buffer;
            try {
                // A normal canvas render applies the renderer's sRGB output
                // conversion. Mark the capture target as output too so its
                // bytes have identical color and shading when shown as an image.
                this.renderer.setOutputRenderTarget(this._captureTarget);
                this.renderer.setRenderTarget(this._captureTarget);
                this.configureFrameScissor(
                    image, width, height, region, clipFrame, this._captureTarget
                );
                this.renderer.render(this.scene, this.camera);
                buffer = await this.renderer.readRenderTargetPixelsAsync(
                    this._captureTarget, 0, 0, width, height
                );
            } finally {
                this.renderer.setScissorTest(false);
                this._captureTarget.scissorTest = false;
                this.renderer.setRenderTarget(previousRenderTarget);
                this.renderer.setOutputRenderTarget(previousOutputTarget);
            }
            const src = new Uint8ClampedArray(buffer.buffer);
            const flipped = new Uint8ClampedArray(src.length);
            const rowSize = width * 4;
            for (let y = 0; y < height; y++) {
                const srcOffset = (height - 1 - y) * rowSize;
                const dstOffset = y * rowSize;
                flipped.set(src.subarray(srcOffset, srcOffset + rowSize),
                    dstOffset);
            }
            const imageData = new ImageData(flipped, width, height);
            if (!this._captureCanvas) {
                this._captureCanvas = document.createElement("canvas");
                this._captureCtx = this._captureCanvas.getContext("2d",
                    {alpha: true});
            }
            this._captureCanvas.width = width;
            this._captureCanvas.height = height;
            this._captureCtx.putImageData(imageData, 0, 0);
            return createImageBitmap(this._captureCanvas);
        } finally {
            if (previousKey !== key && this.geometries.has(previousKey)) {
                this.activateGeometry(previousKey);
            }
        }
    }

    disposeGeometry(key = undefined) {
        return this.runGpuOperation(() => this._disposeGeometry(key));
    }

    _releaseGaussianRendererIfUnused() {
        if (!this.gaussianRenderer || [...this.geometries.values()].some(
            entry => entry.engine === "playcanvas"
        )) {
            return;
        }
        this.gaussianRenderer.destroy();
        this.gaussianRenderer = null;
        this.gaussianRendererPromise = null;
    }

    _disposeGeometry(key) {
        if (key === undefined) {
            for (const [, entry] of this.geometries) {
                if (entry.engine === "playcanvas") {
                    this.gaussianRenderer.dispose(entry.adapterKey);
                } else {
                    this.scene.remove(entry.object);
                    disposeObject(entry.object);
                }
            }
            this.geometries.clear();
            this.object = null;
            this.kind = null;
            this.activeKey = null;
            this._releaseGaussianRendererIfUnused();
            return;
        }
        const entry = this.geometries.get(key);
        if (!entry) {
            return;
        }
        const keys = entry.linkedKeys || [key];
        const activeRemoved = keys.includes(this.activeKey);
        for (const linkedKey of keys) {
            const linked = this.geometries.get(linkedKey);
            if (!linked) {
                continue;
            }
            if (linked.engine === "playcanvas") {
                this.gaussianRenderer.dispose(linked.adapterKey);
            } else {
                this.scene.remove(linked.object);
                disposeObject(linked.object);
            }
            this.geometries.delete(linkedKey);
        }
        this._releaseGaussianRendererIfUnused();
        if (activeRemoved) {
            const remaining = [...this.geometries.keys()];
            if (remaining.length) {
                this.activateGeometry(remaining[remaining.length - 1]);
            } else {
                this.object = null;
                this.kind = null;
                this.activeKey = null;
            }
        }
    }
}

export {
    clippedDepthRange,
    depthRangesForClipping,
    depthRangeForSphere,
    detectPlyKind,
    imageFrameScissor,
    isPinholeCamera,
    projectionFrustum,
    relativeViewTransform,
    screenRenderSize,
    threeViewRows,
    zoomDetailMaxSize,
    zoomViewRegion,
};
