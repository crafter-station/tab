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

  const workflowResetTimers = new WeakMap();

  function acceptWorkflow(workflow) {
    workflow.dataset.accepted = "true";
    const announcement = workflow.querySelector("[data-workflow-announcement]");
    if (announcement) announcement.textContent = "Suggestion accepted and added to the example.";
    const currentTimer = workflowResetTimers.get(workflow);
    if (currentTimer) window.clearTimeout(currentTimer);
    const resetTimer = window.setTimeout(() => {
      workflow.dataset.accepted = "false";
      if (announcement) announcement.textContent = "Suggestion ready. Press Option plus Tab or click to accept.";
      workflowResetTimers.delete(workflow);
    }, 1800);
    workflowResetTimers.set(workflow, resetTimer);
  }

  function acceptanceSurfaceFor(element) {
    return element?.closest?.("[data-tab-demo]")
      ?? element?.closest?.("[data-tab-workflow]")
      ?? null;
  }

  function acceptSurface(surface) {
    if (surface.hasAttribute?.("data-tab-workflow")) acceptWorkflow(surface);
    else accept(surface);
  }

  let activeAcceptanceSurface = document.querySelector("[data-tab-demo]");

  function rememberAcceptanceSurface(event) {
    const surface = acceptanceSurfaceFor(event.target);
    if (surface) activeAcceptanceSurface = surface;
  }

  document.addEventListener("focusin", rememberAcceptanceSurface);
  document.addEventListener("pointerover", rememberAcceptanceSurface);

  function replayShowcase(showcase) {
    showcase.dataset.restarting = "true";
    requestAnimationFrame(() => requestAnimationFrame(() => {
      showcase.dataset.restarting = "false";
    }));
  }

  function setMotionPaused(region, paused) {
    region.dataset.motionPaused = String(paused);
    region.querySelectorAll("svg").forEach((svg) => {
      if (typeof svg.pauseAnimations !== "function") return;
      if (paused) svg.pauseAnimations();
      else svg.unpauseAnimations();
    });
    region.querySelectorAll("[data-motion-toggle]").forEach((button) => {
      button.setAttribute("aria-pressed", String(paused));
      const label = button.querySelector("[data-motion-toggle-label]");
      if (label) label.textContent = paused ? "Resume animation" : "Pause animation";
    });
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
    const control = event.target.closest("[data-demo-target], [data-demo-replay], [data-demo-accept], [data-workflow-accept], [data-showcase-replay], [data-motion-toggle]");
    if (!control) return;

    if (control.hasAttribute("data-motion-toggle")) {
      const region = control.closest("[data-motion-region]");
      if (region) setMotionPaused(region, region.dataset.motionPaused !== "true");
      return;
    }

    if (control.hasAttribute("data-showcase-replay")) {
      const showcase = control.closest("[data-animated-showcase]");
      if (showcase) replayShowcase(showcase);
      return;
    }

    const workflow = control.closest("[data-tab-workflow]");
    if (workflow) {
      acceptWorkflow(workflow);
      return;
    }

    const demo = control.closest("[data-tab-demo]");
    if (!demo) return;

    if (control.hasAttribute("data-demo-accept")) {
      accept(demo);
      return;
    }

    if (control.hasAttribute("data-demo-target")) {
      activateTab(demo, control);
      return;
    }

    replay(demo);
  });

  document.addEventListener("keydown", (event) => {
    const focusedSurface = acceptanceSurfaceFor(document.activeElement);
    if (event.altKey && (event.key === "Tab" || event.code === "Tab")) {
      const surface = focusedSurface ?? activeAcceptanceSurface;
      if (!surface) return;
      event.preventDefault();
      activeAcceptanceSurface = surface;
      acceptSurface(surface);
      return;
    }

    const focusedDemo = document.activeElement?.closest?.("[data-tab-demo]");
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

  document.querySelectorAll("[data-motion-region]").forEach((region) => {
    setMotionPaused(region, region.dataset.motionPaused === "true");
  });
})();
