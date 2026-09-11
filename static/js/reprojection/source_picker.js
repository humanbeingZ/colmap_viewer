(function (globalScope) {
    "use strict";

    const sharedClipboard = globalScope.SharedClipboard || (
        typeof module !== "undefined" && module.exports
            ? require("../shared/clipboard.js")
            : null
    );

    class ReprojectionSourcePicker {
        constructor({
            select,
            picker,
            cycleIndex,
            onSelect,
            onRename = null,
            onInfo = null,
            copyText: copyTextImpl = sharedClipboard?.copyText,
        }) {
            this.select = select;
            this.picker = picker;
            this.cycleIndex = cycleIndex;
            this.onSelect = onSelect;
            this.onRename = onRename;
            this.onInfo = onInfo;
            if (!copyTextImpl) {
                throw new Error("SharedClipboard must be loaded before source_picker.js");
            }
            this.copyText = copyTextImpl;
            this.hiddenSources = new Set();
            this.knownSources = new Set();
            this.trigger = picker.querySelector(".reprojection-source-trigger");
            this.menu = picker.querySelector(".reprojection-source-menu");
            this.trigger.addEventListener("click", () => this.toggle());
            picker.addEventListener("keydown", event => {
                if (event.key === "Escape") {
                    this.close();
                    this.trigger.focus();
                }
            });
            document.addEventListener("click", event => {
                if (!picker.contains(event.target)) {
                    this.close();
                }
            });
            this.sync();
        }

        close() {
            this.menu.hidden = true;
            this.trigger.setAttribute("aria-expanded", "false");
            for (const panel of this.menu.querySelectorAll(
                ".reprojection-source-info-panel"
            )) {
                panel.hidden = true;
            }
            for (const button of this.menu.querySelectorAll(
                ".reprojection-source-info"
            )) {
                button.setAttribute("aria-expanded", "false");
            }
        }

        toggle() {
            const opening = this.menu.hidden;
            this.menu.hidden = !opening;
            this.trigger.setAttribute("aria-expanded", String(opening));
        }

        visibleValues() {
            return [...this.select.options]
                .map(option => option.value)
                .filter(value => !this.hiddenSources.has(value));
        }

        nextValue(direction = 1) {
            const values = this.visibleValues();
            if (!values.length) {
                return null;
            }
            const currentIndex = values.indexOf(this.select.value);
            return values[this.cycleIndex(
                currentIndex, values.length, direction
            )];
        }

        selectValue(value, close = false) {
            this.hiddenSources.delete(value);
            this.select.value = value;
            this.onSelect();
            if (close) {
                this.close();
            }
        }

        toggleVisibility(option, currentlyHidden) {
            if (currentlyHidden) {
                this.hiddenSources.delete(option.value);
                this.sync();
            } else {
                this.hiddenSources.add(option.value);
                if (this.select.value === option.value) {
                    const next = this.nextValue();
                    if (next !== null) {
                        this.selectValue(next);
                    }
                } else {
                    this.sync();
                }
            }
            this.trigger.focus();
        }

        renameValue(value, label) {
            const normalized = String(label || "").trim();
            if (!normalized || !this.onRename) {
                return false;
            }
            this.onRename(value, normalized);
            return true;
        }

        infoForValue(value, fallbackLabel) {
            const info = this.onInfo?.(value) || {};
            return {
                label: String(info.label || fallbackLabel || ""),
                filename: String(info.filename || ""),
                path: String(info.path || ""),
            };
        }

        buildInfoPanel(option) {
            const panel = document.createElement("div");
            panel.className = "reprojection-source-info-panel";
            panel.hidden = true;
            const status = document.createElement("div");
            status.className = "reprojection-source-copy-status";
            status.setAttribute("role", "status");
            const info = this.infoForValue(option.value, option.textContent);
            for (const [key, fieldLabel] of [
                ["label", "Label"],
                ["filename", "Filename"],
                ["path", "Path"],
            ]) {
                const value = info[key];
                const row = document.createElement("div");
                row.className = "reprojection-source-info-field";
                const name = document.createElement("span");
                name.textContent = fieldLabel;
                const content = document.createElement("code");
                content.textContent = value || "Unavailable";
                content.classList.toggle("unavailable", !value);
                const copy = document.createElement("button");
                copy.type = "button";
                copy.className = "reprojection-source-copy";
                copy.disabled = !value;
                copy.title = value
                    ? `Copy ${fieldLabel.toLowerCase()}`
                    : `${fieldLabel} unavailable`;
                copy.setAttribute("aria-label", copy.title);
                sharedClipboard.decorateButton(copy);
                copy.addEventListener("click", async event => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                        await this.copyText(value);
                        status.textContent = `${fieldLabel} copied`;
                        sharedClipboard.showCopied(copy, `${fieldLabel} copied`);
                    } catch (_) {
                        status.textContent = `Unable to copy ${fieldLabel.toLowerCase()}`;
                    }
                });
                row.append(name, content, copy);
                panel.appendChild(row);
            }
            panel.appendChild(status);
            return panel;
        }

        registerSources(optionValues, defaultHiddenSources = new Set()) {
            for (const value of optionValues) {
                if (!this.knownSources.has(value)
                        && defaultHiddenSources.has(value)) {
                    this.hiddenSources.add(value);
                }
            }
            this.knownSources = optionValues;
            for (const hiddenSource of this.hiddenSources) {
                if (!optionValues.has(hiddenSource)) {
                    this.hiddenSources.delete(hiddenSource);
                }
            }
        }

        sync(defaultHiddenSources = new Set()) {
            const options = [...this.select.options];
            const optionValues = new Set(options.map(option => option.value));
            this.registerSources(optionValues, defaultHiddenSources);
            const selected = options.find(
                option => option.value === this.select.value
            );
            this.trigger.querySelector("span").textContent =
                selected?.textContent || "";
            this.menu.innerHTML = "";
            const visibleCount = this.visibleValues().length;
            for (const option of options) {
                const hidden = this.hiddenSources.has(option.value);
                const selectedOption = option.value === this.select.value;
                const row = document.createElement("div");
                row.className = "reprojection-source-row";
                row.classList.toggle("selected", selectedOption);
                row.classList.toggle("hidden-source", hidden);

                const choice = document.createElement("button");
                choice.type = "button";
                choice.className = "reprojection-source-choice";
                choice.textContent = option.textContent;
                choice.title = option.title || option.textContent;
                choice.setAttribute("role", "menuitemradio");
                choice.setAttribute("aria-checked", String(selectedOption));
                choice.addEventListener(
                    "click", () => this.selectValue(option.value, true)
                );

                const labelInput = document.createElement("input");
                labelInput.type = "text";
                labelInput.className = "reprojection-source-label-input";
                labelInput.value = option.textContent;
                labelInput.setAttribute(
                    "aria-label", `Rename ${option.textContent}`
                );
                labelInput.hidden = true;

                const edit = document.createElement("button");
                edit.type = "button";
                edit.className = "reprojection-source-edit";
                edit.textContent = "✎";
                edit.title = `Rename ${option.textContent}`;
                edit.setAttribute("aria-label", edit.title);
                const renamable = Boolean(this.onRename)
                    && option.dataset?.renamable === "true";
                edit.hidden = !renamable;
                const beginRename = () => {
                    choice.hidden = true;
                    labelInput.hidden = false;
                    labelInput.focus();
                    labelInput.select();
                };
                const finishRename = commit => {
                    if (labelInput.hidden) {
                        return;
                    }
                    const requestedLabel = labelInput.value;
                    labelInput.hidden = true;
                    choice.hidden = false;
                    if (commit && this.renameValue(
                        option.value, requestedLabel
                    )) {
                        return;
                    }
                    labelInput.value = option.textContent;
                    this.trigger.focus();
                };
                edit.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    beginRename();
                });
                labelInput.addEventListener("click", event => {
                    event.stopPropagation();
                });
                labelInput.addEventListener("keydown", event => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        finishRename(true);
                    } else if (event.key === "Escape") {
                        event.preventDefault();
                        finishRename(false);
                    }
                });
                labelInput.addEventListener("blur", () => finishRename(true));

                const info = document.createElement("button");
                info.type = "button";
                info.className = "reprojection-source-info";
                info.textContent = "ⓘ";
                info.title = `Show information for ${option.textContent}`;
                info.setAttribute("aria-label", info.title);
                info.setAttribute("aria-expanded", "false");
                const infoPanel = this.buildInfoPanel(option);
                info.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    const opening = infoPanel.hidden;
                    for (const panel of this.menu.querySelectorAll(
                        ".reprojection-source-info-panel"
                    )) {
                        panel.hidden = true;
                    }
                    for (const button of this.menu.querySelectorAll(
                        ".reprojection-source-info"
                    )) {
                        button.setAttribute("aria-expanded", "false");
                    }
                    if (opening) {
                        const currentPanel = this.buildInfoPanel(option);
                        infoPanel.replaceChildren(...currentPanel.children);
                    }
                    infoPanel.hidden = !opening;
                    info.setAttribute("aria-expanded", String(opening));
                });

                const eye = document.createElement("button");
                eye.type = "button";
                eye.className = "reprojection-source-eye";
                eye.textContent = hidden ? "⊘" : "👁";
                eye.title = hidden
                    ? "Include when cycling" : "Exclude from cycling";
                eye.setAttribute("role", "menuitemcheckbox");
                eye.setAttribute("aria-label", `${eye.title}: ${option.textContent}`);
                eye.setAttribute("aria-checked", String(!hidden));
                eye.disabled = !hidden && visibleCount <= 1;
                eye.addEventListener("click", event => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.toggleVisibility(option, hidden);
                });
                row.append(choice, labelInput, edit, info, eye, infoPanel);
                this.menu.appendChild(row);
            }
        }

        cycle(direction = 1) {
            const next = this.nextValue(direction);
            if (next === null || next === this.select.value) {
                return false;
            }
            this.selectValue(next);
            return true;
        }
    }

    globalScope.ReprojectionSourcePicker = ReprojectionSourcePicker;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = ReprojectionSourcePicker;
    }
})(typeof globalThis !== "undefined" ? globalThis : this);
