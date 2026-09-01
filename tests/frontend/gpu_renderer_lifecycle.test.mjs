import assert from "node:assert/strict";

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

console.log("GPU renderer lifecycle tests passed");
