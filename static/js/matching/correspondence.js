(function (globalScope, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    } else {
        globalScope.MatchingCorrespondence = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function createIndex(matches) {
        const image1Indices = new Set();
        const image2Indices = new Set();
        const adjacency = new Map();

        const connect = (left, right) => {
            if (!adjacency.has(left)) {
                adjacency.set(left, []);
            }
            adjacency.get(left).push(right);
        };

        for (const [image1Index, image2Index] of matches) {
            image1Indices.add(image1Index);
            image2Indices.add(image2Index);
            const image1Node = `image1:${image1Index}`;
            const image2Node = `image2:${image2Index}`;
            connect(image1Node, image2Node);
            connect(image2Node, image1Node);
        }

        const image1ToPalette = new Map();
        const image2ToPalette = new Map();
        const visited = new Set();
        for (const start of adjacency.keys()) {
            if (visited.has(start)) {
                continue;
            }
            const stack = [start];
            const componentImage1 = [];
            const componentImage2 = [];
            visited.add(start);
            while (stack.length) {
                const node = stack.pop();
                const separator = node.indexOf(":");
                const side = node.slice(0, separator);
                const index = Number(node.slice(separator + 1));
                (side === "image1" ? componentImage1 : componentImage2).push(index);
                for (const neighbor of adjacency.get(node) || []) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        stack.push(neighbor);
                    }
                }
            }
            const paletteIndex = Math.min(...componentImage1);
            componentImage1.forEach(index => image1ToPalette.set(index, paletteIndex));
            componentImage2.forEach(index => image2ToPalette.set(index, paletteIndex));
        }

        return {
            image1Indices,
            image2Indices,
            image1ToPalette,
            image2ToPalette,
        };
    }

    function indices(correspondences, canvasKey) {
        return canvasKey === "image1"
            ? correspondences.image1Indices : correspondences.image2Indices;
    }

    function paletteIndex(index, canvasKey, correspondences) {
        const mapping = canvasKey === "image1"
            ? correspondences.image1ToPalette : correspondences.image2ToPalette;
        return mapping.has(index) ? mapping.get(index) : null;
    }

    function color(index, canvasKey, image1Palette, correspondences, fallback) {
        const mappedIndex = paletteIndex(index, canvasKey, correspondences);
        if (mappedIndex !== null) {
            return image1Palette[mappedIndex];
        }
        return canvasKey === "image1" ? image1Palette[index] : fallback(index);
    }

    return {createIndex, indices, paletteIndex, color};
});
