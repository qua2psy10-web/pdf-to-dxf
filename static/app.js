"use strict";
const $ = (id) => document.getElementById(id);
const state = { file: null, page: 1, mode: "pdf", busy: false, generation: 0, imageUrl: null, report: null, info: null };
let previewAbort;
let debounce;

function status(message, type = "") {
  $("status").textContent = message;
  $("status").className = `status ${type}`;
}

function validScale() { return $("scale").value !== "" && $("scale").checkValidity(); }

function tracing() { return !!$("trace-mode") && $("trace-mode").value !== "off"; }

function updateButtons() {
  $("export-button").disabled = !state.file || state.busy || !validScale() || ((state.info?.kind === "empty" || (state.info?.kind === "image" && state.info?.texts === 0 && !tracing())) && $("output-pages").value !== "all");
  for (const id of ["trace-mode", "trace-threshold"]) if ($(id)) $(id).disabled = state.busy;
  $("page-select").disabled = !state.file || state.busy;
  $("next-page").disabled = !state.file || state.busy || state.page >= state.file.pages;
  $("sample-button").disabled = state.busy;
  $("empty-sample").disabled = state.busy;
  $("file-input").disabled = state.busy;
  for (const id of ["scale", "include-text", "keep-colors", "output-pages", "tab-pdf", "tab-dxf"]) $(id).disabled = state.busy;
}

function parameters() {
  return new URLSearchParams({ page: state.page, scale: $("scale").value,
    text: $("include-text").checked ? "1" : "0", colors: $("keep-colors").checked ? "1" : "0", mode: state.mode, trace: $("trace-mode")?.value || "off", threshold: $("trace-threshold")?.value || "180" });
}

async function responseOrError(response) {
  if (!response.ok) {
    let message = `処理に失敗しました（${response.status}）。`;
    try { message = (await response.json()).error || message; } catch { /* non-JSON HTTP error */ }
    throw new Error(message);
  }
  return response;
}

function showWarnings(items) {
  $("warning-list").replaceChildren(...items.map(text => {
    const li = document.createElement("li"); li.textContent = text; return li;
  }));
  $("warnings").hidden = !items.length;
}

async function loadPDF(file) {
  if (state.busy) return;
  if (file && !file.name.toLowerCase().endsWith(".pdf")) { status("PDFファイルを選択してください。", "error"); return; }
  if (file && file.size > 50 * 1024 * 1024) { status("50MB以下のPDFを選択してください。", "error"); return; }
  state.busy = true; updateButtons(); status("PDFを読み込んでいます…");
  // Invalidate pending previews before a replacement upload begins.
  state.generation++; previewAbort?.abort();
  try {
    const body = new FormData();
    if (file) body.append("file", file);
    const response = await responseOrError(await fetch(file ? "/api/upload" : "/api/sample", { method: "POST", headers: { "X-Trace-Client": "1" }, body: file ? body : undefined }));
    state.file = await response.json(); state.page = 1; state.mode = "pdf"; state.info = state.file.first; state.report = null;
    $("page-select").replaceChildren(...Array.from({ length: state.file.pages }, (_, i) => new Option(`${i + 1} / ${state.file.pages} ページ`, i + 1)));
    $("file-name").textContent = state.file.name;
    $("file-meta").textContent = `${state.file.pages}ページ${file ? ` · ${(file.size / 1024 / 1024).toFixed(2)} MB` : " · サンプル"}`;
    $("file-details").hidden = false;
    $("drop-title").textContent = "別のPDFに変更";
    $("tab-pdf").setAttribute("aria-selected", "true"); $("tab-dxf").setAttribute("aria-selected", "false");
    status("PDFを読み込みました。縮尺を確認してください。", "success");
  } catch (error) { status(error.message, "error"); }
  finally { state.busy = false; $("file-input").value = ""; updateButtons(); }
  if (state.file) await refreshPreview();
}

function sizeLabel(info) {
  const short = Math.min(info.width_mm, info.height_mm), long = Math.max(info.width_mm, info.height_mm);
  const paper = [["A0", 841, 1189], ["A1", 594, 841], ["A2", 420, 594], ["A3", 297, 420], ["A4", 210, 297]].find(([, a, b]) => Math.abs(short - a) < 2 && Math.abs(long - b) < 2);
  return `${paper ? paper[0] + (info.width_mm > info.height_mm ? " 横" : " 縦") + " · " : ""}${info.width_mm} × ${info.height_mm} mm`;
}

