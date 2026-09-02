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

    class LatestRequestGuard {
        constructor() {
            this.latest = 0;
        }

        begin() {
            this.latest += 1;
            return this.latest;
        }

        isCurrent(request) {
            return request === this.latest;
        }
    }

    globalScope.ReprojectionLatestTaskScheduler = LatestTaskScheduler;
    globalScope.ReprojectionLatestRequestGuard = LatestRequestGuard;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = LatestTaskScheduler;
        module.exports.LatestRequestGuard = LatestRequestGuard;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
