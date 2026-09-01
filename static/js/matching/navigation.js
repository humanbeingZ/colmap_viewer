(function (globalScope) {
    "use strict";

    function cycleSelection(select, direction) {
        const optionCount = select.options.length;
        if (optionCount <= 1) {
            return false;
        }
        let nextIndex = select.selectedIndex;
        if (direction === "forward") {
            nextIndex += 1;
            if (nextIndex >= optionCount) {
                nextIndex = 1;
            }
        } else {
            nextIndex -= 1;
            if (nextIndex < 1) {
                nextIndex = optionCount - 1;
            }
        }
        if (nextIndex === select.selectedIndex) {
            return false;
        }
        select.selectedIndex = nextIndex;
        return true;
    }

    class MatchingHoldNavigation {
        constructor({
            targets,
            onPreview,
            onCommit,
            initialDelay = 250,
            repeatDelay = 110,
            minimumRepeatDelay = 50,
            repeatAcceleration = 8,
            setTimer = (callback, delay) => globalScope.setTimeout(callback, delay),
            clearTimer = timer => globalScope.clearTimeout(timer),
            now = () => globalScope.performance.now(),
        }) {
            this.targets = targets;
            this.onPreview = onPreview;
            this.onCommit = onCommit;
            this.initialDelay = initialDelay;
            this.initialRepeatDelay = repeatDelay;
            this.minimumRepeatDelay = minimumRepeatDelay;
            this.repeatAcceleration = repeatAcceleration;
            this.setTimer = setTimer;
            this.clearTimer = clearTimer;
            this.now = now;
            this.activeKey = null;
            this.activeTarget = null;
            this.repeatDelay = repeatDelay;
            this.repeatTimer = null;
            this.session = 0;
        }

        keyDown(key) {
            const target = this.targets[key];
            if (!target || (target.enabled && !target.enabled())) {
                return false;
            }
            if (this.activeKey && this.activeKey !== key) {
                this.commit();
            }
            if (this.activeKey === key) {
                return true;
            }
            if (!cycleSelection(target.select, target.direction)) {
                return true;
            }
            this.activeKey = key;
            this.activeTarget = target;
            const session = ++this.session;
            const startedAt = this.now();
            let firstPreview;
            try {
                firstPreview = this.onPreview(target);
            } catch (error) {
                this.commitFailedPreview(target, key, session);
                return true;
            }
            void this.run(target, key, session, startedAt, firstPreview);
            return true;
        }

        async run(target, key, session, startedAt, firstPreview) {
            try {
                const displayed = await firstPreview;
                if (displayed === false) {
                    this.commitFailedPreview(target, key, session);
                    return;
                }
                if (!this.isActive(key, session)) {
                    return;
                }
            } catch (error) {
                this.commitFailedPreview(target, key, session);
                return;
            }
            const remainingInitialDelay = Math.max(
                0, this.initialDelay - (this.now() - startedAt)
            );
            await this.wait(remainingInitialDelay);
            while (this.isActive(key, session)) {
                if (!await this.advance(target, key, session)) {
                    break;
                }
                this.repeatDelay = Math.max(
                    this.minimumRepeatDelay,
                    this.repeatDelay - this.repeatAcceleration
                );
                await this.wait(this.repeatDelay);
            }
        }

        async advance(target, key, session) {
            if (!this.isActive(key, session)
                    || !cycleSelection(target.select, target.direction)) {
                return false;
            }
            try {
                const displayed = await this.onPreview(target);
                return displayed !== false && this.isActive(key, session);
            } catch (error) {
                return false;
            }
        }

        wait(delay) {
            return new Promise(resolve => {
                this.repeatTimer = this.setTimer(() => {
                    this.repeatTimer = null;
                    resolve();
                }, delay);
            });
        }

        isActive(key, session) {
            return this.activeKey === key && this.session === session;
        }

        commitFailedPreview(target, key, session) {
            if (this.isActive(key, session) && this.activeTarget === target) {
                this.commit();
            }
        }

        keyUp(key) {
            if (key !== this.activeKey) {
                return false;
            }
            this.commit();
            return true;
        }

        commit() {
            const target = this.activeTarget;
            this.session += 1;
            this.clearTimer(this.repeatTimer);
            this.repeatTimer = null;
            this.activeKey = null;
            this.activeTarget = null;
            this.repeatDelay = this.initialRepeatDelay;
            if (target) {
                this.onCommit(target);
            }
        }
    }

    const api = {cycleSelection, MatchingHoldNavigation};
    globalScope.MatchingNavigation = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
