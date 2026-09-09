import assert from "node:assert/strict";
import {
    BufferGeometry,
    Float32BufferAttribute,
    Scene,
    Uint8BufferAttribute,
} from "three/webgpu";
import {uniform} from "three/tsl";

import {
    ReprojectionGpuRenderer,
} from "../../static/js/reprojection/gpu_renderer.js";
import {
    DEFAULT_GAUSSIAN_SPLAT_FILTER,
} from "../../static/js/reprojection/gpu_gaussian_filter.mjs";

function rendererHarness() {
    const renderer = Object.create(ReprojectionGpuRenderer.prototype);
    renderer.gaussianCanvas = {};
    renderer.gaussianRenderer = null;
    renderer.gaussianRendererPromise = null;
    renderer.geometries = new Map();
    renderer.gaussianSplatFilter = {...DEFAULT_GAUSSIAN_SPLAT_FILTER};
    renderer.nearClipFraction = 0;
    renderer.farClipFraction = 1;
    return renderer;
}

{
    const renderer = rendererHarness();
    renderer._nextId = 0;
    renderer.scene = new Scene();
    renderer.activeKey = null;
    renderer.object = null;
    renderer.kind = null;
    renderer.pointSizeNode = uniform(1);
    renderer.pointColorModeNode = uniform(0);
    renderer.pointDepthNearNode = uniform(0);
    renderer.pointDepthFarNode = uniform(1);
    const activations = [];
    const disposals = [];
    let destroyed = false;
    renderer.gaussianRenderer = {
        activate: key => activations.push(key),
        dispose: key => disposals.push(key),
        destroy: () => { destroyed = true; },
    };

    const gaussianPointPositions = new Float32Array([
        0, 0, 1, 1, 0, 1,
    ]);
    const installed = renderer.installGaussian({
        key: "adapter-key",
        count: 2,
        pointCloud: {
            positions: gaussianPointPositions,
            colors: new Uint8Array([255, 0, 0, 0, 255, 0]),
        },
    });
    assert.equal(installed.key, "0");
    assert.deepEqual(installed.representations.map(item => ({
        key: item.key,
        kind: item.kind,
        hiddenByDefault: Boolean(item.hiddenByDefault),
    })), [
        {key: "0", kind: "gaussian splats", hiddenByDefault: false},
        {key: "1", kind: "point cloud", hiddenByDefault: true},
    ]);
    assert.equal(renderer.geometries.get("0").engine, "playcanvas");
    assert.equal(renderer.geometries.get("1").engine, "three");
    const installedPointGeometry = renderer.geometries.get("1")
        .object.userData.pointGeometry;
    assert.equal(
        installedPointGeometry.getAttribute("position").array,
        gaussianPointPositions
    );
    assert.equal(
        renderer.geometries.get("1").object.material.positionNode.value.array,
        gaussianPointPositions
    );
    assert.equal(installedPointGeometry.userData.vertexColorsAreSrgb, true);
    assert.deepEqual(activations, ["adapter-key"]);

    renderer._disposeGeometry("1");
    assert.equal(renderer.geometries.size, 0);
    assert.deepEqual(disposals, ["adapter-key"]);
    assert.equal(destroyed, true);
}

