import {
    Application,
    Asset,
    Color,
    DEVICETYPE_WEBGL2,
    DEVICETYPE_WEBGPU,
    Entity,
    FILLMODE_NONE,
    GSPLAT_RENDERER_RASTER_GPU_SORT,
    Mat4,
    Quat,
    RESOLUTION_FIXED,
    SHADERLANGUAGE_GLSL,
    SHADERLANGUAGE_WGSL,
    ShaderChunks,
    Vec3,
    Vec4,
    createGraphicsDevice,
} from "playcanvas";
import {
    clippedDepthRange,
    depthRangeForSphere,
    imageFrameScissor,
    isPinholeCamera,
    projectionFrustum,
    threeViewRows,
} from "./gpu_camera.mjs";
import {
    DEFAULT_GAUSSIAN_SPLAT_FILTER,
    DEFAULT_SPLAT_KERNEL_SIZE,
    gaussianSplatFilter,
} from "./gpu_gaussian_filter.mjs";

export {DEFAULT_SPLAT_KERNEL_SIZE};

// PlayCanvas hardcodes the dilation (`+ 0.3`) as a literal in its gsplatCornerVS
// chunk, so there is no runtime kernel-size knob. We rewrite the engine's own
// default chunk, promoting that literal to a `kernelSize` uniform, and register
// the patched source as a material chunk override. Transforming the shipped
// chunk (instead of hand-copying it) keeps us resilient to unrelated upstream
// edits across engine versions.
const KERNEL_PATCH = {
    [SHADERLANGUAGE_GLSL]: {
        declaration: "uniform float kernelSize;\n",
        replacement: "+ kernelSize",
    },
    [SHADERLANGUAGE_WGSL]: {
        declaration: "uniform kernelSize: f32;\n",
        replacement: "+ uniform.kernelSize",
    },
};
const DILATION_LITERAL = /\+\s*0\.3(?![0-9])/g;

export function playCanvasProjectionData(frustum) {
    const {left, right, top, bottom, near, far} = frustum;
    return [
        2 * near / (right - left), 0, 0, 0,
        0, 2 * near / (top - bottom), 0, 0,
        (right + left) / (right - left),
        (top + bottom) / (top - bottom),
        -(far + near) / (far - near), -1,
        0, 0, -2 * far * near / (far - near), 0,
    ];
}

export function playCanvasCameraWorldData(camFromWorld) {
    const rows = threeViewRows(camFromWorld);
    const view = new Mat4().set([
        rows[0][0], rows[1][0], rows[2][0], rows[3][0],
        rows[0][1], rows[1][1], rows[2][1], rows[3][1],
        rows[0][2], rows[1][2], rows[2][2], rows[3][2],
        rows[0][3], rows[1][3], rows[2][3], rows[3][3],
    ]);
    return Array.from(view.invert().data);
}

export function shouldReorderGaussianData(device) {
    return !device.isWebGPU;
}

const SH_C0 = 0.28209479177387814;

