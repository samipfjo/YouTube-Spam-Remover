document.addEventListener("click", () => (typeof browser === 'undefined' ? chrome : browser).runtime.openOptionsPage());