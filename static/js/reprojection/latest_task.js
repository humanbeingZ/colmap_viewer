(function (globalScope) {
    "use strict";

    class LatestTaskScheduler {
        constructor(schedule = callback => globalScope.requestAnimationFrame(callback)) {
            this.schedule = schedule;
            this.pendingTask = null;
            this.scheduled = false;
            this.running = false;
        }

        request(task) {
            this.pendingTask = task;
            this.scheduleDrain();
        }

        scheduleDrain() {
            if (!this.pendingTask || this.running || this.scheduled) {
                return;
            }
            this.scheduled = true;
            this.schedule(() => this.drain());
        }

        async drain() {
            this.scheduled = false;
            this.running = true;
            try {
                while (this.pendingTask) {
                    const task = this.pendingTask;
                    this.pendingTask = null;
                    await task();
                }
            } finally {
                this.running = false;
                this.scheduleDrain();
            }
        }
    }

    globalScope.ReprojectionLatestTaskScheduler = LatestTaskScheduler;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = LatestTaskScheduler;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
