import assert from "node:assert/strict";

import {
    ReprojectionGpuRenderer,
} from "../../static/js/reprojection/gpu_renderer.js";

function streamedMeshHarness(intersections) {
    const coarseMesh = {visible: true};
    const fineMeshes = ["fine-0", "fine-1"].map(marker => ({
        visible: true,
        geometry: {boundingBox: {marker}},
        matrixWorld: {},
    }));
    const chunk = {
        matrixWorld: {},
        userData: {
            boundingBox: {marker: "chunk"},
            coarseMesh,
            fineMeshes,
        },
    };
    const renderer = Object.create(ReprojectionGpuRenderer.prototype);
    renderer.kind = "triangle mesh";
    renderer.object = {
        children: [chunk],
        userData: {streamedMesh: true},
        updateMatrixWorld() {},
    };
    renderer.camera = {
        coordinateSystem: 0,
        matrixWorldInverse: {},
        reversedDepth: false,
    };
    renderer.cullProjectionMatrix = {};
    renderer.projectionViewMatrix = {
        multiplyMatrices() {
            return this;
        },
    };
    renderer.meshFrustum = {
        setFromProjectionMatrix() {},
        intersectsBox(box) {
            return intersections[box.marker];
        },
    };
    renderer.chunkWorldBounds = {
        copy(box) {
            this.marker = box.marker;
            return this;
        },
        applyMatrix4() {
            return this;
        },
    };
    return {renderer, coarseMesh, fineMeshes};
}

{
    const {renderer, coarseMesh, fineMeshes} = streamedMeshHarness({
        chunk: false,
    });
    renderer.cullMeshChunks();
    assert.equal(coarseMesh.visible, false);
    assert.deepEqual(fineMeshes.map(mesh => mesh.visible), [false, false]);
}

{
    const {renderer, coarseMesh, fineMeshes} = streamedMeshHarness({
        chunk: true,
        "fine-0": true,
        "fine-1": true,
    });
    renderer.cullMeshChunks();
    assert.equal(coarseMesh.visible, true);
    assert.deepEqual(fineMeshes.map(mesh => mesh.visible), [false, false]);
}

{
    const {renderer, coarseMesh, fineMeshes} = streamedMeshHarness({
        chunk: true,
        "fine-0": true,
        "fine-1": false,
    });
    renderer.cullMeshChunks();
    assert.equal(coarseMesh.visible, false);
    assert.deepEqual(fineMeshes.map(mesh => mesh.visible), [true, false]);
}

console.log("GPU mesh culling tests passed");
