(function (globalScope, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    } else {
        globalScope.MatchingLineControls = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function setAvailable(elements, available) {
        elements.displayOptions.hidden = !available;
        elements.matchActions.hidden = !available;
        if (available) {
            return;
        }
        elements.showLines.checked = false;
        elements.onlyMatchedLines.checked = false;
        elements.drawMatches.classList.remove("active");
    }

    return {setAvailable};
});
