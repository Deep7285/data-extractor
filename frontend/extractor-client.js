// extractor-client.js — Frontend logic for DataExtract
// Fixes in this version:
//   1. credentials: "include" added to ALL fetch calls (was missing — cookies never sent before)
//   2. Login and logout are now wired to actual Worker API endpoints
//   3. Session state stored in sessionStorage (username only; token lives in httpOnly cookie)
//   4. Trial exhaustion is caught and surfaced with a login prompt
//   5. File validation (type, size) before upload
//   6. Proper loading states and error messages

"use strict";

// ── Config ───────────────────────────────────────────────────────────────────
const WORKER_ENDPOINT = "https://invoice-worker.deepak72855.workers.dev";
const MAX_PAGES       = 10;
const JPEG_QUALITY    = 0.72;
const TARGET_WIDTH    = 1300;
const MAX_FILE_SIZE   = 15 * 1024 * 1024; // 15 MB per file
const ALLOWED_TYPES   = new Set(["application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp"]);

// ── DOM refs (filled after DOMContentLoaded) ──────────────────────────────────
let fileInput, runBtn, resetBtn, downloadBtn, reviewBtn, statusEl, rowCountEl, tableWrap, tableBody;

// ── State ─────────────────────────────────────────────────────────────────────
let allRows = [];       // accumulated extracted rows across files in a session
let isRunning = false;  // prevent double-submit

// ── Session helpers ───────────────────────────────────────────────────────────
function getSessionUser()        { return sessionStorage.getItem("dx_user"); }
function setSessionUser(u)       { sessionStorage.setItem("dx_user", u); }
function clearSessionUser()      { sessionStorage.removeItem("dx_user"); }
function getSessionToken()       { return sessionStorage.getItem("dx_token"); }
function setSessionToken(t)      { sessionStorage.setItem("dx_token", t); }
function clearSessionToken()     { sessionStorage.removeItem("dx_token"); }

