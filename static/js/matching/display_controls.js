(function (globalScope, factory) {
    const api = factory();
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    } else {
        globalScope.MatchingDisplayControls = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    function syncMatchedOnly(primary, matchedOnly) {
        matchedOnly.disabled = !primary.checked;
    }

    function isMatchedOnlyActive(primary, matchedOnly) {
        return primary.checked && matchedOnly.checked;
    }

    function setLineAvailability(elements, available) {
        elements.displayOptions.hidden = !available;
        elements.matchActions.hidden = !available;
        if (!available) {
            elements.showLines.checked = false;
            elements.onlyMatchedLines.checked = false;
            elements.drawMatches.classList.remove("active");
        }
        syncMatchedOnly(elements.showLines, elements.onlyMatchedLines);
    }

    function setMatchTypeAvailability(elements, available) {
        const {container, inlier, outlier} = elements;
        if (!available) {
            if (!container.hidden) {
                container.savedSelection = {
                    inlier: inlier.checked,
                    outlier: outlier.checked,
                };
            }
            container.hidden = true;
            inlier.checked = true;
            outlier.checked = false;
            return;
        }

        if (container.savedSelection) {
            inlier.checked = container.savedSelection.inlier;
            outlier.checked = container.savedSelection.outlier;
        }
        container.hidden = false;
    }

    return {
        isMatchedOnlyActive,
        setLineAvailability,
        setMatchTypeAvailability,
        syncMatchedOnly,
    };
});
