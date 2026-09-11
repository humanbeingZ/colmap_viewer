(function (globalScope) {
    "use strict";

    const COPY_ICON = `
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <rect x="5.25" y="1.25" width="9.5" height="9.5" rx="1.5"
                  fill="none" stroke="currentColor" stroke-width="1.5"/>
            <rect x="1.25" y="5.25" width="9.5" height="9.5" rx="1.5"
                  fill="none" stroke="currentColor" stroke-width="1.5"/>
        </svg>`;

    async function copyText(value) {
        if (globalScope.navigator?.clipboard?.writeText
                && globalScope.isSecureContext) {
            await globalScope.navigator.clipboard.writeText(value);
            return;
        }
        const input = globalScope.document.createElement("textarea");
        input.value = value;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.opacity = "0";
        globalScope.document.body.appendChild(input);
        input.select();
        try {
            if (!globalScope.document.execCommand("copy")) {
                throw new Error("Browser rejected the clipboard operation");
            }
        } finally {
            input.remove();
        }
    }

    function decorateButton(button) {
        button.classList.add("copy-icon-button");
        button.innerHTML = COPY_ICON;
        button.dataset.copyDefaultTitle = button.title;
    }

    function showCopied(button, copiedTitle, duration = 1200) {
        globalScope.clearTimeout(button.copyFeedbackTimeout);
        button.classList.add("copied");
        button.title = copiedTitle;
        button.copyFeedbackTimeout = globalScope.setTimeout(() => {
            button.classList.remove("copied");
            button.title = button.dataset.copyDefaultTitle || "Copy";
        }, duration);
    }

    const api = {copyText, decorateButton, showCopied};
    globalScope.SharedClipboard = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