// ── Toast notifications ───────────────────────────────────────────────────────
function showToast(message, type = "info", duration = 4000) {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === "success" ? "✓" : type === "error" ? "✕" : "ℹ"}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("toast-visible"));

  setTimeout(() => {
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ── Status display ────────────────────────────────────────────────────────────
function setStatus(msg, type = "neutral") {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className   = `status-msg status-${type}`;
}

function updateRowCount() {
  if (rowCountEl) rowCountEl.textContent = `${allRows.length} row${allRows.length !== 1 ? "s" : ""}`;
}

// ── Auth state sync (updates nav button text) ──────────────────────────────────
function syncAuthUI() {
  const user      = getSessionUser();
  const loginBtn  = document.getElementById("loginBtn");
  const logoutBtn = document.getElementById("logoutBtn");
  const userBadge = document.getElementById("userBadge");

  if (user) {
    loginBtn?.classList.add("hidden");
    logoutBtn?.classList.remove("hidden");
    if (userBadge) { userBadge.textContent = user; userBadge.classList.remove("hidden"); }
  } else {
    loginBtn?.classList.remove("hidden");
    logoutBtn?.classList.add("hidden");
    userBadge?.classList.add("hidden");
  }
}

// ── API: Login ────────────────────────────────────────────────────────────────
async function apiLogin(username, password, honeypot) {
  const resp = await fetch(`${WORKER_ENDPOINT}/api/login`, {
    method:      "POST",
    credentials: "include",          // ← CRITICAL: sends/receives cookies cross-site
    headers:     { "Content-Type": "application/json" },
    body:        JSON.stringify({ username, password, _hp: honeypot })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || `Login failed (${resp.status})`);
  return data; // { ok: true, username }
}

// ── API: Logout ───────────────────────────────────────────────────────────────
async function apiLogout() {
  const token = getSessionToken();
  await fetch(`${WORKER_ENDPOINT}/api/logout`, {
    method:      "POST",
    credentials: "include",
    headers:     token ? { "Authorization": `Bearer ${token}` } : {}
  }).catch(() => {});
  clearSessionUser();
  clearSessionToken();
  syncAuthUI();
  showToast("Logged out successfully", "info");
}

// ── Login modal logic ─────────────────────────────────────────────────────────
function openLoginModal() {
  const modal = document.getElementById("loginModal");
  if (modal) {
    modal.classList.add("show");
    document.getElementById("loginUsername")?.focus();
    clearLoginError();
  }
}

function closeLoginModal() {
  const modal = document.getElementById("loginModal");
  if (modal) modal.classList.remove("show");
}

function setLoginError(msg) {
  const el = document.getElementById("loginError");
  if (el) { el.textContent = msg; el.classList.remove("hidden"); }
}

function clearLoginError() {
  const el = document.getElementById("loginError");
  if (el) el.classList.add("hidden");
}

function setLoginLoading(loading) {
  const btn    = document.getElementById("loginSubmitBtn");
  const spinner = document.getElementById("loginSpinner");
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? "Signing in…" : "Login";
  spinner?.classList.toggle("hidden", !loading);
}

async function handleLoginSubmit() {
  const username  = (document.getElementById("loginUsername")?.value || "").trim();
  const password  = document.getElementById("loginPassword")?.value || "";
  const honeypot  = document.getElementById("loginHp")?.value || ""; // bot trap

  clearLoginError();

  if (!username || !password) {
    setLoginError("Please enter your username and password.");
    return;
  }

  setLoginLoading(true);
  try {
    const data = await apiLogin(username, password, honeypot);
    setSessionUser(data.username);
    if (data.token) setSessionToken(data.token);
    syncAuthUI();
    closeLoginModal();
    showToast(`Welcome back, ${data.username}!`, "success");
  } catch (e) {
    const msg = e.message === "invalid_credentials"
      ? "Incorrect username or password."
      : e.message === "account_expired"
      ? "Your account has expired. Contact the admin."
      : `Login error: ${e.message}`;
    setLoginError(msg);
  } finally {
    setLoginLoading(false);
  }
}

// ── File validation ───────────────────────────────────────────────────────────
function validateFiles(files) {
  const errors = [];
  for (const f of files) {
    const ext = f.name.split(".").pop()?.toLowerCase();
    const isDocx = ext === "docx";
    if (!ALLOWED_TYPES.has(f.type) && !isDocx) {
      errors.push(`${f.name}: unsupported type. Use PDF, JPG, PNG, or DOCX.`);
    }
    if (f.size > MAX_FILE_SIZE) {
      errors.push(`${f.name}: too large (max 15 MB per file).`);
    }
  }
  return errors;
}

// ── PDF → JPEG images ─────────────────────────────────────────────────────────
async function pdfToImages(file) {
  const dataUrl = await fileToDataUrl(file);
  const pdf     = await pdfjsLib.getDocument({ url: dataUrl }).promise;
  const pages   = Math.min(pdf.numPages, MAX_PAGES);
  const out     = [];

  for (let p = 1; p <= pages; p++) {
    const page     = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const scale    = TARGET_WIDTH / viewport.width;
    const vp       = page.getViewport({ scale });
    const canvas   = document.createElement("canvas");
    canvas.width   = Math.floor(vp.width);
    canvas.height  = Math.floor(vp.height);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    out.push(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
  }
  return out;
}

// ── Image → compressed JPEG data URL ─────────────────────────────────────────
async function imageToCompressedDataUrl(file) {
  const dataUrl  = await fileToDataUrl(file);
  const img      = new Image();
  await new Promise(res => { img.onload = res; img.src = dataUrl; });
  const scale    = img.width > TARGET_WIDTH ? TARGET_WIDTH / img.width : 1;
  const canvas   = document.createElement("canvas");
  canvas.width   = Math.floor(img.width  * scale);
  canvas.height  = Math.floor(img.height * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

// ── DOCX → plain text ─────────────────────────────────────────────────────────
async function docxToText(file) {
  const buf    = await file.arrayBuffer();
  const result = await window.mammoth.extractRawText({ arrayBuffer: buf });
  return result.value || "";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── POST to Worker ────────────────────────────────────────────────────────────
async function postToWorker({ imagesDataUrls = [], docText = "" }) {
  const form = new FormData();
  for (const d of imagesDataUrls) form.append("images_dataurl[]", d);
  if (docText?.trim()) form.append("doc_text", docText.trim());

  const token = getSessionToken();
  const resp = await fetch(`${WORKER_ENDPOINT}/api/extract`, {
    method:      "POST",
    credentials: "include",
    headers:     token ? { "Authorization": `Bearer ${token}` } : {},
    body:        form
  });

  if (resp.status === 429) {
    const data = await resp.json().catch(() => ({}));
    // Trial exhausted — prompt login
    if (data.error === "trial_exhausted") {
      showToast("Free trial limit reached. Please login to continue.", "error", 6000);
      openLoginModal();
      throw new Error("trial_exhausted");
    }
    throw new Error(data.hint || "Rate limit exceeded");
  }

  if (resp.status === 403) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.hint || "Access restricted");
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    const data = (() => { try { return JSON.parse(text); } catch { return null; } })();
    throw new Error(data?.hint || data?.error || `Server error (${resp.status})`);
  }

  return resp.json();
}

// ── Build Excel row from extracted JSON ───────────────────────────────────────
function buildExcelRow(json, sourceName) {
  const seller  = json?.seller   ?? {};
  const invoice = json?.invoice  ?? {};
  const amounts = json?.amounts  ?? {};
  const taxes   = Array.isArray(json?.taxes) ? json.taxes : [];

  const taxStr = taxes.map(t =>
    `${t.type} ${t.rate_percent ?? "?"}%: ₹${t.amount ?? "?"}`
  ).join("; ");

  return {
    "Seller Name":     seller.company_name  || "",
    "Seller GSTIN":    seller.gstin         || "",
    "Seller Address":  seller.address       || "",
    "Invoice No.":     invoice.number       || "",
    "Invoice Date":    invoice.date         || "",
    "Transaction ID":  invoice.transaction_id || "",
    "Taxable Amount":  amounts.taxable_amount ?? "",
    "Total Amount":    amounts.total_amount   ?? "",
    "Tax Breakdown":   taxStr               || "",
    "Source File":     sourceName           || ""
  };
}

// ── Render results table ──────────────────────────────────────────────────────
function renderTable(rows) {
  if (!tableBody || !tableWrap) return;
  if (!rows.length) { tableWrap.classList.add("hidden"); return; }

  tableWrap.classList.remove("hidden");
  const cols = Object.keys(rows[0]);

  // Build header once (or refresh)
  const thead = tableWrap.querySelector("thead") || tableBody.parentElement?.querySelector("thead");
  if (thead) {
    thead.innerHTML = `<tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
  }

  tableBody.innerHTML = rows.map(row => `
    <tr>${cols.map(col => `<td>${row[col] ?? ""}</td>`).join("")}</tr>
  `).join("");

  updateRowCount();
}

// ── Download Excel ────────────────────────────────────────────────────────────
function downloadExcel() {
  if (!allRows.length) { showToast("Nothing to download yet.", "info"); return; }
  const ws = XLSX.utils.json_to_sheet(allRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Invoices");
  XLSX.writeFile(wb, `invoices_${Date.now()}.xlsx`);
  showToast("Excel file downloaded!", "success");
}

// ── Reset session ─────────────────────────────────────────────────────────────
function resetSession() {
  allRows = [];
  if (fileInput)    fileInput.value = "";
  if (tableWrap)    tableWrap.classList.add("hidden");
  if (tableBody)    tableBody.innerHTML = "";
  updateRowCount();
  setStatus("Session reset. Upload a new file to begin.", "neutral");
  updateFileList();
}

// ── File list UI ──────────────────────────────────────────────────────────────
function updateFileList() {
  const listEl = document.getElementById("fileList");
  if (!listEl || !fileInput) return;
  const files = Array.from(fileInput.files || []);
  if (!files.length) { listEl.innerHTML = ""; return; }

  listEl.innerHTML = files.map(f => {
    const ext  = f.name.split(".").pop()?.toUpperCase() || "?";
    const size = (f.size / 1024).toFixed(0) + " KB";
    return `<div class="file-chip"><span class="file-ext">${ext}</span>${f.name}<span class="file-size">${size}</span></div>`;
  }).join("");
}

// ── Main extract handler ──────────────────────────────────────────────────────
async function handleExtract() {
  if (isRunning) return;

  const files = Array.from(fileInput?.files || []);
  if (!files.length) { showToast("Please select at least one file first.", "info"); return; }

  // Validate
  const errs = validateFiles(files);
  if (errs.length) { showToast(errs[0], "error", 6000); return; }

  isRunning = true;
  if (runBtn) { runBtn.disabled = true; runBtn.textContent = "Extracting…"; }

  try {
    for (const file of files) {
      setStatus(`Processing ${file.name}…`, "neutral");

      const ext     = file.name.split(".").pop()?.toLowerCase();
      const isDocx  = ext === "docx";
      let payload   = { imagesDataUrls: [], docText: "" };

      if (file.type === "application/pdf") {
        payload.imagesDataUrls = await pdfToImages(file);
      } else if (file.type.startsWith("image/")) {
        payload.imagesDataUrls = [await imageToCompressedDataUrl(file)];
      } else if (isDocx) {
        payload.docText = await docxToText(file);
      } else {
        throw new Error(`Unsupported file type: ${file.name}`);
      }

      const json = await postToWorker(payload);
      allRows.push(buildExcelRow(json, file.name));
      renderTable(allRows);
    }

    setStatus(`Done — ${allRows.length} invoice${allRows.length !== 1 ? "s" : ""} extracted.`, "success");
    showToast(`Extracted ${allRows.length} invoice${allRows.length !== 1 ? "s" : ""} successfully!`, "success");

    if (downloadBtn) downloadBtn.classList.remove("hidden");
    if (reviewBtn)   reviewBtn.classList.remove("hidden");
  } catch (e) {
    if (e.message !== "trial_exhausted") {
      setStatus(`Error: ${e.message}`, "error");
      showToast(`Extraction failed: ${e.message}`, "error");
    }
    console.error("[DataExtract]", e);
  } finally {
    isRunning = false;
    if (runBtn) { runBtn.disabled = false; runBtn.textContent = "Extract Data"; }
  }
}

// ── Drag and drop ─────────────────────────────────────────────────────────────
function initDragDrop() {
  const zone = document.getElementById("dropZone");
  if (!zone || !fileInput) return;

  ["dragenter", "dragover"].forEach(ev => {
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("drag-over"); });
  });
  ["dragleave", "drop"].forEach(ev => {
    zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("drag-over"); });
  });
  zone.addEventListener("drop", e => {
    const dt = e.dataTransfer;
    if (dt?.files?.length) {
      // Assign dropped files to fileInput via DataTransfer
      fileInput.files = dt.files;
      updateFileList();
    }
  });
  // The file input sits inside the zone, so direct clicks on it already work.
  // Only programmatically open the dialog when clicking the zone background — 
  // not when clicking the input itself (which would double-fire the dialog).
  zone.addEventListener("click", (e) => {
    if (e.target !== fileInput) fileInput.click();
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // Wire DOM refs
  fileInput   = document.getElementById("fileInput");
  runBtn      = document.getElementById("runExtract");
  resetBtn    = document.getElementById("resetBtn");
  downloadBtn = document.getElementById("downloadBtn");
  reviewBtn   = document.getElementById("reviewBtn");
  statusEl    = document.getElementById("status");
  rowCountEl  = document.getElementById("rowCount");
  tableWrap   = document.getElementById("tableWrap");
  tableBody   = document.getElementById("tableBody");

  // Restore auth state
  syncAuthUI();
  updateRowCount();

  // Event listeners
  fileInput?.addEventListener("change", updateFileList);
  runBtn?.addEventListener("click", handleExtract);
  resetBtn?.addEventListener("click", resetSession);
  downloadBtn?.addEventListener("click", downloadExcel);

  reviewBtn?.addEventListener("click", () => {
    tableWrap?.scrollIntoView({ behavior: "smooth" });
  });

  // Login modal triggers
  document.getElementById("loginBtn")?.addEventListener("click", openLoginModal);
  document.getElementById("logoutBtn")?.addEventListener("click", apiLogout);
  document.getElementById("loginCancelBtn")?.addEventListener("click", closeLoginModal);
  document.getElementById("loginSubmitBtn")?.addEventListener("click", handleLoginSubmit);

  // Login on Enter key
  document.getElementById("loginPassword")?.addEventListener("keydown", e => {
    if (e.key === "Enter") handleLoginSubmit();
  });

  // Close modal on backdrop click
  document.getElementById("loginModal")?.addEventListener("click", e => {
    if (e.target === document.getElementById("loginModal")) closeLoginModal();
  });

  // Drag and drop
  initDragDrop();
});