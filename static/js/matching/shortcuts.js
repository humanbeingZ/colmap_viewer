(function (globalScope, factory) {
    const api = factory(globalScope);
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    } else {
        globalScope.MatchingShortcuts = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function (globalScope) {
    "use strict";

    function isEditingTarget(target) {
        const tagName = String(target?.tagName || "").toUpperCase();
        return target?.isContentEditable
            || tagName === "INPUT"
            || tagName === "TEXTAREA"
            || tagName === "SELECT";
    }

    function handle(event, bindings, dispatchChange = control => {
        control.dispatchEvent(new globalScope.Event("change", {bubbles: true}));
    }) {
        if (event.repeat || event.ctrlKey || event.metaKey || event.altKey
                || isEditingTarget(event.target)) {
            return false;
        }
        const binding = bindings[String(event.key || "").toLowerCase()];
        if (!binding || binding.control.disabled
                || (binding.enabled && !binding.enabled())) {
            return false;
        }
        binding.control.checked = !binding.control.checked;
        dispatchChange(binding.control);
        return true;
    }

    return {handle, isEditingTarget};
});
