(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = document.documentElement;

  /* theme: saved choice wins, otherwise the system setting */
  try { var saved = localStorage.getItem("gnosis-theme"); if (saved === "dark" || saved === "light") root.setAttribute("data-theme", saved); } catch (e) {}
  var tt = $("#tt");
  if (tt) tt.addEventListener("click", function () {
    var cur = root.getAttribute("data-theme");
    if (!cur) cur = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    var next = cur === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("gnosis-theme", next); } catch (e) {}
  });


  /* usage analytics: live site only. Sends page views, downloads and form use to this site's own Worker.
     Never sends anything you type. Off elsewhere, and when the browser sends Do Not Track or Global Privacy Control. */
  var TRACK = /(^|\.)promintal\.com$/.test(location.hostname) && !window.__nt &&
    navigator.doNotTrack !== "1" && !navigator.globalPrivacyControl;
  var rid = function () { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12); };
  var VID = null;
  try { VID = localStorage.getItem("gnosis.vid"); } catch (e) {}
  if (!VID || !/^[A-Za-z0-9-]{8,64}$/.test(VID)) { VID = rid(); try { localStorage.setItem("gnosis.vid", VID); } catch (e) {} }
  var SID = rid();
  var track = function (type, meta) {
    if (!TRACK) return;
    try {
      var body = JSON.stringify({ type: type, vid: VID, sid: SID, path: location.pathname, ref: type === "pageview" ? document.referrer.slice(0, 300) : "", meta: meta || "" });
      if (navigator.sendBeacon && navigator.sendBeacon("/api/event", new Blob([body], { type: "application/json" }))) return;
      fetch("/api/event", { method: "POST", headers: { "content-type": "application/json" }, body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
  };
  window.gnosisTrack = track;
  track("pageview");
  setInterval(function () { if (document.visibilityState === "visible") track("heartbeat"); }, 30000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") track("heartbeat"); });
  $$('a[href*="downloads/"]').forEach(function (a) {
    a.addEventListener("click", function () { track("download", /Mac-App/.test(a.getAttribute("href")) ? "mac-app" : "package"); });
  });

  /* hero: screenshot tilts toward the pointer */
  var shot = $("#shot");
  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (shot && !calm) {
    var host = shot.parentElement.parentElement;
    host.addEventListener("mousemove", function (e) {
      var r = host.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      shot.style.setProperty("--ry", (x * 9).toFixed(2) + "deg");
      shot.style.setProperty("--rx", (-y * 6).toFixed(2) + "deg");
    });
    host.addEventListener("mouseleave", function () { shot.style.setProperty("--ry", "0deg"); shot.style.setProperty("--rx", "0deg"); });
  }

  /* privacy demo: what you write vs what the cloud receives */
  var dt = $("#demo-text");
  if (dt) {
    var you = 'Remind <b>Priya Nair</b> at <b>priya.nair@example.com</b> or on <b>028 9012 3456</b> that the grant claim is due on Friday, and keep it friendly.';
    var cloud = 'Remind <span class="ph">[TERM_1]</span> at <span class="ph">[EMAIL_1]</span> or on <span class="ph">[PHONE_1]</span> that the grant claim is due on Friday, and keep it friendly.';
    var notes = {
      you: "This is what you type. It stays on your computer unless you choose the cloud for this message.",
      cloud: "You see this preview before sending. When the reply comes back, Gnosis puts the real name, email and number back in."
    };
    var dn = $("#demo-note"), b1 = $("#b-you"), b2 = $("#b-cloud");
    var show = function (w) {
      dt.innerHTML = w === "you" ? you : cloud; dn.textContent = notes[w];
      b1.setAttribute("aria-pressed", w === "you"); b2.setAttribute("aria-pressed", w === "cloud");
    };
    b1.addEventListener("click", function () { show("you"); });
    b2.addEventListener("click", function () { show("cloud"); });
    show("you");
  }

  /* try-it simulator (a small in-browser example, not the real model) */
  var sim = $("#sim");
  if (sim) {
    var mem = [
      "My coaching clients are mostly career changers aged 30 to 45.",
      "Tuesday coaching prep: review the CV workshop slides.",
      "The grant claim is due on Friday."
    ];
    var list = $("#notes"), log = $("#log"), form = $("#ask-form"), q = $("#ask-q"), busy = false;
    var stop = /^(the|and|for|what|who|when|how|are|is|was|my|me|to|of|on|in|a|an|do|does|did|about|with|that|this|have|has|i)$/;
    var words = function (t) { return (t.toLowerCase().match(/[a-z0-9']+/g) || []).filter(function (w) { return w.length > 2 && !stop.test(w); }); };
    var stem = function (w) { return w.replace(/(ing|ed|es|s)$/, ""); };
    var renderNotes = function (hit) {
      list.textContent = "";
      mem.forEach(function (t, i) {
        var li = document.createElement("li"); li.id = "note-" + (i + 1);
        if (hit && hit.indexOf(i) > -1) li.className = "hit";
        var b = document.createElement("b"); b.textContent = i + 1;
        var s = document.createElement("span"); s.textContent = t;
        li.appendChild(b); li.appendChild(s); list.appendChild(li);
      });
    };
    var add = function (cls, text) { var d = document.createElement("div"); d.className = "bubble " + cls; d.textContent = text; log.appendChild(d); return d; };
    var find = function (question) {
      var qw = words(question).map(stem), best = -1, score = 0;
      mem.forEach(function (t, i) {
        var tw = words(t).map(stem), s = 0;
        qw.forEach(function (w) { if (tw.indexOf(w) > -1) s++; });
        if (s > score) { score = s; best = i; }
      });
      return best;
    };
    var ask = function (question) {
      question = question.trim(); if (!question || busy) return;
      busy = true; add("me", question); track("tryit", "ask");
      var st = add("bot step", "Searching your memory on this computer...");
      setTimeout(function () {
        var i = find(question);
        if (i < 0) {
          st.textContent = "Searched 3 notes. Nothing matched.";
          add("bot", "I could not find that in your example memory. Try adding a note on the left, then ask again.");
          renderNotes(); busy = false; return;
        }
        st.textContent = "Found note " + (i + 1) + ". Writing the answer on this computer...";
        setTimeout(function () {
          var d = add("bot", "From your notes: " + mem[i] + " ");
          var c = document.createElement("button"); c.type = "button"; c.className = "cite-btn"; c.textContent = i + 1;
          c.setAttribute("aria-label", "Show source note " + (i + 1));
          c.addEventListener("click", function () { var n = $("#note-" + (i + 1)); if (n) { n.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" }); } renderNotes([i]); });
          d.appendChild(c); renderNotes([i]); busy = false;
        }, calm ? 0 : 600);
      }, calm ? 0 : 500);
    };
    $$(".chip", sim).forEach(function (c) { c.addEventListener("click", function () { ask(c.textContent); }); });
    form.addEventListener("submit", function (e) { e.preventDefault(); ask(q.value); q.value = ""; });
    var nf = $("#add-note-form"), ni = $("#add-note");
    nf.addEventListener("submit", function (e) {
      e.preventDefault(); var v = ni.value.trim(); if (!v || mem.length >= 8) return;
      mem.push(v.slice(0, 200)); ni.value = ""; renderNotes([mem.length - 1]);
      add("bot step", "Saved to memory as note " + mem.length + ".");
    });
    renderNotes();
  }

  /* tabs */
  $$("[data-tabs]").forEach(function (box) {
    var btns = $$('[role="tab"]', box), panels = $$('[role="tabpanel"]', box.closest('section'));
    var pick = function (id) {
      btns.forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-tab") === id); });
      panels.forEach(function (p) { p.hidden = p.id !== "panel-" + id; });
    };
    btns.forEach(function (b) { b.addEventListener("click", function () { pick(b.getAttribute("data-tab")); }); });
    var guess = /Win/i.test(navigator.platform || "") ? "win" : "mac";
    if (btns.some(function (b) { return b.getAttribute("data-tab") === guess; })) pick(guess);
  });

  /* set-up checklist progress */
  var cl = $("#checklist");
  if (cl) {
    var boxes = $$("input", cl), bar = $("#bar i"), txt = $("#progress");
    var upd = function () {
      var n = boxes.filter(function (b) { return b.checked; }).length;
      bar.style.width = Math.round(n / boxes.length * 100) + "%";
      txt.textContent = n === boxes.length ? "All set. Open Gnosis and say hello." : n + " of " + boxes.length + " done";
    };
    boxes.forEach(function (b) { b.addEventListener("change", upd); }); upd();
  }

  /* FAQ search */
  var fq = $("#faq-q");
  if (fq) {
    var items = $$(".faq details"), none = $("#faq-none");
    fq.addEventListener("input", function () {
      var t = fq.value.toLowerCase().trim(), shown = 0;
      items.forEach(function (d) {
        var ok = !t || d.textContent.toLowerCase().indexOf(t) > -1;
        d.hidden = !ok; if (ok) shown++;
        if (t && ok) d.open = true; else if (!t) d.open = false;
      });
      none.hidden = shown > 0;
    });
  }

  /* forms: send the request through this site's Worker (Resend). If that is not available, fall back to an email draft. */
  $$("form[data-mail]").forEach(function (form) {
    var out = $("#" + form.getAttribute("data-result"));
    var sent = $(".sent", out), draft = $(".draft", out), btn = $("button[type=submit]", form);
    var to = "info@promintal.co.uk";
    var kind = form.id === "demo-form" ? "demo" : "contact";
    var clear = function () { $$(".err", form).forEach(function (e) { e.textContent = ""; }); };
    var reveal = function () { out.hidden = false; out.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" }); };
    form.addEventListener("submit", function (e) {
      e.preventDefault(); clear();
      var bad = false;
      $$("[data-required]", form).forEach(function (f) {
        var v = (f.value || "").trim(), er = $("#err-" + f.id, form);
        if (!v) { if (er) er.textContent = "Please fill this in."; bad = bad || f; }
        else if (f.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v)) { if (er) er.textContent = "Enter an email address like name@company.com."; bad = bad || f; }
      });
      if (bad) { bad.focus(); return; }
      var fields = [], name = "", email = "";
      $$("[data-label]", form).forEach(function (f) {
        var v;
        if (f.type === "checkbox") { if (!f.checked) return; v = "yes"; } else v = (f.value || "").trim();
        if (!v) return;
        var l = f.getAttribute("data-label");
        if (l === "Name") name = v; if (l === "Email") email = v;
        fields.push([l, v]);
      });
      var subject = form.getAttribute("data-subject"), body = fields.map(function (p) { return p[0] + ": " + p[1]; }).join("\n");
      $("textarea", draft).value = "To: " + to + "\nSubject: " + subject + "\n\n" + body;
      $("a.open", draft).setAttribute("href", "mailto:" + to + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body));
      var hp = $('input[name="website"]', form);
      var showDraft = function () { sent.hidden = true; draft.hidden = false; reveal(); };
      var showSent = function () { draft.hidden = true; sent.hidden = false; form.reset(); reveal(); };
      var label = btn.textContent; btn.disabled = true; btn.textContent = "Sending...";
      var ctl = window.AbortController ? new AbortController() : null, timer = setTimeout(function () { if (ctl) ctl.abort(); }, 10000);
      fetch("/api/request", { method: "POST", headers: { "content-type": "application/json" }, signal: ctl ? ctl.signal : undefined,
        body: JSON.stringify({ kind: kind, name: name, email: email, fields: fields, website: hp ? hp.value : "" }) })
        .then(function (r) { if (!r.ok) return r.json().catch(function () { return {}; }).then(function (d) { var er = new Error("status " + r.status); er.reason = d.reason || ""; throw er; }); track("lead", kind); showSent(); })
        .catch(function (er) { var rs = $(".reason", draft); if (rs) rs.textContent = er && er.reason ? "Reason: " + er.reason : ""; showDraft(); })
        .then(function () { clearTimeout(timer); btn.disabled = false; btn.textContent = label; });
    });
    var cp = $("button.copy", draft);
    cp.addEventListener("click", function () {
      var ta = $("textarea", draft), ok = function () { cp.textContent = "Copied"; setTimeout(function () { cp.textContent = "Copy message"; }, 1800); };
      var fallback = function () { ta.select(); try { document.execCommand("copy"); ok(); } catch (x) { cp.textContent = "Press Ctrl+C to copy"; } };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(ok, fallback); else fallback();
    });
  });
})();
