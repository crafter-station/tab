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

  function activateTab(demo, button, moveFocus = false) {
    const target = button.getAttribute("data-demo-target");
    if (!target) return;

    demo.dataset.active = target;
    demo.querySelectorAll("[data-demo-target]").forEach((tab) => {
      const selected = tab === button;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    demo.querySelectorAll("[data-demo-scene]").forEach((panel) => {
      panel.hidden = panel.getAttribute("data-demo-scene") !== target;
    });
    if (moveFocus) button.focus();
    replay(demo);
    announce(demo, `${button.textContent.trim()} example selected. Suggestion ready. Press Option plus Tab to accept.`);
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
      activateTab(demo, control);
      return;
    }

    replay(demo);
  });

  document.addEventListener("keydown", (event) => {
    const focusedDemo = document.activeElement?.closest?.("[data-tab-demo]");
    if (event.altKey && event.key === "Tab" && focusedDemo) {
      event.preventDefault();
      accept(focusedDemo);
      return;
    }

    const currentTab = document.activeElement?.closest?.("[data-demo-target]");
    if (!currentTab || !focusedDemo) return;

    const tabs = [...focusedDemo.querySelectorAll("[data-demo-target]")];
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex;

    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    else return;

    event.preventDefault();
    activateTab(focusedDemo, tabs[nextIndex], true);
  });

  document.querySelectorAll("[data-tab-demo]").forEach((demo) => {
    const active = demo.querySelector('[data-demo-target][aria-selected="true"]');
    if (active) activateTab(demo, active);
  });
})();
