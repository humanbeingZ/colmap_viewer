(function (globalScope) {
    "use strict";

    class ReprojectionSourcePicker {
        constructor({select, picker, cycleIndex, onSelect}) {
            this.select = select;
            this.picker = picker;
            this.cycleIndex = cycleIndex;
            this.onSelect = onSelect;
            this.hiddenSources = new Set();
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

        sync() {
            const options = [...this.select.options];
            const optionValues = new Set(options.map(option => option.value));
            for (const hiddenSource of this.hiddenSources) {
                if (!optionValues.has(hiddenSource)) {
                    this.hiddenSources.delete(hiddenSource);
                }
            }
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
                choice.title = option.textContent;
                choice.setAttribute("role", "menuitemradio");
                choice.setAttribute("aria-checked", String(selectedOption));
                choice.addEventListener(
                    "click", () => this.selectValue(option.value, true)
                );

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
                row.append(choice, eye);
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
