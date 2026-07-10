(() => {
  if (window.__tabMarketingDemo) return;
  window.__tabMarketingDemo = true;

  function announce(demo, message) {
    const announcement = demo.querySelector("[data-demo-announcement]");
    if (announcement) announcement.textContent = message;
  }

  function replay(demo) {
    demo.dataset.accepted = "false";
    demo.dataset.restarting = "true";
    announce(demo, "Suggestion ready. Press Option plus Tab to accept.");
    requestAnimationFrame(() => requestAnimationFrame(() => delete demo.dataset.restarting));
  }

  function accept(demo) {
    if (demo.dataset.accepted === "true") return;
    demo.dataset.accepted = "true";
    announce(demo, "Suggestion accepted and added to the example.");
  }

  function visibleDemo() {
    return [...document.querySelectorAll("[data-tab-demo]")].find((demo) => {
      const bounds = demo.getBoundingClientRect();
      return bounds.top < window.innerHeight && bounds.bottom > 0;
    });
  }

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest("[data-demo-target], [data-demo-replay], [data-demo-accept]");
    if (!control) return;

    const demo = control.closest("[data-tab-demo]");
    if (!demo) return;

    if (control.hasAttribute("data-demo-accept")) {
      accept(demo);
      return;
    }

    const target = control.getAttribute("data-demo-target");
    if (target) {
      demo.dataset.active = target;
      demo.querySelectorAll("[data-demo-target]").forEach((button) => {
        button.setAttribute("aria-selected", String(button.getAttribute("data-demo-target") === target));
      });
    }

    replay(demo);
  });

  document.addEventListener("keydown", (event) => {
    if (!event.altKey || event.key !== "Tab") return;
    const focusedDemo = document.activeElement?.closest?.("[data-tab-demo]");
    const demo = focusedDemo ?? visibleDemo();
    if (!demo) return;

    event.preventDefault();
    accept(demo);
  });
})();
