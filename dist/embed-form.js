(() => {
  // Minimal embeddable form handler with toast. Usage:
  // Option 1: <form data-firebase-form-endpoint="https://your-domain/api/f/<formId>">
  // Option 2: <form action="https://your-domain/api/f/<formId>">
  //   ...inputs...
  // </form>
  // <script src="/embed-form.js"></script>

  const TOAST_ID = "__firebase_form_toast__";
  const FORMS_ATTACHED = new WeakSet();

  const SCRIPT_URL = document.currentScript?.src || "";
  const BASE_URL = SCRIPT_URL.split("/embed-form.js")[0];

  function ensureToastContainer() {
    let t = document.getElementById(TOAST_ID);
    if (!t) {
      t = document.createElement("div");
      t.id = TOAST_ID;
      t.style.position = "fixed";
      t.style.top = "20px";
      t.style.right = "20px";
      t.style.padding = "12px 16px";
      t.style.borderRadius = "8px";
      t.style.boxShadow = "0 8px 24px rgba(0,0,0,0.15)";
      t.style.background = "#e8f5e9";
      t.style.color = "#166534";
      t.style.zIndex = "9999";
      t.style.display = "none";
      t.style.maxWidth = "320px";
      t.style.fontFamily = "Arial, sans-serif";
      t.style.fontSize = "14px";
      document.body.appendChild(t);
    }
    return t;
  }

  function showToast(msg, success) {
    const t = ensureToastContainer();
    t.textContent = msg;
    t.style.background = success ? "#e8f5e9" : "#fee2e2";
    t.style.color = success ? "#166534" : "#991b1b";
    t.style.display = "block";
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.style.display = "none";
    }, 4000);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
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

    try {
      const formData = new FormData(form);
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

      let msg = "Submitted!";
      let ok = res.ok;
      try {
        const json = await res.json();
        if (json.code === "SUBMISSION_LIMIT_REACHED") {
          msg = `⚠️ Submission limit reached (${json.limit} submissions). Please contact the site owner.`;
        } else {
          msg = json.message || (ok ? msg : "Submission failed. Please try again.");
        }
      } catch (_) { }

      showToast(ok ? msg : msg, ok);

      if (ok) form.reset();

    } catch (err) {
      console.error(" Form submission error:", err);
      showToast("Network error: " + err.message, false);
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

    console.log("Attached form:", formId);
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
            // Check if the added node is a form
            if (node.tagName === "FORM") {
              attachToForm(node);
            }
            // Check for forms inside the added node
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

