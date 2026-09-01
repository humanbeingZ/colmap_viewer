import {build} from "esbuild";
import {writeFile} from "node:fs/promises";

const shared = {
    bundle: true,
    external: ["node:worker_threads"],
    legalComments: "none",
    minify: true,
    target: "es2022",
    write: false,
};

async function buildClean(options) {
    const result = await build({...shared, ...options});
    await Promise.all(result.outputFiles.map(output => writeFile(
        output.path,
        // Upstream shader template literals contain indentation after their
        // final token and mixed space/tab indentation. Both are semantically
        // irrelevant but otherwise make generated artifacts fail
        // `git diff --check`.
        output.text
            .replace(/[ \t]+$/gm, "")
            .replace(/^ +(?=\t)/gm, "")
    )));
}

await buildClean({
    entryPoints: ["static/js/reprojection/gpu_renderer.js"],
    format: "iife",
    globalName: "ReprojectionGpu",
    outfile: "static/vendor/reprojection_gpu.js",
});

await buildClean({
    entryPoints: ["static/js/reprojection/playcanvas_gaussian_renderer.mjs"],
    format: "esm",
    outfile: "static/vendor/playcanvas_gaussian_renderer.js",
});