{
    const renderer = rendererHarness();
    renderer.pointSize = 3;
    renderer.pointSizeNode = uniform(renderer.pointSize);
    renderer.pointPixelScaleNode = uniform(1);
    renderer.pointColorMode = "rgb";
    renderer.pointColorModeNode = uniform(0);
    renderer.pointDepthNearNode = uniform(0);
    renderer.pointDepthFarNode = uniform(1);
    const geometry = new BufferGeometry();
    const positions = new Float32BufferAttribute([
        0, 0, 1,
        1, 0, 1,
    ], 3);
    const colors = new Uint8BufferAttribute([
        255, 0, 0,
        0, 255, 0,
    ], 3, true);
    geometry.setAttribute("position", positions);
    geometry.setAttribute("color", colors);
    geometry.computeBoundingSphere();

    const points = renderer.createPointCloudSprite(geometry);
    assert.equal(points.isSprite, true);
    assert.equal(points.count, 2);
    assert.equal(points.frustumCulled, false);
    assert.equal(points.userData.pointGeometry, geometry);
    assert.notEqual(points.userData.boundingSphere, geometry.boundingSphere);
    assert.deepEqual(points.userData.boundingSphere, geometry.boundingSphere);
    assert.equal(points.material.isPointsNodeMaterial, true);
    const instancedPositions = points.material.positionNode.value;
    assert.equal(instancedPositions.isInstancedBufferAttribute, true);
    assert.equal(instancedPositions.array, positions.array);
    assert.ok(points.material.colorNode);
    assert.ok(points.material.maskNode);
    assert.ok(points.material.opacityNode);
    assert.ok(points.material.sizeNode);

    renderer.setPointSize(7);
    assert.equal(renderer.pointSize, 7);
    assert.equal(renderer.pointSizeNode.value, 7);
    renderer.setPointPixelScale(2);
    assert.equal(renderer.pointPixelScaleNode.value, 2);

    assert.equal(renderer.setPointColorMode("depth"), "depth");
    assert.equal(renderer.pointColorModeNode.value, 1);
    assert.equal(renderer.setPointColorMode("white"), "white");
    assert.equal(renderer.pointColorModeNode.value, 2);
    assert.equal(renderer.setPointColorMode("invalid"), "rgb");
    assert.equal(renderer.pointColorModeNode.value, 0);
}

{
    const renderer = rendererHarness();
    const activations = [];
    renderer.gaussianRenderer = {
        activate: key => activations.push(key),
    };
    renderer.activeKey = "gaussian";
    renderer.object = null;
    renderer.kind = "gaussian splats";
    renderer.geometries.set("gaussian", {
        engine: "playcanvas",
        adapterKey: "splat-adapter",
    });
    const meshObject = {visible: false};
    renderer.geometries.set("mesh", {
        engine: "three",
        object: meshObject,
        kind: "triangle mesh",
    });

    renderer.activateGeometry("mesh");
    assert.deepEqual(activations, []);
    assert.equal(meshObject.visible, true);
    assert.equal(renderer.activeKey, "mesh");

    renderer.activateGeometry(null);
    assert.deepEqual(activations, [null]);
}

{
    const renderer = rendererHarness();
    let resolveInitialization;
    const initialized = {destroy() {}};
    renderer._createGaussianRenderer = () => new Promise(resolve => {
        resolveInitialization = resolve;
    });

    const pending = renderer.ensureGaussianRenderer();
    assert.equal(renderer.gaussianRenderer, null);
    renderer._releaseGaussianRendererIfUnused();
    assert.equal(renderer.gaussianRenderer, null);

    resolveInitialization(initialized);
    assert.equal(await pending, initialized);
    assert.equal(renderer.gaussianRenderer, initialized);
}

{
    const renderer = rendererHarness();
    const initialized = {destroy() {}};
    let attempts = 0;
    renderer._createGaussianRenderer = async () => {
        attempts += 1;
        if (attempts === 1) {
            throw new Error("device unavailable");
        }
        return initialized;
    };

    await assert.rejects(renderer.ensureGaussianRenderer(), /device unavailable/);
    assert.equal(renderer.gaussianRenderer, null);
    assert.equal(renderer.gaussianRendererPromise, null);
    assert.equal(await renderer.ensureGaussianRenderer(), initialized);
    assert.equal(attempts, 2);
}

{
    const renderer = rendererHarness();
    let destroyed = 0;
    class FailingRenderer {
        constructor() {
            this.ready = Promise.reject(new Error("initialization failed"));
        }

        destroy() {
            destroyed += 1;
        }
    }
    renderer._loadGaussianRendererClass = async () => FailingRenderer;
    await assert.rejects(renderer._createGaussianRenderer(), /initialization failed/);
    assert.equal(destroyed, 1);
}

