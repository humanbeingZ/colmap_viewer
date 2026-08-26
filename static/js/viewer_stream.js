(function exposeViewerStreamIdentity(global) {
    "use strict";

    function newIdentity() {
        return global.crypto?.randomUUID?.()
            || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    class ViewerStreamIdentity {
        constructor({
            storageKey,
            channelName = "colmap-viewer-stream-claims-v1",
            onLateCollision = async () => {},
        }) {
            this.storageKey = storageKey;
            this.channelName = channelName;
            this.onLateCollision = onLateCollision;
            this.id = null;
            this._channel = null;
            this._lockRequest = null;
            this._lockRelease = null;
            this.ready = this._claim();
        }

        static readSession(key) {
            try {
                return global.sessionStorage?.getItem(key);
            } catch (_) {
                return null;
            }
        }

        static writeSession(key, value) {
            try {
                global.sessionStorage?.setItem(key, value);
            } catch (_) {
                // Privacy settings may disable storage; memory state still works.
            }
        }

        _remember(candidate) {
            ViewerStreamIdentity.writeSession(this.storageKey, candidate);
            this.id = candidate;
        }

        async _tryLock(candidate) {
            const locks = global.navigator?.locks;
            if (!locks?.request) {
                return null;
            }
            let resolveAcquired;
            const acquired = new Promise(resolve => {
                resolveAcquired = resolve;
            });
            try {
                this._lockRequest = locks.request(
                    `colmap-viewer-stream:${candidate}`,
                    {mode: "exclusive", ifAvailable: true},
                    lock => {
                        if (!lock) {
                            resolveAcquired(false);
                            return undefined;
                        }
                        resolveAcquired(true);
                        return new Promise(resolve => {
                            this._lockRelease = resolve;
                        });
                    }
                ).catch(() => resolveAcquired(null));
            } catch (_) {
                return null;
            }
            return acquired;
        }

        async _claim() {
            let candidate = ViewerStreamIdentity.readSession(this.storageKey)
                || newIdentity();
            const pageInstance = newIdentity();

            // Browser-managed locks remain reliable when another tab's event
            // loop is suspended, unlike a timeout-only message handshake.
            for (let attempt = 0; attempt < 4; attempt += 1) {
                const acquired = await this._tryLock(candidate);
                if (acquired === true) {
                    this._remember(candidate);
                    return;
                }
                if (acquired === null) {
                    break;
                }
                candidate = newIdentity();
            }

            if (typeof global.BroadcastChannel !== "function") {
                this._remember(candidate);
                return;
            }

            try {
                const channel = new global.BroadcastChannel(this.channelName);
                this._channel = channel;
                let probing = true;
                let occupied = false;
                channel.onmessage = event => {
                    const message = event.data || {};
                    if (message.type === "probe"
                            && message.stream === candidate
                            && message.instance !== pageInstance) {
                        channel.postMessage({
                            type: "occupied",
                            stream: candidate,
                            target: message.instance,
                        });
                    } else if (message.type === "occupied"
                            && message.stream === candidate
                            && message.target === pageInstance) {
                        if (probing) {
                            occupied = true;
                            return;
                        }
                        candidate = newIdentity();
                        this._remember(candidate);
                        channel.postMessage({
                            type: "probe",
                            stream: candidate,
                            instance: pageInstance,
                        });
                        void this.onLateCollision(candidate);
                    }
                };
                channel.postMessage({
                    type: "probe",
                    stream: candidate,
                    instance: pageInstance,
                });
                await new Promise(resolve => global.setTimeout(resolve, 100));
                probing = false;
                if (occupied) {
                    candidate = newIdentity();
                }
            } catch (_) {
                this._channel?.close();
                this._channel = null;
            }
            this._remember(candidate);
        }
    }

    global.ViewerStreamIdentity = ViewerStreamIdentity;
})(globalThis);