function displayColorByte(value) {
    return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

export function gaussianPointCloudData(resource) {
    const positions = resource?.centers;
    const data = resource?.gsplatData;
    const count = Number(resource?.numSplats) || 0;
    if (!(positions instanceof Float32Array)
            || positions.length !== count * 3 || !data) {
        return null;
    }
    const colors = new Uint8Array(count * 3);
    const red = data.getProp?.("f_dc_0");
    const green = data.getProp?.("f_dc_1");
    const blue = data.getProp?.("f_dc_2");
    if (red && green && blue) {
        for (let index = 0; index < count; index += 1) {
            colors[index * 3] = displayColorByte(0.5 + red[index] * SH_C0);
            colors[index * 3 + 1] = displayColorByte(
                0.5 + green[index] * SH_C0
            );
            colors[index * 3 + 2] = displayColorByte(
                0.5 + blue[index] * SH_C0
            );
        }
    } else {
        const color = new Vec4();
        const iterator = data.createIter?.(null, null, null, color);
        if (!iterator) {
            return null;
        }
        for (let index = 0; index < count; index += 1) {
            iterator.read(index);
            colors[index * 3] = displayColorByte(color.x);
            colors[index * 3 + 1] = displayColorByte(color.y);
            colors[index * 3 + 2] = displayColorByte(color.z);
        }
    }
    return {positions, colors};
}

function loadAsset(app, url, filename) {
    return new Promise((resolve, reject) => {
        // The WebGPU raster renderer depth-sorts every complete splat set on
        // the GPU, so PlayCanvas's additional load-time Morton permutation
        // does not affect draw order. Avoid that expensive main-thread pass.
        // Keep it for WebGL2, whose CPU-sort path can benefit from the locality.
        const reorder = shouldReorderGaussianData(app.graphicsDevice);
        const asset = new Asset(filename, "gsplat", {
            url,
            filename,
        }, {reorder});
        asset.once("load", () => resolve(asset));
        asset.once("error", error => {
            app.assets.remove(asset);
            reject(new Error(`Unable to load Gaussian PLY: ${error}`));
        });
        app.assets.add(asset);
        app.assets.load(asset);
    });
}

export class PlayCanvasGaussianRenderer {
    constructor(canvas) {
        if (!canvas) {
            throw new Error("A dedicated PlayCanvas canvas is required");
        }
        this.canvas = canvas;
        this.app = null;
        this.cameraEntity = null;
        this.entries = new Map();
        this.activeKey = null;
        this.nextKey = 0;
        this.nearClipFraction = 0;
        this.farClipFraction = 1;
        this.projection = new Mat4();
        // Default to the original 3DGS formula (no Mip-Splatting opacity
        // compensation, 0.3 dilation). Callers opt into Mip-Splatting AA.
        this.splatFilter = {...DEFAULT_GAUSSIAN_SPLAT_FILTER};
        this.kernelUniformSupported = false;
        this.destroyed = false;
        this.ready = this.initialize();
    }

    async initialize() {
        let graphicsDevice = null;
        try {
            graphicsDevice = await createGraphicsDevice(this.canvas, {
                deviceTypes: [DEVICETYPE_WEBGPU, DEVICETYPE_WEBGL2],
                alpha: true,
                // Gaussian filtering is performed analytically in the splat
                // shader; multisampling only increases its fragment cost.
                antialias: false,
                preserveDrawingBuffer: true,
            });
            if (this.destroyed) {
                graphicsDevice.destroy();
                throw new Error("PlayCanvas initialization was cancelled");
            }
            this.app = new Application(this.canvas, {graphicsDevice});
            this.app.setCanvasFillMode(FILLMODE_NONE);
            this.app.setCanvasResolution(RESOLUTION_FIXED, 1, 1);
            this.app.autoRender = false;
            if (graphicsDevice.isWebGPU) {
                this.app.scene.gsplat.renderer = GSPLAT_RENDERER_RASTER_GPU_SORT;
            }
            this._installKernelSizeChunks(graphicsDevice);
            this._applySplatFilter();

            this.cameraEntity = new Entity("COLMAP camera");
            this.cameraEntity.addComponent("camera", {
                clearColor: new Color(0, 0, 0, 0),
                clearColorBuffer: true,
                clearDepthBuffer: true,
            });
            this.cameraEntity.camera.calculateProjection = output => {
                output.copy(this.projection);
            };
            this.app.root.addChild(this.cameraEntity);
            this.app.systems.gsplat.on("frame:request", () => {
                this.app.renderNextFrame = true;
            });
            this.app.start();
        } catch (error) {
            if (this.app) {
                this.app.destroy();
                this.app = null;
            } else if (graphicsDevice && !this.destroyed) {
                graphicsDevice.destroy();
            }
            this.cameraEntity = null;
            throw error;
        }
    }

    _installKernelSizeChunks(device) {
        const material = this.app.scene.gsplat.material;
        for (const language of [SHADERLANGUAGE_GLSL, SHADERLANGUAGE_WGSL]) {
            const patch = KERNEL_PATCH[language];
            let source;
            try {
                source = ShaderChunks.get(device, language)?.get("gsplatCornerVS");
            } catch (error) {
                source = null;
            }
            if (typeof source !== "string" || !DILATION_LITERAL.test(source)) {
                continue;
            }
            DILATION_LITERAL.lastIndex = 0;
            const patched = patch.declaration
                + source.replace(DILATION_LITERAL, patch.replacement);
            material.getShaderChunks(language).set("gsplatCornerVS", patched);
            this.kernelUniformSupported = true;
        }
        material.update();
    }

    _applySplatFilter() {
        if (!this.app) {
            return;
        }
        const params = this.app.scene.gsplat;
        params.antiAlias = this.splatFilter.antiAlias;
        if (this.kernelUniformSupported) {
            params.material.setParameter("kernelSize", this.splatFilter.kernelSize);
        }
        params.material.update();
        this.app.renderNextFrame = true;
    }

    // antiAlias toggles Mip-Splatting opacity compensation; kernelSize sets the
    // screen-space dilation (0.3 = 3DGS/PlayCanvas default, 0.1 = Mip-Splatting).
    setSplatFilter(options = {}) {
        this.splatFilter = gaussianSplatFilter(this.splatFilter, options);
        this._applySplatFilter();
        return {...this.splatFilter};
    }

    async loadUrl(url, filename = "geometry.ply", isCurrent = () => true) {
        return this._load(url, filename, null, isCurrent);
    }

    async loadFile(file, isCurrent = () => true) {
        const objectUrl = URL.createObjectURL(file);
        return this._load(objectUrl, file.name || "geometry.ply", objectUrl, isCurrent);
    }

    async loadArrayBuffer(bytes, isCurrent = () => true) {
        const objectUrl = URL.createObjectURL(new Blob([bytes]));
        return this._load(objectUrl, "geometry.ply", objectUrl, isCurrent);
    }

    async _load(url, filename, objectUrl, isCurrent) {
        await this.ready;
        let asset;
        try {
            asset = await loadAsset(this.app, url, filename);
        } finally {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        }
        if (!isCurrent()) {
            asset.unload();
            this.app.assets.remove(asset);
            return null;
        }
        const entity = new Entity(filename);
        entity.enabled = false;
        entity.addComponent("gsplat", {asset});
        this.app.root.addChild(entity);
        const key = String(this.nextKey++);
        const aabb = asset.resource?.aabb;
        const radius = aabb ? Math.hypot(
            aabb.halfExtents.x, aabb.halfExtents.y, aabb.halfExtents.z
        ) : 1;
        this.entries.set(key, {
            asset,
            entity,
            count: Number(asset.resource?.numSplats) || 0,
            sphere: {
                center: aabb
                    ? [aabb.center.x, aabb.center.y, aabb.center.z]
                    : [0, 0, 0],
                radius,
            },
        });
        this.activate(key);
        return {key, count: Number(asset.resource?.numSplats) || 0};
    }

    activate(key) {
        for (const [entryKey, entry] of this.entries) {
            entry.entity.enabled = entryKey === key;
        }
        this.activeKey = this.entries.has(key) ? key : null;
        this.app.renderNextFrame = true;
    }

    setClippingRange(nearFraction, farFraction) {
        const clipped = clippedDepthRange(
            {near: 0, far: 1}, nearFraction, farFraction
        );
        this.nearClipFraction = clipped.near;
        this.farClipFraction = clipped.far;
    }

    depthRange(key, viewRows) {
        const entry = this.entries.get(key);
        if (!entry) {
            return {near: 1e-4, far: 1e7};
        }
        const [x, y, z] = entry.sphere.center;
        const cameraZ = viewRows[2][0] * x + viewRows[2][1] * y
            + viewRows[2][2] * z + viewRows[2][3];
        return depthRangeForSphere(-cameraZ, entry.sphere.radius, false);
    }

    getSphere(key) {
        return this.entries.get(key)?.sphere || null;
    }

    getPointCloudData(key) {
        return gaussianPointCloudData(
            this.entries.get(key)?.asset?.resource
        );
    }

    configureCamera(image, region = null, clippingPlanes = null) {
        if (!isPinholeCamera(image)) {
            throw new Error(
                `PlayCanvas Gaussian rendering requires a PINHOLE camera, got ${image.camera.model}`
            );
        }
        const viewRows = threeViewRows(image.cam_from_world);
        const depth = clippingPlanes || clippedDepthRange(
            this.depthRange(this.activeKey, viewRows),
            this.nearClipFraction,
            this.farClipFraction
        );
        const frustum = projectionFrustum(image, depth.near, depth.far, region);
        this.projection.set(playCanvasProjectionData(frustum));
        const world = new Mat4().set(
            playCanvasCameraWorldData(image.cam_from_world)
        );
        this.cameraEntity.setPositionAndRotation(
            world.getTranslation(new Vec3()),
            new Quat().setFromMat4(world)
        );
        this.cameraEntity.camera.nearClip = frustum.near;
        this.cameraEntity.camera.farClip = frustum.far;
    }

    async render(
        key, image, width, height, region = null, clipFrame = false,
        clippingPlanes = null
    ) {
        await this.ready;
        this.activate(key);
        this.configureCamera(image, region, clippingPlanes);
        this.app.setCanvasResolution(RESOLUTION_FIXED, width, height);
        if (clipFrame) {
            const clip = imageFrameScissor(image, width, height, region);
            this.cameraEntity.camera.scissorRect = new Vec4(
                clip.x / width,
                1 - (clip.y + clip.height) / height,
                clip.width / width,
                clip.height / height
            );
        } else {
            this.cameraEntity.camera.scissorRect = new Vec4(0, 0, 1, 1);
        }
        await new Promise(resolve => {
            this.app.once("postrender", resolve);
            this.app.renderNextFrame = true;
        });
        // Application.postrender fires before the WebGPU queue is guaranteed
        // to have finished a large GPU splat sort and its raster pass. Do not
        // let the DOM compositor expose this canvas while its clear frame can
        // still precede the completed Gaussian frame.
        const gpuQueue = this.app.graphicsDevice?.wgpu?.queue;
        if (gpuQueue?.onSubmittedWorkDone) {
            await gpuQueue.onSubmittedWorkDone();
        } else {
            // WebGL has no promise-based queue fence. finish() is used only at
            // source-switch/render completion, not on an animation loop.
            this.app.graphicsDevice?.gl?.finish?.();
        }
    }

    async captureFrame(
        key, image, width, height, region = null, clipFrame = false,
        clippingPlanes = null
    ) {
        await this.render(
            key, image, width, height, region, clipFrame, clippingPlanes
        );
        return createImageBitmap(this.canvas);
    }

    dispose(key = undefined) {
        const keys = key === undefined ? [...this.entries.keys()] : [key];
        for (const entryKey of keys) {
            const entry = this.entries.get(entryKey);
            if (!entry) {
                continue;
            }
            entry.entity.destroy();
            entry.asset.unload();
            this.app.assets.remove(entry.asset);
            this.entries.delete(entryKey);
        }
        if (!this.entries.has(this.activeKey)) {
            this.activeKey = null;
        }
        if (this.app) {
            this.app.renderNextFrame = true;
        }
    }

    destroy() {
        this.destroyed = true;
        this.dispose();
        if (this.app) {
            this.app.destroy();
            this.app = null;
        }
        this.cameraEntity = null;
    }
}
