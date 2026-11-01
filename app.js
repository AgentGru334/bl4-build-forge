(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const state = {
    dirty: false, loading: false, busy: false,
    build: null, results: [], order: [], links: [],
    selected: new Set(), focused: null, sortKey: "", sortDir: 1,
    buildId: null, fileLabel: "",
    saveDoc: null, saveSource: "", saveRemote: false,
    yamlDoc: null, yamlName: ""
  };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function setStatus(text) { $("status").textContent = text; }
  function markDirty() {
    if (state.loading) return;
    state.dirty = true;
    renderTitle();
  }
  function renderTitle() {
    const name = $("build-name").value.trim() || state.fileLabel || "Unsaved build";
    $("file-name").textContent = name + (state.dirty ? " *" : "");
  }
  function blankBuild() {
    return { Source: $("url").value.trim(), Character: "", Adapter: "manual", Author: "", Level: null, Queries: [], Skills: [], Specializations: [] };
  }
  function shownCode(r) { return BF.isSerial(r) ? r.Serial : (r.Code != null ? r.Code : "NOT FOUND"); }
  function typeOf(r) {
    if (r.ManualCode) return "Manual code";
    if (r.Item) return r.Item.Maker + " " + r.Item.Type;
    if (r.Code != null) return "part · " + Math.round(r.Confidence * 100) + "% match";
    return "";
  }
  function rowClass(r) {
    if (BF.isSerial(r) && r.Alternatives && r.Alternatives.length) return "item alt";
    if (BF.isSerial(r)) return "item";
    if (r.Code != null) return "item part";
    return "item miss";
  }
  function infoOf(r) {
    if (!r) return "";
    if (r.ManualCode) return (r.Label || "Manual code") + (r.Note ? " — " + r.Note : "");
    if (r.Item) {
      const bits = [(r.Label || "") + " — " + (r.Info || "")];
      if (r.Note) bits.push(r.Note);
      if (r.Alternatives && r.Alternatives.length) bits.push("also named this: " + r.Alternatives.slice(0, 3).map((a) => a.Maker + " " + a.Type).join(", "));
      return bits.join("   ·   ");
    }
    if (r.Code != null) return (r.Label || "") + (r.Info ? " — " + r.Info : "") + "  (a part, not a whole item)";
    return '"' + (r.Query || "") + "\" isn't a named legendary in the game data";
  }
  function renderDetail(r) { $("detail").textContent = infoOf(r); }

  function ask(opts) {
    return new Promise((resolve) => {
      const modal = $("modal");
      $("modal-title").textContent = opts.title || "";
      $("modal-body").textContent = opts.body || "";
      const extra = $("modal-extra");
      extra.replaceChildren();
      const input = $("modal-input");
      input.hidden = !opts.input && opts.input !== "";
      input.value = opts.input || "";
      input.readOnly = opts.inputReadOnly !== false && !!opts.inputReadOnly;
      if (opts.input != null) { input.hidden = false; input.readOnly = !!opts.inputReadOnly; }
      const actions = $("modal-actions");
      actions.replaceChildren();
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        modal.hidden = true;
        document.removeEventListener("keydown", onKey);
        resolve(value);
      };
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); finish({ id: "cancel", value: input.value }); }
        if (e.key === "Enter" && opts.input != null && e.target === input) {
          const accent = actions.querySelector(".accent");
          if (accent) accent.click();
        }
      }
      document.addEventListener("keydown", onKey);
      (opts.buttons || [{ id: "ok", label: "OK", kind: "accent" }]).forEach((b) => {
        const btn = el("button", b.kind === "accent" ? "accent" : "", b.label);
        btn.type = "button";
        btn.addEventListener("click", () => finish({ id: b.id, value: input.value }));
        actions.append(btn);
      });
      if (opts.setup) opts.setup(extra, finish);
      modal.hidden = false;
      if (!input.hidden && !input.readOnly) input.focus();
      else if (actions.firstChild) actions.firstChild.focus();
    });
  }
  function warn(title, body) { return ask({ title: title, body: body, buttons: [{ id: "ok", label: "OK", kind: "accent" }] }); }
  function info(title, body) { return warn(title, body); }

  async function copyText(text, what) {
    if (!text) return info("Codes", "Nothing to copy yet.");
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied " + what + " to the clipboard.");
    } catch (e) {
      await ask({
        title: "Copy " + what,
        body: "Select the text below and copy it.",
        input: text,
        inputReadOnly: true,
        buttons: [{ id: "ok", label: "Done", kind: "accent" }]
      });
    }
  }
  function downloadBlob(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2500);
  }
  function downloadText(name, text) { downloadBlob(name, new Blob([text], { type: "text/plain;charset=utf-8" })); }
  function safeName(name) {
    const clean = String(name || "My-build").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() || "My-build";
    return clean.slice(0, 80);
  }

  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("bl4-build-forge", 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains("builds")) req.result.createObjectStore("builds", { keyPath: "id" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function idbAll() {
    return db().then((d) => new Promise((resolve, reject) => {
      const req = d.transaction("builds").objectStore("builds").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }
  function idbGet(id) {
    return db().then((d) => new Promise((resolve, reject) => {
      const req = d.transaction("builds").objectStore("builds").get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }
  function idbPut(record) {
    return db().then((d) => new Promise((resolve, reject) => {
      const tx = d.transaction("builds", "readwrite");
      tx.objectStore("builds").put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function capture() {
    const ordered = state.order.slice();
    state.results.forEach((r) => { if (ordered.indexOf(r) < 0) ordered.push(r); });
    return {
      Url: $("url").value, PageText: $("page").value, SaveUrl: $("save-url").value,
      ItemsOnly: $("items-only").checked, Name: $("build-name").value.trim(),
      Description: $("description").value, Notes: $("notes").value,
      Build: state.build, Results: ordered, Links: state.links
    };
  }

  async function saveBuild(saveAs) {
    if (state.busy) { await warn("Working", "Wait for the current import to finish before saving."); return false; }
    let id = saveAs ? null : state.buildId;
    let name = safeName($("build-name").value.trim() || state.fileLabel || (state.build && state.build.Character) || "My-build");
    if (!id) {
      const choice = await ask({
        title: saveAs ? "Save a copy" : "Save build",
        body: "This stays on this device. You can also download a .bl4build.json file to move it.",
        input: name.replace(/\.bl4build\.json$/i, ""),
        buttons: [{ id: "yes", label: "Save on this device", kind: "accent" }, { id: "cancel", label: "Cancel" }]
      });
      if (choice.id !== "yes") return false;
      name = safeName(choice.value);
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    }
    try {
      const text = BF.serializeBuild(capture());
      if (text.length > 32 * 1024 * 1024) throw new Error("Build file exceeds the 32 MB limit.");
      const prev = state.buildId && state.buildId === id ? await idbGet(id) : null;
      await idbPut({ id: id, name: name, updated: Date.now(), text: text, bak: prev && prev.text && prev.text !== text ? prev.text : (prev && prev.bak) || "" });
      state.buildId = id;
      state.fileLabel = name;
      state.results = capture().Results;
      state.dirty = false;
      if (!$("build-name").value.trim()) $("build-name").value = name;
      renderTitle();
      setStatus("Saved build: " + name);
      return true;
    } catch (e) {
      await warn("Cannot save build", e.message);
      return false;
    }
  }

  async function confirmReplace() {
    if (!state.dirty) return true;
    const choice = await ask({
      title: "Unsaved build",
      body: "Save changes to the current build before continuing?",
      buttons: [
        { id: "yes", label: "Save", kind: "accent" },
        { id: "no", label: "Discard" },
        { id: "cancel", label: "Keep working" }
      ]
    });
    if (choice.id === "cancel") return false;
    if (choice.id === "no") return true;
    return saveBuild(false);
  }

  function restore(saved, label, id) {
    state.loading = true;
    try {
      $("url").value = saved.Url || "";
      $("manual-url").value = saved.Url || "";
      $("page").value = saved.PageText || "";
      $("save-url").value = saved.SaveUrl || "";
      $("build-name").value = saved.Name || "";
      $("description").value = saved.Description || "";
      $("notes").value = saved.Notes || "";
      $("items-only").checked = saved.ItemsOnly !== false;
      state.build = saved.Build || null;
      state.results = saved.Results || [];
      state.links = saved.Links || [];
      state.saveDoc = null;
      state.saveSource = "";
      state.saveRemote = false;
      state.sortKey = "";
      fillLinks();
      showResults();
      state.buildId = id || null;
      state.fileLabel = label || "";
      state.dirty = false;
      renderTitle();
      $("report").textContent = "Opened saved build. Item codes and manual edits restored. Load a character save separately if you want to prepare or export a save.";
      setStatus("Opened " + (label || "build") + " — " + summary());
    } finally { state.loading = false; }
  }

  async function openBuild() {
    if (state.busy) return warn("Working", "Wait for the current import to finish before opening another build.");
    let all = [];
    try { all = await idbAll(); } catch (e) { all = []; }
    all.sort((a, b) => b.updated - a.updated);
    const choice = await ask({
      title: "Open build",
      body: all.length ? "Saved on this device:" : "Nothing is saved on this device yet. Choose a .bl4build.json file instead.",
      buttons: [{ id: "file", label: "Choose file" }, { id: "cancel", label: "Cancel" }],
      setup: function (extra, finish) {
        extra.className = "builds";
        all.forEach((rec) => {
          const b = el("button");
          b.type = "button";
          b.append(el("div", "", rec.name), el("div", "hint", new Date(rec.updated).toLocaleString()));
          b.addEventListener("click", () => finish({ id: "device", record: rec }));
          extra.append(b);
          if (rec.bak) {
            const prev = el("button", "", "Previous version of " + rec.name);
            prev.type = "button";
            prev.addEventListener("click", () => finish({ id: "device", record: { id: rec.id, name: rec.name, text: rec.bak }, previous: true }));
            extra.append(prev);
          }
        });
      }
    });
    if (choice.id === "file") { $("page-file").dataset.mode = "build"; $("page-file").click(); return; }
    if (choice.id !== "device") return;
    try {
      if (choice.record.text.length > 32 * 1024 * 1024) throw new Error("Build file exceeds the 32 MB limit.");
      const saved = BF.deserializeBuild(choice.record.text);
      if (!(await confirmReplace())) return;
      restore(saved, choice.record.name, choice.previous ? null : choice.record.id);
      if (choice.previous) { state.dirty = true; renderTitle(); setStatus("Opened the previous copy of " + choice.record.name + ". Save build to keep it."); }
      showView("codes");
    } catch (e) { await warn("Cannot open build", e.message); }
  }

  async function openBuildText(text, name) {
    try {
      if (text.length > 32 * 1024 * 1024) throw new Error("Build file exceeds the 32 MB limit.");
      const saved = BF.deserializeBuild(text);
      if (!(await confirmReplace())) return;
      restore(saved, name.replace(/\.bl4build\.json$/i, ""), null);
      showView("manual");
    } catch (e) { await warn("Cannot open build", e.message); }
  }

  function summary() {
    const serials = state.results.filter(BF.isSerial).length;
    const missing = state.results.filter((r) => !BF.isSerial(r) && r.Code == null).length;
    const bits = [serials + " item code" + (serials === 1 ? "" : "s") + " ready"];
    if (missing) bits.push(missing + " not found");
    if (state.build && state.build.Level != null) bits.push("level " + Math.min(state.build.Level, BF.levelCap));
    if (state.build && state.build.Character) bits.push(state.build.Character);
    if (state.build && state.build.Author) bits.push("by " + state.build.Author);
    if ($("build-name").value.trim()) bits.push($("build-name").value.trim());
    return bits.join("  ·  ");
  }

  function sortOrder() {
    const key = state.sortKey;
    const dir = state.sortDir;
    const val = (r) => key === "label" ? (r.Label || "") : key === "type" ? typeOf(r) : key === "code" ? shownCode(r) : (r.Query || "");
    state.order.sort((a, b) => val(a).localeCompare(val(b)) * dir);
  }
  function showResults() {
    const only = $("items-only").checked;
    state.order = state.results.filter((r) => !only || BF.isSerial(r) || r.Code == null);
    if (state.sortKey) sortOrder();
    state.selected = new Set(state.order[0] ? [state.order[0]] : []);
    state.focused = state.order[0] || null;
    renderCodes();
    renderDetail(state.focused);
  }
  function renderCodes() {
    const list = $("code-list");
    list.replaceChildren();
    if (!state.order.length) {
      list.append(el("p", "empty", "No codes yet. Import a build, or add codes on the Manual tab."));
      return;
    }
    state.order.forEach((r) => list.append(card(r)));
  }
  function card(r) {
    const article = el("article", rowClass(r) + (state.selected.has(r) ? " picked" : ""));
    const top = el("div", "top");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = state.selected.has(r);
    box.setAttribute("aria-label", "Select " + (r.Label || r.Query || "item"));
    box.addEventListener("change", () => {
      if (box.checked) state.selected.add(r); else state.selected.delete(r);
      article.classList.toggle("picked", box.checked);
      state.focused = r;
      renderDetail(r);
    });
    top.append(box, el("div", "q", r.Query || ""));
    const name = document.createElement("input");
    name.type = "text";
    name.value = r.Label || "";
    name.setAttribute("aria-label", "Item name");
    name.addEventListener("change", () => {
      r.Label = name.value.trim();
      markDirty();
      renderDetail(r);
      setStatus("Item updated. Save build to keep your edits between sessions.");
    });
    const type = el("div", "type", typeOf(r));
    const code = document.createElement("textarea");
    code.className = "code";
    code.value = shownCode(r);
    code.setAttribute("aria-label", "Item code");
    code.addEventListener("blur", () => {
      const value = code.value.trim();
      const old = shownCode(r);
      if (value === old) return;
      try { BF.setManualCode(r, value); }
      catch (e) { code.value = old; warn("Manual item code", e.message); return; }
      if (!r.Label) r.Label = "Manual code";
      article.className = rowClass(r) + (state.selected.has(r) ? " picked" : "");
      type.textContent = typeOf(r);
      let note = article.querySelector(".note");
      if (r.Note) {
        if (!note) { note = el("p", "note", r.Note); article.append(note); }
        else note.textContent = r.Note;
      } else if (note) note.remove();
      markDirty();
      renderDetail(r);
      setStatus("Item updated. Save build to keep your edits between sessions.");
    });
    article.append(top, name, type, code);
    if (r.Note) article.append(el("p", "note", r.Note));
    article.addEventListener("click", (e) => {
      if (e.target === box || e.target === name || e.target === code) return;
      state.focused = r;
      renderDetail(r);
    });
    return article;
  }

  function bulkCodes() {
    const seen = new Set(), out = [];
    state.order.forEach((r) => {
      if (!BF.isSerial(r) || seen.has(r.Serial)) return;
      seen.add(r.Serial);
      out.push(r.Serial);
    });
    return out;
  }
  function selectedCodes() {
    const seen = new Set(), out = [];
    state.order.forEach((r) => {
      if (!state.selected.has(r)) return;
      const code = BF.isSerial(r) ? r.Serial : r.Code;
      if (!code || seen.has(code)) return;
      seen.add(code);
      out.push(code);
    });
    return out;
  }

  function fillLinks() {
    const sel = $("save-links");
    sel.replaceChildren();
    if (!state.links.length) { sel.hidden = true; return; }
    state.links.forEach((link, i) => {
      const o = document.createElement("option");
      o.value = link.Url;
      o.textContent = (link.Label || link.Provider || "Save") + " — " + link.Url;
      if (i === 0) o.selected = true;
      sel.append(o);
    });
    sel.hidden = false;
  }

  async function applyIngest(ing, note) {
    if (!(await confirmReplace())) return;
    state.loading = true;
    if (ing.SourceUrl) { $("url").value = ing.SourceUrl; $("manual-url").value = ing.SourceUrl; }
    $("page").value = String(ing.Text || "").replace(/\r\n/g, "\n");
    state.links = ing.SaveCandidates || [];
    if (ing.AccountIds && ing.AccountIds.length && !$("creator-id").value.trim()) $("creator-id").value = ing.AccountIds[0];
    $("save-url").value = state.links.length ? state.links[0].Url : "";
    $("build-name").value = "";
    $("description").value = "";
    $("notes").value = "";
    fillLinks();
    state.loading = false;
    await resolveText($("page").value, note, true);
  }

  async function resolveText(text, note, approved) {
    if (!text || !String(text).trim()) return warn("Page text", "Import a build, or paste the page text first.");
    if (!approved && !(await confirmReplace())) return;
    if (state.busy) return warn("Busy", "Something is already running — give it a moment.");
    state.busy = true;
    setStatus("Finding items…");
    await new Promise((r) => setTimeout(r, 30));
    try {
      const req = BF.parse(text, $("url").value.trim());
      const rows = BF.resolve(req);
      state.build = req;
      state.results = rows;
      state.buildId = null;
      state.fileLabel = "";
      state.sortKey = "";
      showResults();
      state.dirty = true;
      renderTitle();
      const extra = state.links.length ? "  ·  creator save link found (Save tab)" : "";
      setStatus(summary() + extra + (note ? "  ·  " + note : ""));
      showView("codes");
    } catch (e) {
      await warn("Could not resolve items", e.message);
      setStatus("Failed — " + e.message);
    } finally { state.busy = false; }
  }

  async function importUrl() {
    let u = $("url").value.trim();
    if (!u) return warn("Build URL", "Paste a build page link first.");
    if (!/^https?:/i.test(u)) { u = "https://" + u; $("url").value = u; $("manual-url").value = u; }
    if (state.busy) return warn("Busy", "Something is already running — give it a moment.");
    state.busy = true;
    setStatus("Downloading the build page…");
    try {
      const res = await fetch(u, { redirect: "follow" });
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > 64 * 1024 * 1024) throw new Error("download exceeded the 64 MB limit");
      BF.checkBody(buf, String(res.status), res.headers.get("content-type") || "", "html");
      const html = new TextDecoder().decode(buf);
      const ing = BF.scanHtml(html, res.url || u);
      ing.SourceUrl = res.url || u;
      state.busy = false;
      await applyIngest(ing, "imported via browser");
    } catch (err) {
      state.busy = false;
      const blocked = err instanceof BF.BrowserCheckError || err.name === "BrowserCheckError" || /failed to fetch|network|cors/i.test(err.message || "");
      const message = blocked
        ? "This phone browser can't download that website directly.\n\nOpen the build page, select all, copy, then come back and tap Paste page text. Or use Manual to paste codes you already have."
        : BF.failureSummary(err) + "\n\nYou can still open the page, copy it, and tap Paste page text.";
      const choice = await ask({
        title: blocked ? "Open the page and copy it" : "Couldn't download the page",
        body: message,
        buttons: [{ id: "yes", label: "Open page", kind: "accent" }, { id: "no", label: "Not now" }]
      });
      if (choice.id === "yes") window.open(u, "_blank", "noopener");
      setStatus("Import needs a copied page or the Manual tab.");
    }
  }

  function ingestClipboard(text, html) {
    const ing = BF.scanText(text, $("url").value.trim());
    if (html) {
      const source = /^SourceURL:(https?:\/\/[^\r\n]+)/m.exec(html);
      if (source) ing.SourceUrl = source[1].trim();
      const rich = BF.scanHtml(html, ing.SourceUrl || $("url").value.trim());
      ing.SaveCandidates = rich.SaveCandidates;
      ing.AccountIds = rich.AccountIds;
    }
    return ing;
  }
  async function pastePage() {
    let text = "", html = "";
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          if (item.types.indexOf("text/plain") >= 0) text = await (await item.getType("text/plain")).text();
          if (item.types.indexOf("text/html") >= 0) html = await (await item.getType("text/html")).text();
        }
      } else if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText();
    } catch (e) {
      $("page").focus();
      setStatus("Clipboard blocked. Tap the page text box, paste, then tap Resolve item codes.");
      return;
    }
    if (!text.trim()) {
      $("page").focus();
      return warn("Clipboard", "No text on the clipboard. Open the build page, select all, copy, and try again. Or add codes on the Manual tab.");
    }
    await applyIngest(ingestClipboard(text, html), "from copied page text");
  }

  function readCodes(text) {
    const good = [], bad = [];
    String(text || "").split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      if (!/^@U\S+$/i.test(line)) { bad.push(line); return; }
      try {
        BF.setManualCode(BF.blankResolution(), line);
        good.push(line);
      } catch (e) { bad.push(line + " — " + e.message); }
    });
    return { good: good, bad: bad };
  }
  async function addManualCodes(text) {
    const parsed = readCodes(text);
    if (!parsed.good.length && !parsed.bad.length) return warn("Codes", "Paste one or more @U item codes, one per line.");
    const replace = $("manual-replace").checked;
    if (replace && state.results.length) {
      const choice = await ask({
        title: "Replace codes",
        body: "Replace the current item list with these codes? The name, URL, description, and notes stay.",
        buttons: [{ id: "yes", label: "Replace", kind: "accent" }, { id: "cancel", label: "Cancel" }]
      });
      if (choice.id !== "yes") return;
    }
    const have = new Set();
    if (!replace) state.results.forEach((r) => { if (BF.isSerial(r)) have.add(r.Serial); });
    const rows = [];
    let skipped = 0;
    parsed.good.forEach((code) => {
      if (have.has(code)) { skipped++; return; }
      have.add(code);
      const info = BF.tryParse(code);
      const row = BF.blankResolution();
      BF.setManualCode(row, code);
      row.Query = "Manual";
      row.Section = "manual";
      row.Label = info ? BF.familyName(info.family) + " · lv " + info.level : "Manual code";
      row.FamilyId = info ? info.family : null;
      rows.push(row);
    });
    if (!state.build) state.build = blankBuild();
    else if (!state.build.Adapter || state.build.Adapter === "generic") state.build.Adapter = "manual";
    state.results = replace ? rows : state.results.concat(rows);
    state.sortKey = "";
    showResults();
    markDirty();
    const bits = [];
    if (rows.length) bits.push(rows.length + " code" + (rows.length === 1 ? "" : "s") + " added");
    if (skipped) bits.push(skipped + " already in the build");
    if (parsed.bad.length) bits.push(parsed.bad.length + " rejected");
    $("manual-result").textContent = (bits.join(" · ") || "No new codes.") + (parsed.bad.length ? "\n" + parsed.bad.slice(0, 8).join("\n") : "");
    setStatus(bits.join(" · ") || "No new codes.");
    if (rows.length && !parsed.bad.length) showView("codes");
  }

  function showView(name) {
    ["build", "manual", "codes", "save", "help"].forEach((view) => {
      $("view-" + view).hidden = view !== name;
    });
    document.querySelectorAll("nav button").forEach((btn) => {
      if (btn.dataset.view === name) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    });
    $("dock").hidden = name !== "codes";
    document.documentElement.style.setProperty("--dock", name === "codes" ? "58px" : "0px");
    window.scrollTo(0, 0);
  }

  const HELP = [
    ["Quick start", "QUICK START\n\nFrom a build page\n1. Open the build in your phone browser.\n2. Select all and copy.\n3. Come back here, tap Paste page text, and review the codes.\n4. Tap Copy all, then paste into your save editor.\n5. Tap Save build to keep the work on this device.\n\nFrom codes you already have\nOpen Manual. Add a name, the build URL, a description, and notes. Paste one @U code per line and tap Add codes.\n\nCopy all and Save TXT include complete item codes only. Unresolved rows and partial part tokens are left out."],
    ["Manual builds", "MANUAL BUILDS\n\nUse Manual when you want to save a build without importing a webpage.\n\nBuild name is the label in your on-device list.\nBuild URL is the guide this list belongs to. It is stored with the build and is not downloaded for you.\nDescription is the short summary of the build.\nNotes are for anything you want to remember later.\n\nBulk codes: paste or upload a text file with one complete @U code per line. Add codes keeps codes already on the build. Replace current codes swaps the item list and leaves the name, URL, description, and notes in place.\n\nEach code is checked as a readable item serial. It is not matched to an item name or an author's exact roll. Part tokens and more than one code on a line are rejected.\n\nSave build stores the manual build on this device. Download build file writes a .bl4build.json you can move to another device. The desktop Build Forge 0.8.6 app can open the codes and URL. It does not show the name, description, or notes."],
    ["Import a build", "IMPORT A BUILD\n\nPaste the build URL and tap Import. Phone browsers usually cannot download other websites, so Import will offer to open the page instead.\n\nOpen the page, wait for it to load, select all, and copy. Return here and tap Paste page text. You can also paste straight into the page text box.\n\nLoad saved page reads an HTML or text file you already saved.\n\nYou can edit the page text and tap Resolve item codes again. Resolving replaces the current item rows. Save manual changes first.\n\nCodes are matched from the bundled catalog. A matching item name does not guarantee the exact roll, element, or parts the author used."],
    ["Edit and copy", "EDIT AND COPY CODES\n\nOn Codes, edit the item name or paste one complete @U code into a row. Clear a code to remove it. Part tokens and multiple codes in one box are rejected.\n\nManual codes are marked Manual code. They are checked for serial structure, not against the item name.\n\nTap Page, Item, Type, or Code to sort. Check the rows you want, then tap Copy. Copy all and Save TXT use complete codes in the order on screen and skip identical duplicates.\n\nTurn Items only off to see partial part matches. Those are still excluded from Copy all."],
    ["Save and open", "SAVE AND OPEN BUILDS\n\nSave build keeps the item rows, manual codes, name, description, notes, page text, source URL, and creator save links on this device.\n\nOpen build lists those saves. Choose file opens a .bl4build.json from Files or Drive. Overwriting a device save keeps the previous copy, and Open build can restore it.\n\nAn asterisk next to the name means unsaved changes. Before a new import replaces the build, choose Save, Discard, or Keep working.\n\nBuild files do not include Steam IDs or a loaded character save. Opening a build clears the loaded character save.\n\nSave TXT is a bulk-import list. Save build is the project you reopen here."],
    ["YAML to TXT", "YAML TO TXT\n\nOn the Save tab, tap YAML to TXT and open a decrypted character .yaml or .yml file. Choose Equipped, Backpack, or both, and whether to drop duplicate codes.\n\nThis reads serials already stored in those sections. It does not include the bank, it does not change the original file, and it does not decrypt a .sav."],
    ["Creator save and export", "CREATOR SAVE AND EXPORT\n\nA SAVE FILE link found on a build page is filled in on the Save tab. Download tries to fetch it. If the browser blocks the site, open the link, save the file, then tap Load .sav / YAML.\n\nAn encrypted .sav needs the owner's SteamID64. Use the creator's ID for their save and your ID for your own. A YAML file does not need an ID.\n\nAudit and prepare can change character level, scale item levels, or add the build's codes to the backpack in memory. Nothing is written until Export file. Your ID on the export makes an encrypted .sav. Leave it blank for a YAML download. The file you opened is not changed."],
    ["Themes", "THEMES\n\nThe Theme menu changes colors immediately and is remembered on this device. It does not change the build.\n\nAMW Violet: purple and black.\nTacklebox Tide: ocean teal, mint, and gold.\nArctic Circuit: navy and ice blue.\nEmber Forge: amber and ember red.\nRose Quartz: rose pink and plum.\nGraphite Gold: charcoal and gold.\n\nAdd Build Forge to your home screen from the browser share menu to open it like an app.\n\nDiscord: https://discord.gg/eh4nEpX93H"]
  ];
  function renderHelp() {
    const host = $("view-help");
    host.replaceChildren();
    HELP.forEach((pair, index) => {
      const btn = el("button", "section", pair[0]);
      btn.type = "button";
      const body = el("div", "body", pair[1]);
      body.hidden = index !== 0;
      btn.addEventListener("click", () => { body.hidden = !body.hidden; });
      host.append(btn, body);
    });
  }

  function applyTheme(name) {
    const t = BF.themePalette(name);
    const css = { fieldHi: "field-hi", accentHi: "accent-hi", accentLo: "accent-lo", onAccent: "on-accent" };
    Object.keys(t).forEach((k) => {
      if (k === "name") return;
      document.documentElement.style.setProperty("--" + (css[k] || k), t[k]);
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t.bg;
    try { localStorage.setItem("bl4bf-theme", t.name); } catch (e) { /* private mode */ }
    $("theme").value = t.name;
    setStatus("Theme: " + t.name);
  }

  function audit(title) {
    const serials = state.saveDoc.serials();
    const gear = serials.filter((s) => s.family > 0 && !BF.forbidden.has(s.family));
    const level = state.saveDoc.characterLevel();
    const lines = [title, "File: " + (state.saveSource || "") + (state.saveRemote ? "  (downloaded)" : ""),
      "Save type: " + state.saveDoc.kind() + "   Character level: " + (level == null ? "n/a" : String(level)),
      "Items: " + gear.length + (gear.length ? "   levels " + Math.min.apply(null, gear.map((s) => s.level)) + "–" + Math.max.apply(null, gear.map((s) => s.level)) : "")];
    return lines.join("\n");
  }
  function loadSaveBytes(bytes, name, remote) {
    const id = remote ? $("creator-id").value.trim() : ($("your-id").value.trim() || $("creator-id").value.trim());
    if (!BF.looksYaml(bytes) && !id) {
      throw new Error(remote
        ? "This is an encrypted .sav — enter the creator's SteamID64 and load it again."
        : "This is an encrypted .sav — enter your SteamID64 and load it again.");
    }
    const opened = BF.looksYaml(bytes)
      ? { text: new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, ""), format: "yaml" }
      : BF.decryptSave(bytes, id);
    const doc = new BF.SaveDoc(opened.text);
    doc.Format = opened.format === "yaml" ? "plain" : opened.format;
    state.saveDoc = doc;
    state.saveSource = name;
    state.saveRemote = !!remote;
    $("report").textContent = audit(remote ? "Loaded the build creator's save" : "Loaded save");
    setStatus("Loaded " + name + " (" + doc.kind() + ")");
  }
  async function readFileBytes(file) {
    const buf = await file.arrayBuffer();
    return new Uint8Array(buf);
  }
  function refreshYaml() {
    const codes = state.yamlDoc ? state.yamlDoc.inventoryCodes($("yaml-eq").checked, $("yaml-bp").checked, $("yaml-uniq").checked) : [];
    $("yaml-preview").value = codes.join("\n");
    $("yaml-copy").disabled = $("yaml-save").disabled = !codes.length;
    $("yaml-count").textContent = state.yamlDoc ? codes.length + " codes | " + state.yamlName : "Open or drop a character YAML file.";
  }
  function openYamlText(text, name) {
    if (!BF.looksYaml(new TextEncoder().encode(text))) throw new Error("Choose a decrypted character YAML save.");
    const doc = new BF.SaveDoc(text.replace(/^\uFEFF/, ""));
    if (doc.kind() !== "character") throw new Error("This file is not a character save. Equipped and backpack extraction does not include profile banks.");
    state.yamlDoc = doc;
    state.yamlName = name;
    $("yaml-box").hidden = false;
    refreshYaml();
  }

  async function downloadLinked() {
    const link = $("save-url").value.trim() || (state.links[0] && state.links[0].Url) || "";
    if (!link) return warn("Creator save", "Paste a public save link first.");
    if (state.busy) return warn("Busy", "Something is already running — give it a moment.");
    state.busy = true;
    setStatus("Downloading the creator's save…");
    try {
      const res = await fetch(BF.directDownloadUrl(link));
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!buf.length) throw new Error("Linked save download was empty.");
      const head = new TextDecoder().decode(buf.subarray(0, 200)).trim().toLowerCase();
      const ctype = (res.headers.get("content-type") || "").toLowerCase();
      if ((ctype.indexOf("text/html") >= 0 || head.startsWith("<!doctype html") || head.startsWith("<html")) && !BF.looksLikeTextSave(buf)) {
        throw new Error("The linked file did not resolve to a public save or YAML download.");
      }
      let file = { name: "linked-save", bytes: buf };
      if (buf.length > 3 && buf[0] === 0x50 && buf[1] === 0x4b) {
        const files = BF.unzip(buf);
        file = { name: files[0].name, bytes: files[0].bytes };
      }
      loadSaveBytes(file.bytes, file.name, true);
    } catch (e) {
      const choice = await ask({
        title: "Couldn't download the save",
        body: BF.failureSummary(e) + "\n\nOpen the link in the browser, save the file, then use Load .sav / YAML.",
        buttons: [{ id: "yes", label: "Open link", kind: "accent" }, { id: "no", label: "Not now" }]
      });
      if (choice.id === "yes") window.open(BF.directDownloadUrl(link), "_blank", "noopener");
    } finally { state.busy = false; }
  }

  function prepare() {
    if (!state.saveDoc) return warn("No save", "Load a save first (Save tab).");
    const target = state.build && state.build.Level != null ? Math.min(state.build.Level, BF.levelCap) : null;
    const lines = [audit("Before"), "", "Changes:"];
    if ($("fix-char").checked) {
      if (target == null) lines.push("• character level: build page has no level — left as is");
      else if (state.saveDoc.kind() !== "character") lines.push("• character level: not a character save — skipped");
      else {
        const before = state.saveDoc.characterLevel();
        state.saveDoc.characterLevel(target);
        lines.push("• character level " + before + " → " + target);
      }
    }
    if ($("fix-items").checked && target != null) {
      let n = 0;
      state.saveDoc.serials().forEach((s) => {
        if (s.family <= 0 || BF.forbidden.has(s.family) || s.level === target) return;
        const parsed = BF.tryParse(s.serial);
        if (!parsed) return;
        if (state.saveDoc.setSerial(s, BF.encode(BF.patchLevel(parsed.text, target)))) n++;
      });
      lines.push("• scaled " + n + " item line(s) to level " + target);
    }
    if ($("add-items").checked) {
      const items = state.results.filter(BF.isSerial);
      if (!items.length) lines.push("• no item codes to add — resolve a build or add manual codes first");
      items.forEach((r) => {
        try { lines.push("• " + (r.Label || r.Serial) + " → " + state.saveDoc.addItem(r.Serial)); }
        catch (e) { lines.push("• " + (r.Label || "item") + ": " + e.message); }
      });
    }
    lines.push("", audit("After"), "", "Nothing is written until you tap Export file.");
    $("report").textContent = lines.join("\n");
    setStatus("Prepared — tap Export file to download it.");
  }
  function exportSave() {
    if (!state.saveDoc) return warn("No save", "Load a save first.");
    const id = $("your-id").value.trim();
    const sav = id.length > 0;
    const stem = (state.saveSource ? state.saveSource.replace(/\.[^.]+$/, "") : "BL4Build") + "-prepared" + (sav ? ".sav" : ".yaml");
    try {
      if (sav) downloadBlob(stem, new Blob([BF.encryptSave(state.saveDoc.text(), id, state.saveDoc.Format)], { type: "application/octet-stream" }));
      else downloadText(stem, state.saveDoc.text());
      setStatus("Exported " + stem);
      info("Done", "A download named " + stem + " was created.\n\nThe file you opened was not changed. Keep a backup of any game save you plan to replace.");
    } catch (e) { warn("Export failed", e.message); }
  }

  async function routeFile(file) {
    const name = file.name || "file";
    const ext = (name.split(".").pop() || "").toLowerCase();
    if (file.size > 64 * 1024 * 1024) return warn("File", "That file is larger than 64 MB.");
    if (ext === "json" || /\.bl4build\.json$/i.test(name)) {
      const text = await file.text();
      if (text.indexOf("BL4BuildForge-build") >= 0) return openBuildText(text, name);
    }
    if (ext === "sav" || ext === "zip") {
      try { loadSaveBytes(await readFileBytes(file), name, false); showView("save"); }
      catch (e) { await warn("Cannot open save", e.message); }
      return;
    }
    if (ext === "yaml" || ext === "yml") {
      try {
        const text = await file.text();
        try { openYamlText(text, name); } catch (extract) { /* profile or bank files still load below */ }
        loadSaveBytes(new TextEncoder().encode(text), name, false);
        showView("save");
      } catch (e) { await warn("Cannot open YAML", e.message); }
      return;
    }
    const text = await file.text();
    if (text.indexOf("BL4BuildForge-build") >= 0) return openBuildText(text, name);
    const current = document.querySelector("nav button[aria-current='page']");
    if (current && current.dataset.view === "manual" && /@U/i.test(text)) {
      $("manual-codes").value = text;
      return addManualCodes(text);
    }
    const ing = (ext === "html" || ext === "htm" || ext === "mhtml" || ext === "mht") ? BF.scanHtml(text, $("url").value.trim()) : BF.scanText(text, $("url").value.trim());
    await applyIngest(ing, "from " + name);
  }

  function wire() {
    document.querySelectorAll("nav button").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));
    $("theme").addEventListener("change", () => applyTheme($("theme").value));
    $("import").addEventListener("click", importUrl);
    $("url").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); importUrl(); } });
    $("url").addEventListener("input", () => { if ($("manual-url").value !== $("url").value) $("manual-url").value = $("url").value; markDirty(); });
    $("manual-url").addEventListener("input", () => { if ($("url").value !== $("manual-url").value) $("url").value = $("manual-url").value; markDirty(); });
    $("open-page").addEventListener("click", () => {
      const u = $("url").value.trim();
      if (!u) return warn("Build URL", "Paste a build page link first.");
      window.open(/^https?:/i.test(u) ? u : "https://" + u, "_blank", "noopener");
    });
    $("paste").addEventListener("click", pastePage);
    $("page").addEventListener("paste", (e) => {
      const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
      const html = e.clipboardData ? e.clipboardData.getData("text/html") : "";
      if (!text) return;
      e.preventDefault();
      applyIngest(ingestClipboard(text, html), "from copied page text");
    });
    $("page").addEventListener("input", markDirty);
    $("load-page").addEventListener("click", () => { $("page-file").dataset.mode = "page"; $("page-file").click(); });
    $("page-file").addEventListener("change", () => {
      const file = $("page-file").files && $("page-file").files[0];
      $("page-file").value = "";
      if (file) routeFile(file);
    });
    $("resolve").addEventListener("click", () => resolveText($("page").value, null, false));
    ["build-name", "description", "notes", "save-url"].forEach((id) => $(id).addEventListener("input", markDirty));
    $("items-only").addEventListener("change", () => { markDirty(); showResults(); });
    $("sorts").addEventListener("click", (e) => {
      const key = e.target && e.target.dataset && e.target.dataset.sort;
      if (!key) return;
      if (state.sortKey === key) state.sortDir *= -1;
      else { state.sortKey = key; state.sortDir = 1; }
      sortOrder();
      renderCodes();
    });
    $("save-build").addEventListener("click", () => saveBuild(false));
    $("save-as").addEventListener("click", () => saveBuild(true));
    $("open-build").addEventListener("click", openBuild);
    $("manual-save").addEventListener("click", () => saveBuild(false));
    $("manual-save-as").addEventListener("click", () => saveBuild(true));
    $("manual-open").addEventListener("click", openBuild);
    $("download-build").addEventListener("click", () => {
      const name = safeName($("build-name").value.trim() || state.fileLabel || "My-build") + ".bl4build.json";
      downloadText(name, BF.serializeBuild(capture()));
      setStatus("Downloaded " + name);
    });
    $("add-codes").addEventListener("click", () => addManualCodes($("manual-codes").value));
    $("upload-codes").addEventListener("click", () => $("manual-file").click());
    $("manual-file").addEventListener("change", async () => {
      const file = $("manual-file").files && $("manual-file").files[0];
      $("manual-file").value = "";
      if (!file) return;
      const text = await file.text();
      $("manual-codes").value = $("manual-codes").value.trim() ? $("manual-codes").value.replace(/\s*$/, "\n") + text : text;
      addManualCodes(text);
    });
    $("copy-one").addEventListener("click", () => {
      const codes = selectedCodes();
      copyText(codes.join("\n"), codes.length === 1 ? "1 code" : codes.length + " codes");
    });
    $("copy-all").addEventListener("click", () => {
      const codes = bulkCodes();
      copyText(codes.join("\n"), codes.length === 1 ? "1 code" : codes.length + " codes");
    });
    $("save-txt").addEventListener("click", () => {
      const codes = bulkCodes();
      if (!codes.length) return warn("Codes", "Add or resolve a build first.");
      const stem = "BL4BuildForge" + (state.build && state.build.Character ? "-" + state.build.Character : "") + "-codes.txt";
      downloadText(stem, codes.join("\n"));
      setStatus("Saved " + stem);
    });
    $("save-links").addEventListener("change", () => { $("save-url").value = $("save-links").value; markDirty(); });
    $("download-save").addEventListener("click", downloadLinked);
    $("load-linked").addEventListener("click", downloadLinked);
    $("load-save").addEventListener("click", () => $("save-file").click());
    $("save-file").addEventListener("change", async () => {
      const file = $("save-file").files && $("save-file").files[0];
      $("save-file").value = "";
      if (!file) return;
      try { loadSaveBytes(await readFileBytes(file), file.name, false); }
      catch (e) { await warn("Cannot open save", e.message); }
    });
    $("yaml-btn").addEventListener("click", () => { $("yaml-box").hidden = false; $("yaml-file").click(); });
    $("yaml-open").addEventListener("click", () => $("yaml-file").click());
    $("yaml-file").addEventListener("change", async () => {
      const file = $("yaml-file").files && $("yaml-file").files[0];
      $("yaml-file").value = "";
      if (!file) return;
      try { openYamlText(await file.text(), file.name); }
      catch (e) { await warn("Cannot read YAML", e.message); }
    });
    ["yaml-eq", "yaml-bp", "yaml-uniq"].forEach((id) => $(id).addEventListener("change", refreshYaml));
    $("yaml-copy").addEventListener("click", () => copyText($("yaml-preview").value, "inventory codes"));
    $("yaml-save").addEventListener("click", () => {
      const stem = (state.yamlName || "inventory").replace(/\.[^.]+$/, "") + "-inventory-codes.txt";
      downloadText(stem, $("yaml-preview").value);
      $("yaml-count").textContent = "Saved " + stem;
    });
    $("prepare").addEventListener("click", prepare);
    $("export").addEventListener("click", exportSave);
    document.addEventListener("keydown", (e) => {
      if (e.key === "F1") { e.preventDefault(); showView("help"); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveBuild(e.shiftKey); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") { e.preventDefault(); openBuild(); }
    });
    window.addEventListener("beforeunload", (e) => {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = "";
    });
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) routeFile(file);
    });
    showResults();
    renderTitle();
  }

  async function boot() {
    try {
      if (typeof DecompressionStream !== "function") throw new Error("This browser cannot open the item catalog.");
      const raw = Uint8Array.from(atob(self.BF_GZIP_B64), (c) => c.charCodeAt(0));
      const json = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
      BF.loadData(JSON.parse(json));
    } catch (e) {
      $("boot").textContent = "The item catalog did not load. " + (e && e.message ? e.message : "");
      return;
    }
    let theme = "AMW Violet";
    try { theme = localStorage.getItem("bl4bf-theme") || theme; } catch (e) { /* private mode */ }
    BF.themeNames.forEach((name) => {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      $("theme").append(o);
    });
    applyTheme(theme);
    renderHelp();
    wire();
    $("boot").hidden = true;
    setStatus("Ready  ·  " + BF.itemCount() + " named legendaries / pearlescents loaded");
  }
  boot();
})();
