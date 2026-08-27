import * as THREE from "three/webgpu";
import {GaussianSplatPLYLoader} from "three/addons/loaders/GaussianSplatPLYLoader.js";
import {PLYLoader} from "three/addons/loaders/PLYLoader.js";
import {GaussianSplat} from "three/addons/objects/GaussianSplat.js";
import {
    Fn,
    normalView,
    sRGBTransferEOTF,
    uniform,
    vec3,
    vec4,
    vertexColor,
    viewportUV,
} from "three/tsl";

import {
    depthRangeForSphere,
    detectPlyKind,
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
import {parseMeshChunk} from "./gpu_mesh_chunk.mjs";

function disposeObject(object) {
    if (!object) {
        return;
    }
    const geometries = new Set();
    const materials = new Set();
    object.traverse(node => {
        if (node.geometry) {
            geometries.add(node.geometry);
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

function useDisplayEncodedGaussianColors(object) {
    const material = object?.material;
    const gaussianFragment = material?.colorNode;
    if (!gaussianFragment) {
        return;
    }
    // GraphDECO-style training and reference renderers operate directly on
    // numeric image RGB even though those values conventionally originate in
    // sRGB images. Three's Gaussian material treats the SH result as physical
    // linear light, so its output pass brightens it a second time. Evaluate
    // all SH bands first, then decode once so the final output encode restores
    // the original/reference RGB numbers.
    material.colorNode = Fn(() => {
        const splat = vec4(gaussianFragment).toVar("displayEncodedSplat");
        return vec4(sRGBTransferEOTF(splat.rgb), splat.a);
    })();
    material.needsUpdate = true;
}

export class ReprojectionGpuRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = new THREE.Scene();
        // Match MeshLab's viewport gradient in screen space. viewportUV uses
        // WebGPU coordinates, whose y axis runs from top (0) to bottom (1).
        this.backgroundTopNode = uniform(new THREE.Color(0xffffff));
        this.backgroundBottomNode = uniform(new THREE.Color(0x747474));
        this.scene.backgroundNode = viewportUV.y.mix(
            this.backgroundTopNode, this.backgroundBottomNode
        );
        this.camera = new THREE.PerspectiveCamera();
        this.camera.matrixAutoUpdate = false;
        this.camera.matrixWorldAutoUpdate = false;
        this.meshFrustum = new THREE.Frustum();
        this.projectionViewMatrix = new THREE.Matrix4();
        this.chunkWorldBounds = new THREE.Box3();
        this.object = null;
        this.kind = null;
        this.meshShading = DEFAULT_MESH_SHADING;
        this.meshColor = DEFAULT_MESH_COLOR;
        this.meshBrightness = DEFAULT_MESH_BRIGHTNESS;
        this.meshBrightnessNode = uniform(this.meshBrightness);
        this.renderer = new THREE.WebGPURenderer({
            canvas,
            antialias: true,
            reversedDepthBuffer: true,
            // The viewer displays ordinary 8-bit imagery. Avoid a half-float
            // color target whose memory cost becomes excessive when zoom
            // detail raises the canvas backing resolution.
            outputBufferType: THREE.UnsignedByteType,
        });
        this.ready = this.renderer.init();
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
        const material = new THREE.MeshBasicNodeMaterial({
            ...options,
            flatShading: description.flatShading,
        });
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

    async loadUrl(url, fileSize, isCurrent = () => true) {
        await this.ready;
        const response = await fetch(url, {cache: "no-store"});
        if (!response.ok) {
            throw new Error(`Unable to read configured geometry: HTTP ${response.status}`);
        }
        let bytes;
        try {
            bytes = await response.arrayBuffer();
        } catch (error) {
            const message = `The browser could not buffer ${formatFileSize(fileSize)} `
                + "of configured geometry. Simplify or partition the file.";
            throw new Error(message, {cause: error});
        }
        const header = new TextDecoder().decode(bytes.slice(0, 1024 * 1024));
        const kind = ReprojectionGpuRenderer.inspectHeader(header);
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
        const group = new THREE.Group();
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
                await this.renderer.compileAsync(mesh, this.camera, this.scene);
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
                    cache: "no-store",
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new Error(
                        `Unable to stream mesh chunk ${chunkIndex + 1}: `
                        + `HTTP ${response.status}`
                    );
                }
                const geometry = ReprojectionGpuRenderer.parseMeshChunk(
                    await response.arrayBuffer()
                );
                const mesh = new THREE.Mesh(geometry, material);
                // Manual chunk AABB culling is applied before real renders.
                // Disable the default sphere test here so compileAsync always
                // uploads the chunk, regardless of the preparation camera.
                mesh.frustumCulled = false;
                chunks[chunkIndex] = mesh;
                queueGpuPreparation(mesh);
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
        const bounds = new THREE.Box3();
        chunks.forEach(chunk => bounds.union(chunk.geometry.boundingBox));
        group.userData.boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
        this.installObject(group, "triangle mesh");
        return {
            kind: "triangle mesh",
            count: manifest.vertex_count,
        };
    }

    static parseMeshChunk(bytes) {
        const chunk = parseMeshChunk(bytes);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(
            chunk.positions, 3
        ));
        geometry.setAttribute("color", new THREE.BufferAttribute(
            chunk.colors, 3, true
        ));
        geometry.setIndex(new THREE.BufferAttribute(
            chunk.indices, 1
        ));
        geometry.computeBoundingBox();
        return geometry;
    }

    loadArrayBuffer(bytes, kind, isCurrent = () => true) {
        let geometry;
        let object;
        if (kind === "gaussian splats") {
            geometry = new GaussianSplatPLYLoader().parse(bytes);
            object = new GaussianSplat(geometry);
            useDisplayEncodedGaussianColors(object);
        } else {
            geometry = new PLYLoader().parse(bytes);
            normalizeGeometryAttributesForGpu(geometry);
            if (kind === "triangle mesh") {
                // Remove any PLY vertex normals so normalView is computed from
                // position derivatives, giving true per-face flat shading.
                geometry.deleteAttribute("normal");
                object = new THREE.Mesh(
                    geometry,
                    this.createMeshMaterial(Boolean(geometry.getAttribute("color")))
                );
            } else {
                object = new THREE.Points(
                    geometry,
                    new THREE.PointsMaterial({
                        color: geometry.getAttribute("color") ? 0xffffff : 0xb0b0b0,
                        vertexColors: Boolean(geometry.getAttribute("color")),
                        size: 1,
                        sizeAttenuation: false,
                    })
                );
            }
        }
        geometry.computeBoundingSphere();
        if (!isCurrent()) {
            disposeObject(object);
            return null;
        }
        this.installObject(object, kind);
        return {
            kind,
            count: geometry.getAttribute("position")?.count || 0,
        };
    }

    installObject(object, kind) {
        const previous = this.object;
        this.scene.add(object);
        this.object = object;
        this.kind = kind;
        if (previous) {
            this.scene.remove(previous);
            disposeObject(previous);
        }
    }

    supportsCamera(image) {
        return isPinholeCamera(image);
    }

    configureCamera(image, region = null) {
        const rows = threeViewRows(image.cam_from_world);
        this.camera.matrixWorldInverse.set(...rows.flat());
        this.camera.matrixWorld.copy(this.camera.matrixWorldInverse).invert();
        this.camera.matrix.copy(this.camera.matrixWorld);

        let near = 1e-4;
        let far = 1e7;
        const sourceGeometry = this.object?.splatGeometry || this.object?.geometry;
        const sphere = this.object?.userData?.boundingSphere
            || sourceGeometry?.boundingSphere;
        if (sphere) {
            const center = sphere.center.clone().applyMatrix4(this.camera.matrixWorldInverse);
            const radius = Math.max(sphere.radius, 1e-6);
            const distance = -center.z;
            ({near, far} = depthRangeForSphere(
                distance, radius, this.renderer.reversedDepthBuffer
            ));
        }
        this.camera._reversedDepth = Boolean(this.renderer.reversedDepthBuffer);
        const frustum = projectionFrustum(image, near, far, region);
        this.camera.near = frustum.near;
        this.camera.far = frustum.far;
        this.camera.coordinateSystem = this.renderer.coordinateSystem;
        this.camera.projectionMatrix.makePerspective(
            frustum.left, frustum.right, frustum.top, frustum.bottom,
            frustum.near, frustum.far, this.camera.coordinateSystem,
            this.camera.reversedDepth
        );
        this.camera.projectionMatrixInverse.copy(
            this.camera.projectionMatrix
        ).invert();

    }

    cullMeshChunks() {
        if (this.kind !== "triangle mesh" || !this.object) {
            return;
        }
        this.object.updateMatrixWorld(true);
        this.projectionViewMatrix.multiplyMatrices(
            this.camera.projectionMatrix, this.camera.matrixWorldInverse
        );
        this.meshFrustum.setFromProjectionMatrix(
            this.projectionViewMatrix,
            this.camera.coordinateSystem,
            this.camera.reversedDepth
        );
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

    async render(image, width, height, region = null) {
        if (!this.object) {
            return;
        }
        if (!this.supportsCamera(image)) {
            throw new Error(
                `True GPU rendering is not yet calibrated for ${image.camera.model}`
            );
        }
        await this.ready;
        this.configureCamera(image, region);
        this.cullMeshChunks();
        this.renderer.setSize(width, height, false);
        this.renderer.render(this.scene, this.camera);
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
        if (this.kind === "point cloud" && this.object?.material) {
            this.object.material.size = Number(size);
            this.object.material.needsUpdate = true;
        }
    }

    setBackgroundColors(top, bottom) {
        this.backgroundTopNode.value.set(top);
        this.backgroundBottomNode.value.set(bottom);
    }

    updateMeshMaterial() {
        if (this.kind !== "triangle mesh" || !this.object) {
            return;
        }
        const meshes = [];
        const previousMaterials = new Set();
        this.object.traverse(node => {
            if (node.isMesh && node.geometry) {
                meshes.push(node);
                if (node.material) {
                    previousMaterials.add(node.material);
                }
            }
        });
        if (!meshes.length) {
            return;
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

    disposeGeometry() {
        if (!this.object) {
            return;
        }
        this.scene.remove(this.object);
        disposeObject(this.object);
        this.object = null;
        this.kind = null;
    }
}

export {
    depthRangeForSphere,
    detectPlyKind,
    isPinholeCamera,
    projectionFrustum,
    relativeViewTransform,
    screenRenderSize,
    threeViewRows,
    zoomDetailMaxSize,
    zoomViewRegion,
};
