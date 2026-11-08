// Leaving Soon - runs inside the Jellyfin web client (injected into index.html by
// contrib/jellyfin-leaving-soon-init.sh, served by the plugin at /LeavingSoon/client.js).
//
// Adds a countdown banner to the detail page of a movie/series Maintainerr is about to delete, and a
// "D-12" badge on their posters wherever cards are rendered. Read-only: nothing here talks to
// Maintainerr, the plugin does that server-side and exposes /LeavingSoon/Items to signed-in users.
// No module syntax: this must load in every browser the web client supports.
(function () {
  "use strict";

  var BASE = window.location.pathname.replace(/\/web\/?.*$/, "");
  var REFRESH_MS = 5 * 60 * 1000;
  var TICK_MS = 60 * 1000;

  var state = {
    items: {}, // jellyfin item id -> item
    settings: { showBanner: true, showBadges: true, warnWithinDays: 0, urgentWithinDays: 3 },
    fetchedAt: 0,
    clockOffset: 0, // serverTime - Date.now()
    parents: {}, // episode/season id -> series id
    pendingParents: {},
    userId: null,
  };

  // ------------------------------------------------------------------ i18n
  var LANG = (function () {
    var l = (document.documentElement.lang || navigator.language || "en").toLowerCase();
    return l.indexOf("fr") === 0 ? "fr" : "en";
  })();

  var STR = {
    fr: {
      badgeDays: function (d) {
        return d <= 0 ? "Dernier jour" : "J-" + d;
      },
      title: function (type) {
        return type === "show" ? "Cette série va être supprimée" : "Ce film va être supprimé";
      },
      when: function (d, date) {
        if (d <= 0) return "aujourd'hui (" + date + ")";
        if (d === 1) return "demain (" + date + ")";
        return "dans " + d + " jours (le " + date + ")";
      },
      hint: "Personne ne l'a regardé depuis longtemps. Lancez-le pour le garder : Maintainerr le retire de la liste au prochain passage.",
      collection: "Règle",
      size: "Taille",
    },
    en: {
      badgeDays: function (d) {
        return d <= 0 ? "Last day" : "D-" + d;
      },
      title: function (type) {
        return type === "show" ? "This series is about to be deleted" : "This movie is about to be deleted";
      },
      when: function (d, date) {
        if (d <= 0) return "today (" + date + ")";
        if (d === 1) return "tomorrow (" + date + ")";
        return "in " + d + " days (on " + date + ")";
      },
      hint: "Nobody has watched it in a long time. Play it to keep it: Maintainerr drops it from the list on its next run.",
      collection: "Rule",
      size: "Size",
    },
  }[LANG];

  function now() {
    return Date.now() + state.clockOffset;
  }

  function daysLeft(item) {
    var ms = new Date(item.DeleteAt).getTime() - now();
    return Math.ceil(ms / 86400000);
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(LANG === "fr" ? "fr-FR" : undefined, {
        day: "numeric",
        month: "long",
      });
    } catch (_) {
      return iso.slice(0, 10);
    }
  }

  function fmtSize(bytes) {
    if (!bytes) return "";
    var gb = bytes / 1e9;
    return gb >= 1 ? gb.toFixed(1) + " " + (LANG === "fr" ? "Go" : "GB") : Math.round(bytes / 1e6) + " " + (LANG === "fr" ? "Mo" : "MB");
  }

  function urgency(item) {
    var d = daysLeft(item);
    return d <= state.settings.urgentWithinDays ? "urgent" : "soon";
  }

  // ------------------------------------------------------------------ data
  function apiReady() {
    return typeof window.ApiClient !== "undefined" && window.ApiClient && typeof window.ApiClient.accessToken === "function" && window.ApiClient.accessToken();
  }

  function apiFetch(path, params) {
    var client = window.ApiClient;
    var url = client.getUrl(path, params);
    return fetch(url, {
      headers: { Authorization: 'MediaBrowser Token="' + client.accessToken() + '"', Accept: "application/json" },
      credentials: "same-origin",
    }).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }

  function loadItems(force) {
    if (!apiReady()) return Promise.resolve(false);
    if (!force && Date.now() - state.fetchedAt < REFRESH_MS) return Promise.resolve(true);
    state.fetchedAt = Date.now();
    return apiFetch("LeavingSoon/Items")
      .then(function (data) {
        var map = {};
        (data.Items || []).forEach(function (it) {
          map[it.Id] = it;
        });
        state.items = map;
        state.settings = {
          showBanner: data.Settings.ShowBanner !== false,
          showBadges: data.Settings.ShowBadges !== false,
          warnWithinDays: data.Settings.WarnWithinDays || 0,
          urgentWithinDays: data.Settings.UrgentWithinDays == null ? 3 : data.Settings.UrgentWithinDays,
        };
        state.clockOffset = new Date(data.ServerTime).getTime() - Date.now();
        state.userId = window.ApiClient.getCurrentUserId();
        return true;
      })
      .catch(function (err) {
        console.debug("[leaving-soon] items unavailable", err);
        return false;
      });
  }

  // An episode or season belongs to its series: look the parent up once, in batches of 50.
  // Returns a promise that settles when every requested id is known (shared with in-flight lookups,
  // so callers never spin while a request is pending).
  function resolveParents(ids) {
    var waits = [];
    var fresh = [];
    ids.forEach(function (id) {
      if (id in state.parents) return;
      if (state.pendingParents[id]) {
        waits.push(state.pendingParents[id]);
      } else {
        fresh.push(id);
      }
    });
    if (fresh.length && apiReady()) {
      for (var i = 0; i < fresh.length; i += 50) {
        waits.push(lookupParents(fresh.slice(i, i + 50)));
      }
    } else if (fresh.length) {
      fresh.forEach(function (id) {
        state.parents[id] = null;
      });
    }
    return Promise.all(waits);
  }

  function lookupParents(batch) {
    var p = apiFetch("Items", { Ids: batch.join(","), Fields: "SeriesId", EnableImages: false })
      .then(function (data) {
        (data.Items || []).forEach(function (it) {
          state.parents[it.Id] = it.SeriesId || it.ParentId || null;
        });
      })
      .catch(function () {})
      .then(function () {
        batch.forEach(function (id) {
          delete state.pendingParents[id];
          if (!(id in state.parents)) state.parents[id] = null;
        });
      });
    batch.forEach(function (id) {
      state.pendingParents[id] = p;
    });
    return p;
  }

  function lookup(id) {
    if (!id) return null;
    if (state.items[id]) return state.items[id];
    var parent = state.parents[id];
    return parent && state.items[parent] ? state.items[parent] : null;
  }

  // ------------------------------------------------------------------ badges on cards
  function decorateCards() {
    if (!state.settings.showBadges) return;
    var cards = document.querySelectorAll(".card[data-id]:not([data-ls-seen])");
    if (!cards.length) return;
    var needParents = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var id = card.getAttribute("data-id");
      var type = card.getAttribute("data-type") || "";
      card.setAttribute("data-ls-seen", "1");
      var item = lookup(id);
      if (item) {
        addBadge(card, item);
      } else if ((type === "Episode" || type === "Season") && !(id in state.parents)) {
        needParents.push(id);
      }
    }
    if (needParents.length) {
      resolveParents(needParents).then(function () {
        // Only the cards whose parent was just learned; everything else is already marked seen.
        needParents.forEach(function (id) {
          var item = lookup(id);
          if (!item) return;
          var late = document.querySelectorAll('.card[data-id="' + id + '"]');
          for (var k = 0; k < late.length; k++) addBadge(late[k], item);
        });
      });
    }
  }

  // Badges are drawn by CSS (::after on the poster frame) from data attributes: nothing is inserted
  // into the card's DOM, so React-rendered sections (home, experimental layout) keep reconciling fine.
  function addBadge(card, item) {
    var host = card.querySelector(".cardScalable") || card.querySelector(".cardImageContainer") || card;
    host.setAttribute("data-ls-badge", STR.badgeDays(daysLeft(item)));
    host.setAttribute("data-ls-level", urgency(item));
    host.setAttribute("data-ls-id", item.Id);
    host.title = STR.title(item.MediaType) + " " + STR.when(daysLeft(item), fmtDate(item.DeleteAt));
  }

  function refreshBadges() {
    var hosts = document.querySelectorAll("[data-ls-badge][data-ls-id]");
    for (var i = 0; i < hosts.length; i++) {
      var item = state.items[hosts[i].getAttribute("data-ls-id")];
      if (!item) {
        hosts[i].removeAttribute("data-ls-badge");
        hosts[i].removeAttribute("data-ls-level");
        hosts[i].removeAttribute("data-ls-id");
        hosts[i].removeAttribute("title");
        continue;
      }
      hosts[i].setAttribute("data-ls-badge", STR.badgeDays(daysLeft(item)));
      hosts[i].setAttribute("data-ls-level", urgency(item));
    }
  }

  // ------------------------------------------------------------------ banner on the detail page
  function currentDetailId() {
    var hash = window.location.hash || "";
    if (hash.indexOf("details") === -1) return null;
    var q = hash.split("?")[1] || "";
    var m = /(?:^|&)id=([^&]+)/.exec(q);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function decorateDetail() {
    var id = currentDetailId();
    var views = document.querySelectorAll(".itemDetailPage:not(.hide), #itemDetailPage:not(.hide)");
    var view = views.length ? views[views.length - 1] : null;
    var existing = document.querySelector(".ls-banner");
    if (!id || !view || !state.settings.showBanner) {
      if (existing) existing.parentNode.removeChild(existing);
      return;
    }
    var item = lookup(id);
    if (!item) {
      if (!(id in state.parents) && !state.pendingParents[id]) {
        resolveParents([id]).then(decorateDetail);
      }
      if (existing) existing.parentNode.removeChild(existing);
      return;
    }
    if (existing && existing.getAttribute("data-ls-for") === id && existing.getAttribute("data-ls-days") === String(daysLeft(item))) return;
    if (existing) existing.parentNode.removeChild(existing);

    // Right under the title/info line, before the Video/Audio rows (validated on Jellyfin 12.3).
    var content = view.querySelector(".detailPagePrimaryContent");
    var section = content ? content.querySelector(".detailSection") || content : null;
    var anchor = section || view.querySelector(".detailPagePrimaryContainer") || view;
    var d = daysLeft(item);
    var banner = document.createElement("div");
    banner.className = "ls-banner is-" + urgency(item);
    banner.setAttribute("data-ls-for", id);
    banner.setAttribute("data-ls-days", String(d));
    banner.setAttribute("role", "status");

    var icon = document.createElement("span");
    icon.className = "material-icons ls-banner-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = d <= state.settings.urgentWithinDays ? "warning" : "hourglass_bottom";

    var body = document.createElement("div");
    body.className = "ls-banner-body";
    var title = document.createElement("div");
    title.className = "ls-banner-title";
    title.textContent = STR.title(item.MediaType) + " " + STR.when(d, fmtDate(item.DeleteAt));
    var hint = document.createElement("div");
    hint.className = "ls-banner-hint";
    hint.textContent = STR.hint;
    var meta = document.createElement("div");
    meta.className = "ls-banner-meta";
    var parts = [STR.collection + " : " + item.CollectionTitle];
    if (item.SizeBytes) parts.push(STR.size + " : " + fmtSize(item.SizeBytes));
    meta.textContent = parts.join("  ·  ");
    body.appendChild(title);
    body.appendChild(hint);
    body.appendChild(meta);

    var count = document.createElement("div");
    count.className = "ls-banner-count";
    count.textContent = STR.badgeDays(d);

    banner.appendChild(icon);
    banner.appendChild(body);
    banner.appendChild(count);
    if (section) {
      section.insertBefore(banner, section.firstChild);
    } else {
      anchor.insertAdjacentElement(anchor === view ? "afterbegin" : "afterend", banner);
    }
  }

  // ------------------------------------------------------------------ wiring
  function injectStyle() {
    if (document.getElementById("leaving-soon-style")) return;
    var link = document.createElement("link");
    link.id = "leaving-soon-style";
    link.rel = "stylesheet";
    link.href = BASE + "/LeavingSoon/client.css";
    document.head.appendChild(link);
  }

  var scheduled = false;
  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(function () {
      scheduled = false;
      decorateCards();
      decorateDetail();
    });
  }

  function start() {
    injectStyle();
    loadItems(true).then(scheduleScan);
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length) {
          scheduleScan();
          return;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", function () {
      loadItems(false).then(scheduleScan);
    });
    document.addEventListener("viewshow", scheduleScan, true);
    setInterval(function () {
      loadItems(false).then(function () {
        refreshBadges();
        decorateDetail();
      });
    }, TICK_MS);
  }

  (function waitForApi(tries) {
    if (apiReady()) return start();
    if (tries > 600) return; // not signed in (login page): nothing to show
    setTimeout(function () {
      waitForApi(tries + 1);
    }, 500);
  })(0);
})();
