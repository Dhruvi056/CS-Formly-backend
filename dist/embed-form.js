(() => {
  // Minimal embeddable form handler for Webflow.
  const FORMS_ATTACHED = new WeakSet();

  const SCRIPT_URL = document.currentScript?.src || "";
  const BASE_URL = SCRIPT_URL.split("/embed-form.js")[0];

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * intl-tel-input (and similar) often keep national digits in the visible input while the
   * dial code is shown separately. Temporarily set the input value to E.164 for serialization.
   * @returns {{ input: HTMLInputElement, prev: string }[]}
   */
  function getIntlTelInputInstance(input) {
    try {
      const g = window.intlTelInputGlobals;
      if (g && typeof g.getInstance === "function") return g.getInstance(input);
    } catch (_) {}
    try {
      const iti = window.intlTelInput;
      if (iti && typeof iti.getInstance === "function") return iti.getInstance(input);
    } catch (_) {}
    return null;
  }

  function snapshotIntlTelInputValuesForSubmit(form) {
    const backups = [];
    try {
      const inputs = form.querySelectorAll("input[type='tel'], input.iti__tel-input");
      inputs.forEach((input) => {
        try {
          const iti = getIntlTelInputInstance(input);
          if (!iti) return;
          const full = iti.getNumber();
          if (!full || !String(full).trim().startsWith("+")) return;
          backups.push({ input, prev: input.value });
          input.value = full;
        } catch (_) {}
      });
    } catch (_) {}
    return backups;
  }

  function restoreIntlTelInputValues(backups) {
    (backups || []).forEach(({ input, prev }) => {
      try {
        input.value = prev;
      } catch (_) {}
    });
  }

  async function handleSubmit(e) {
    const form = e.target;

    // Support both data-form-id and action=".../api/forms/<id>"
    let formId = form.getAttribute("data-form-id");
    let endpoint;
    if (!formId) {
      const action = form.getAttribute("action") || "";
      const match = action.match(/\/api\/forms\/([a-f0-9]{24})/i);
      if (!match) return;
      formId = match[1];
      endpoint = action; // use full URL from action
    } else {
      endpoint = `${BASE_URL}/api/forms/${formId}`;
    }

    e.preventDefault();
    e.stopPropagation();

    const submitBtn = form.querySelector("[type=submit]");
    if (submitBtn && !submitBtn.dataset.originalText) {
      submitBtn.dataset.originalText = submitBtn.textContent;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Submitting...";
    }

    try {
      const intlBackups = snapshotIntlTelInputValuesForSubmit(form);
      let formData;
      try {
        formData = new FormData(form);
      } finally {
        restoreIntlTelInputValues(intlBackups);
      }

      const hasFileInputs = Array.from(form.elements).some(
        (el) => el.tagName === "INPUT" && el.type === "file"
      );

      let res;

      if (hasFileInputs) {
        const payload = {};
        const filePromises = [];

        for (const [name, value] of formData.entries()) {
          if (value instanceof File) {
            const file = value;
            if (!file || !file.name || file.size === 0) {
              continue;
            }

            filePromises.push(
              readFileAsDataUrl(file).then((dataUrl) => {
                payload[name] = {
                  fileName: file.name,
                  mimeType: file.type || "application/octet-stream",
                  dataUrl,
                };
              })
            );
          } else {
            if (payload[name] === undefined) {
              payload[name] = value;
            } else if (Array.isArray(payload[name])) {
              payload[name].push(value);
            } else {
              payload[name] = [payload[name], value];
            }
          }
        }

        await Promise.all(filePromises);

        console.log("Submitting form with file data to:", endpoint);

        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
          credentials: "omit",
          cache: "no-cache",
        });
      } else {
        const body = new URLSearchParams(formData).toString();

        console.log("Submitting form to:", endpoint);

        res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body,
          credentials: "omit",
          cache: "no-cache",
        });
      }

      const ok = res.ok;
      if (ok) {
        form.reset();
        
        // --- Webflow Native Success UI ---
        // 1. Hide the form
        form.style.display = "none";
        
        // 2. Show the success element (.w-form-done)
        // Usually it's a sibling of the form inside the same .w-form container
        const container = form.closest(".w-form") || form.parentElement;
        const successEl = container.querySelector(".w-form-done");
        if (successEl) {
          successEl.style.display = "block";
        }
        
        // 3. Ensure error element is hidden
        const errorEl = container.querySelector(".w-form-fail");
        if (errorEl) {
          errorEl.style.display = "none";
        }
      } else {
        // --- Webflow Native Failure UI ---
        const container = form.closest(".w-form") || form.parentElement;
        const errorEl = container.querySelector(".w-form-fail");
        if (errorEl) {
          errorEl.style.display = "block";
        }
        
        try {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            const json = await res.json();
            console.error("Submission failed:", json.error || json.message);
          }
        } catch (_) {}
      }

    } catch (err) {
      console.error("Form submission error:", err);
      const container = form.closest(".w-form") || form.parentElement;
      const errorEl = container.querySelector(".w-form-fail");
      if (errorEl) {
        errorEl.style.display = "block";
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent =
          submitBtn.dataset.originalText || submitBtn.textContent;
      }
    }
  }

  function attachToForm(form) {
    if (FORMS_ATTACHED.has(form)) return;

    // Accept forms with data-form-id OR action pointing to our /api/forms/ endpoint
    const formId = form.getAttribute("data-form-id");
    const action = form.getAttribute("action") || "";
    const hasActionEndpoint = /\/api\/forms\/[a-f0-9]{24}/i.test(action);
    if (!formId && !hasActionEndpoint) return;

    form.addEventListener("submit", handleSubmit, { capture: true });
    FORMS_ATTACHED.add(form);

    console.log("Attached form:", formId || "via action");
  }

  function attach() {
    document.querySelectorAll("form").forEach(attachToForm);
  }

  function setupMutationObserver() {
    if (typeof MutationObserver === "undefined") return;

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            if (node.tagName === "FORM") {
              attachToForm(node);
            }
            if (node.querySelectorAll) {
              node.querySelectorAll("form").forEach(attachToForm);
            }
          }
        });
      });
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // Initialize
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      attach();
      setupMutationObserver();
    });
  } else {
    attach();
    setupMutationObserver();
  }

  attach();
})();
