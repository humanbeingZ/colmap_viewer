const assert = require("assert");
const LatestTaskScheduler = require(
    "../../static/js/reprojection/latest_task.js"
);
const {LatestRequestGuard} = LatestTaskScheduler;

{
    const guard = new LatestRequestGuard();
    const obsolete = guard.begin();
    const latest = guard.begin();
    assert.strictEqual(guard.isCurrent(obsolete), false);
    assert.strictEqual(guard.isCurrent(latest), true);
}

(async () => {
    const scheduled = [];
    const scheduler = new LatestTaskScheduler(callback => scheduled.push(callback));
    const completed = [];

    scheduler.request(async () => completed.push("obsolete"));
    scheduler.request(async () => completed.push("latest"));
    assert.strictEqual(scheduled.length, 1);

    await scheduled.shift()();
    assert.deepStrictEqual(completed, ["latest"]);

    let release;
    scheduler.request(async () => {
        completed.push("running");
        await new Promise(resolve => {
            release = resolve;
        });
    });
    const running = scheduled.shift()();
    await Promise.resolve();
    scheduler.request(async () => completed.push("follow-up obsolete"));
    scheduler.request(async () => completed.push("follow-up latest"));
    release();
    await running;

    assert.deepStrictEqual(completed, [
        "latest",
        "running",
        "follow-up latest",
    ]);
    console.log("reprojection latest task tests passed");
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