{
    const renderer = rendererHarness();
    const instances = [];
    class ReadyRenderer {
        constructor() {
            this.ready = Promise.resolve();
            this.destroyed = false;
            instances.push(this);
        }

        setClippingRange(near, far) {
            this.clipping = {near, far};
        }

        setSplatFilter(filter) {
            this.filter = {...filter};
        }

        destroy() {
            this.destroyed = true;
        }
    }
    renderer._loadGaussianRendererClass = async () => ReadyRenderer;
    renderer.setClippingRange(0.2, 0.8);
    renderer.setGaussianSplatFilter({antiAlias: true, kernelSize: 0.1});

    const first = await renderer.ensureGaussianRenderer();
    assert.deepEqual(first.clipping, {near: 0.2, far: 0.8});
    assert.deepEqual(first.filter, {antiAlias: true, kernelSize: 0.1});

    renderer._releaseGaussianRendererIfUnused();
    assert.equal(first.destroyed, true);
    const second = await renderer.ensureGaussianRenderer();
    assert.notEqual(second, first);
    assert.deepEqual(second.clipping, {near: 0.2, far: 0.8});
    assert.deepEqual(second.filter, {antiAlias: true, kernelSize: 0.1});
    assert.equal(instances.length, 2);
}

{
    const renderer = rendererHarness();
    renderer._operationQueue = Promise.resolve();
    renderer.activeKey = "mesh";
    renderer.geometries.set("mesh", {});
    let renders = 0;
    renderer.activateGeometry = () => {};
    renderer._render = async () => {
        renders += 1;
    };

    const rendered = await renderer.renderGeometry(
        "mesh", {}, 640, 480, null, false, () => false
    );
    assert.equal(rendered, false);
    assert.equal(renders, 0);
}

{
    const renderer = rendererHarness();
    renderer._operationQueue = Promise.resolve();
    renderer.activeKey = "mesh";
    renderer.geometries.set("mesh", {});
    renderer.geometries.set("gaussian", {});
    renderer.activateGeometry = key => {
        renderer.activeKey = key;
    };
    renderer._render = async () => {
        assert.equal(renderer.activeKey, "gaussian");
    };

    const rendered = await renderer.renderGeometry(
        "gaussian", {}, 640, 480
    );
    assert.equal(rendered, true);
    assert.equal(renderer.activeKey, "gaussian");
}

{
    const renderer = rendererHarness();
    renderer._operationQueue = Promise.resolve();
    renderer.activeKey = "mesh";
    renderer.geometries.set("mesh", {});
    renderer.geometries.set("gaussian", {});
    renderer.activateGeometry = key => {
        renderer.activeKey = key;
    };
    let finishRender;
    let markStarted;
    const started = new Promise(resolve => { markStarted = resolve; });
    renderer._render = () => new Promise(resolve => {
        finishRender = resolve;
        markStarted();
    });
    let current = true;

    const pending = renderer.renderGeometry(
        "gaussian", {}, 640, 480, null, false, () => current
    );
    await started;
    current = false;
    finishRender();
    assert.equal(await pending, false);
    assert.equal(renderer.activeKey, "mesh");
}

{
    const renderer = rendererHarness();
    renderer.ready = Promise.resolve();
    const loaded = {key: "adapter-key", count: 123};
    let requestedUrl = null;
    renderer.ensureGaussianRenderer = async () => ({
        async loadUrl(url) {
            requestedUrl = url;
            return loaded;
        },
    });
    renderer.installGaussian = result => ({installed: result});

    const result = await renderer.loadUrl(
        "/geometry", 999, () => true, "scene.ply", "gaussian splats"
    );
    assert.equal(requestedUrl, "/geometry");
    assert.deepEqual(result, {installed: loaded});
}

{
    const renderer = rendererHarness();
    renderer.activeKey = "left-gaussian";
    renderer.geometries.set("left-gaussian", {
        engine: "playcanvas",
        adapterKey: "left-adapter",
    });
    renderer.geometries.set("right-gaussian", {
        engine: "playcanvas",
        adapterKey: "right-adapter",
    });
    const activations = [];
    renderer.activateGeometry = key => {
        activations.push(key);
        renderer.activeKey = key;
    };
    renderer.clippingPlanesForImage = () => ({near: 1, far: 2});
    renderer.gaussianRenderer = {
        captureFrame: async key => ({captured: key}),
    };

    const frame = await renderer._captureGeometryFrame(
        "right-gaussian", {}, 640, 480, null, false
    );
    assert.deepEqual(frame, {captured: "right-adapter"});
    assert.deepEqual(activations, ["right-gaussian"]);
    assert.equal(
        renderer.activeKey,
        "right-gaussian",
        "the captured Gaussian must stay active until its bitmap is copied"
    );
}

console.log("GPU renderer lifecycle tests passed");