async function refreshPreview() {
  if (!state.file) return;
  const generation = ++state.generation;
  previewAbort?.abort(); previewAbort = new AbortController();
  if (state.mode === "dxf" && !validScale()) {
    $("preview-loading").hidden = true; $("preview-image").hidden = true; $("empty-state").hidden = false;
    status("縮尺を0.001〜100000の範囲で入力してください。", "error"); return;
  }
  $("preview-loading").hidden = false;
  $("entity-count").textContent = "";
  $("preview-image").hidden = true;
  const base = `/api/files/${state.file.id}`;
  const query = parameters();
  try {
    const infoResponse = await responseOrError(await fetch(`${base}/page?${query}`, { signal: previewAbort.signal }));
    const info = await infoResponse.json();
    if (generation !== state.generation) return;
    state.info = info;
    $("page-size").textContent = sizeLabel(info);
    $("entity-count").textContent = `${info.paths.toLocaleString()}図形 · ${info.texts.toLocaleString()}文字列`;
    showWarnings(info.images ? ["画像を含むPDFです。画像部分はDXFに変換されません。"] : []);
    if (info.images && tracing()) {
      showWarnings([info.paths ? "ベクトル線と画像を含むページです。画像も変換するには「ページ全体をトレース」を選択してください。" : "スキャン画像を検出しました。DXFタブで輪郭を確認し、読み取りの濃さを調整してください。"]);
    }
    if (!info.paths && info.images && !tracing()) {
      showWarnings(["線を抽出できない画像PDFです。スキャン図面の自動トレースには対応していません。" + (info.texts ? "文字のみ変換できる場合があります。" : "")]);
      status("スキャン画像から線を抽出する機能には対応していません。", "error");
    }
    if (state.mode === "dxf") {
      const response = await responseOrError(await fetch(`${base}/report?${query}`, { signal: previewAbort.signal }));
      const report = await response.json();
      if (generation !== state.generation) return;
      state.report = report;
      showWarnings(report.warnings);
      $("entity-count").textContent = `${report.entities.toLocaleString()}要素 · 1:${report.scale}`;
    }
    const response = await responseOrError(await fetch(`${base}/preview?${query}`, { signal: previewAbort.signal }));
    const blob = await response.blob();
    if (generation !== state.generation) return;
    const nextUrl = URL.createObjectURL(blob);
    const img = $("preview-image");
    try { img.src = nextUrl; await img.decode(); }
    catch (error) { URL.revokeObjectURL(nextUrl); throw error; }
    if (generation !== state.generation) { URL.revokeObjectURL(nextUrl); return; }
    if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
    state.imageUrl = nextUrl;
    img.hidden = false; $("empty-state").hidden = true;
  } catch (error) {
    if (error.name !== "AbortError" && generation === state.generation) {
      status(error.message, "error");
      $("preview-image").hidden = true;
      $("empty-state").hidden = false;
    }
  } finally {
    if (generation === state.generation) { $("preview-loading").hidden = true; updateButtons(); }
  }
}

async function exportDXF() {
  if (!state.file || state.busy) return;
  if (!validScale()) { $("scale").reportValidity(); return; }
  state.busy = true; updateButtons(); status("DXFを作成しています…");
  $("export-button").querySelector("span").textContent = "変換中…";
  const all = $("output-pages").value === "all";
  const query = parameters(); query.set("all", all ? "1" : "0");
  try {
    if (!all) {
      const report = await (await responseOrError(await fetch(`/api/files/${state.file.id}/report?${query}`))).json();
      showWarnings(report.warnings);
    }
    const response = await responseOrError(await fetch(`/api/files/${state.file.id}/export?${query}`));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stem = state.file.name.replace(/\.pdf$/i, "");
    link.href = url; link.download = all ? `${stem}_DXF.zip` : `${stem}_p${state.page}.dxf`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    const skipped = Number(response.headers.get("X-Trace-Skipped") || 0);
    status(skipped ? `${skipped}ページをスキップしてZIPを作成しました。ZIP内の変換結果.jsonを確認してください。` : `${all ? "全ページのZIP" : "DXF"}を作成しました。ダウンロード先を確認してください。`, skipped ? "error" : "success");
  } catch (error) { status(error.message, "error"); }
  finally { state.busy = false; $("export-button").querySelector("span").textContent = "DXFを書き出す"; updateButtons(); }
}

$("file-input").addEventListener("change", event => { if (event.target.files[0]) loadPDF(event.target.files[0]); });
for (const id of ["sample-button", "empty-sample"]) $(id).addEventListener("click", () => loadPDF());
$("export-button").addEventListener("click", exportDXF);
$("page-select").addEventListener("change", () => { state.page = Number($("page-select").value); refreshPreview(); });
$("next-page").addEventListener("click", () => { if (state.page < state.file.pages) { state.page++; $("page-select").value = state.page; refreshPreview(); } });
for (const mode of ["pdf", "dxf"]) $("tab-" + mode).addEventListener("click", () => {
  state.mode = mode;
  for (const type of ["pdf", "dxf"]) $("tab-" + type).setAttribute("aria-selected", String(type === mode));
  refreshPreview();
});
$("scale").addEventListener("input", () => {
  const valid = validScale();
  $("scale-help").textContent = valid ? `用紙上の長さを${Number($("scale").value).toLocaleString()}倍して出力` : "0.001〜100000の数値を入力";
  updateButtons(); clearTimeout(debounce);
  if (valid && state.mode === "dxf") debounce = setTimeout(refreshPreview, 350);
});
for (const id of ["include-text", "keep-colors"]) $(id).addEventListener("change", () => { if (state.mode === "dxf") refreshPreview(); });
$("output-pages").addEventListener("change", updateButtons);
const dropzone = $("dropzone");
for (const type of ["dragenter", "dragover"]) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.add("dragover"); });
for (const type of ["dragleave", "drop"]) dropzone.addEventListener(type, event => { event.preventDefault(); dropzone.classList.remove("dragover"); });
dropzone.addEventListener("drop", event => { if (event.dataTransfer.files[0]) loadPDF(event.dataTransfer.files[0]); });
// Prevent a dropped PDF outside the target from replacing the app page.
window.addEventListener("dragover", event => event.preventDefault());
window.addEventListener("drop", event => event.preventDefault());

for (const id of ["trace-mode", "trace-threshold"]) $(id)?.addEventListener("change", () => {
  updateButtons();
  if(state.file) refreshPreview();
});
