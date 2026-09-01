const assert = require("assert");
const {
    cycleSelection,
    MatchingHoldNavigation,
} = require("../../static/js/matching/navigation.js");

(async () => {

function select(selectedIndex = 1, count = 4) {
    return {
        selectedIndex,
        options: Array.from({length: count}, () => ({})),
    };
}

const cycling = select(1);
assert.equal(cycleSelection(cycling, "forward"), true);
assert.equal(cycling.selectedIndex, 2);
cycling.selectedIndex = 3;
cycleSelection(cycling, "forward");
assert.equal(cycling.selectedIndex, 1);
cycleSelection(cycling, "backward");
assert.equal(cycling.selectedIndex, 3);

const image1 = select(1);
const image2 = select(1);
const previews = [];
const commits = [];
let finishPreview;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.clearTimeout = function (timer) {
    assert.equal(this, globalThis);
    return originalClearTimeout(timer);
};
const navigation = new MatchingHoldNavigation({
    targets: {
        ArrowRight: {select: image1, direction: "forward", pane: "image1"},
        ArrowDown: {select: image2, direction: "forward", pane: "image2"},
    },
    onPreview: target => {
        previews.push(target.pane);
        return new Promise(resolve => { finishPreview = resolve; });
    },
    onCommit: target => commits.push(target.pane),
    initialDelay: 0,
    repeatDelay: 0,
    minimumRepeatDelay: 0,
    repeatAcceleration: 0,
});

assert.equal(navigation.keyDown("ArrowRight"), true);
assert.equal(navigation.keyDown("ArrowRight"), true);
assert.deepEqual(previews, ["image1"]);
assert.equal(image1.selectedIndex, 2);
finishPreview();
await new Promise(resolve => setTimeout(resolve, 10));
assert.deepEqual(previews, ["image1", "image1"]);
assert.equal(image1.selectedIndex, 3);
assert.deepEqual(commits, []);
assert.equal(navigation.keyUp("ArrowRight"), true);
assert.deepEqual(commits, ["image1"]);
assert.equal(navigation.keyUp("ArrowRight"), false);

// A fresh physical press starts a new navigation session.
assert.equal(navigation.keyDown("ArrowRight"), true);
assert.deepEqual(previews, ["image1", "image1", "image1"]);
assert.equal(navigation.keyUp("ArrowRight"), true);

// Vertical navigation drives Image 2 independently.
assert.equal(navigation.keyDown("ArrowDown"), true);
assert.deepEqual(previews, ["image1", "image1", "image1", "image2"]);
assert.equal(image2.selectedIndex, 2);
assert.equal(navigation.keyUp("ArrowDown"), true);

// A target without another option is handled but starts no preview or commit.
image2.options = [{}];
image2.selectedIndex = 0;
assert.equal(navigation.keyDown("ArrowDown"), true);
assert.equal(navigation.keyUp("ArrowDown"), false);
assert.deepEqual(previews, ["image1", "image1", "image1", "image2"]);

// A failed first preview commits the new selection through the normal load
// path instead of leaving preview mode active with no key-up target.
const failedSelect = select(1);
const failedCommits = [];
const failedNavigation = new MatchingHoldNavigation({
    targets: {
        ArrowRight: {
            select: failedSelect,
            direction: "forward",
            pane: "failed",
        },
    },
    onPreview: async () => false,
    onCommit: target => failedCommits.push(target.pane),
});
assert.equal(failedNavigation.keyDown("ArrowRight"), true);
await Promise.resolve();
assert.equal(failedSelect.selectedIndex, 2);
assert.deepEqual(failedCommits, ["failed"]);
assert.equal(failedNavigation.activeKey, null);
assert.equal(failedNavigation.keyUp("ArrowRight"), false);

// A failure arriving after key-up is stale and must not commit a second time.
const staleSelect = select(1);
const staleCommits = [];
let finishStalePreview;
const staleNavigation = new MatchingHoldNavigation({
    targets: {
        ArrowRight: {
            select: staleSelect,
            direction: "forward",
            pane: "stale",
        },
    },
    onPreview: () => new Promise(resolve => {
        finishStalePreview = resolve;
    }),
    onCommit: target => staleCommits.push(target.pane),
});
assert.equal(staleNavigation.keyDown("ArrowRight"), true);
assert.equal(staleNavigation.keyUp("ArrowRight"), true);
finishStalePreview(false);
await Promise.resolve();
assert.deepEqual(staleCommits, ["stale"]);
globalThis.clearTimeout = originalClearTimeout;

console.log("matching hold navigation tests passed");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
