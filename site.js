(function () {
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
  }
  ready(function () {
    document.querySelectorAll("pre").forEach(function (pre) {
      if (pre.querySelector(".copy-btn")) return;
      var text = pre.textContent;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "copy-btn";
      btn.textContent = "Copy";
      btn.setAttribute("aria-label", "Copy code");
      btn.addEventListener("click", function () {
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = "Copied";
          btn.dataset.copied = "true";
          setTimeout(function () {
            btn.textContent = "Copy";
            delete btn.dataset.copied;
          }, 1400);
        });
      });
      pre.appendChild(btn);
    });
  });
})();
