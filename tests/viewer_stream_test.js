const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("static/js/viewer_stream.js", "utf8");

class MemoryStorage {
    constructor(id) {
        this.values = new Map([["viewer-stream", id]]);
    }

    getItem(key) {
        return this.values.get(key) ?? null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

class LockManager {
    constructor() {
        this.held = new Set();
    }

    request(name, options, callback) {
        if (this.held.has(name)) {
            return Promise.resolve(callback(null));
        }
        this.held.add(name);
        return Promise.resolve(callback({name})).finally(() => {
            this.held.delete(name);
        });
    }
}

const locks = new LockManager();
let uuid = 0;

async function createPage(storage) {
    const context = {
        sessionStorage: storage,
        navigator: {locks},
        crypto: {randomUUID: () => `uuid-${++uuid}`},
        Date,
        Math,
        Promise,
        setTimeout,
        BroadcastChannel: undefined,
    };
    context.globalThis = context;
    vm.runInNewContext(source, context);
    const identity = new context.ViewerStreamIdentity({
        storageKey: "viewer-stream",
    });
    await identity.ready;
    return identity;
}

(async () => {
    const originalStorage = new MemoryStorage("shared");
    const original = await createPage(originalStorage);
    const clone = await createPage(new MemoryStorage("shared"));
    assert.strictEqual(original.id, "shared");
    assert.notStrictEqual(clone.id, original.id);

    original._lockRelease();
    await new Promise(resolve => setImmediate(resolve));
    const reload = await createPage(originalStorage);
    assert.strictEqual(reload.id, original.id);

    clone._lockRelease();
    reload._lockRelease();
    console.log("viewer stream identity tests passed");
})().catch(error => {
    console.error(error);
    process.exit(1);
});
