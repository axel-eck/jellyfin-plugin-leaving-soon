// Leaving Soon - runs inside the Jellyfin web client (injected into index.html by
// contrib/jellyfin-leaving-soon-init.sh, served by the plugin at /LeavingSoon/client.js).
//
// Adds a countdown banner to the detail page of a movie / series / season Maintainerr is about to
// delete, and a "D-12" badge on their posters wherever cards are rendered. Read-only: the plugin reads
// Maintainerr server-side and exposes /LeavingSoon/Items to signed-in users; nothing here writes.
//
// Rules of the road: badges are pure CSS driven by data attributes (no node is ever inserted into a
// card, React-rendered sections would crash), the banner goes into the legacy detail page only, and
// every lookup of a parent (season -> series) is shared so nothing spins while a request is in flight.
// No module syntax: this must load in every browser the web client supports.
(function () {
  "use strict";

  var BASE = window.location.pathname.replace(/\/web\/?.*$/, "");
  var REFRESH_MS = 5 * 60 * 1000;
  var TICK_MS = 60 * 1000;

  var state = {
    items: {}, // jellyfin item id -> entry (movie, series, season or episode)
    bySeries: {}, // series id -> entries of its seasons/episodes (season/episode-level collections)
    settings: { showBanner: true, showBadges: true, warnWithinDays: 0, urgentWithinDays: 3 },
    fetchedAt: 0,
    clockOffset: 0, // serverTime - Date.now()
    info: {}, // item id -> { type, series, season } learned from /Items
    pending: {}, // item id -> promise of the /Items lookup in flight
  };

  // ------------------------------------------------------------------ i18n
  // Read at render time, not at load: the web client applies the user's display language (a Jellyfin
  // user setting, which may differ from the browser's) after start-up by setting <html lang>.
  function lang() {
    var l = (document.documentElement.lang || navigator.language || "en").toLowerCase();
    return l.indexOf("fr") === 0 ? "fr" : "en";
  }

  var STRINGS = {
    fr: {
      locale: "fr-FR",
      badge: function (d) {
        return d <= 0 ? "Dernier jour" : "J-" + d;
      },
      when: function (d, date) {
        if (d <= 0) return "aujourd'hui (" + date + ")";
        if (d === 1) return "demain (" + date + ")";
        return "dans " + d + " jours (le " + date + ")";
      },
      title: function (entry, d, date) {
        var w = STRINGS.fr.when(d, date);
        if (entry.kind === "seasons") {
          var nums = entry.seasons.map(seasonLabel).join(", ");
          return entry.seasons.length === 1
            ? "La saison " + nums + " va être supprimée " + w
            : "Les saisons " + nums + " vont être supprimées, la première " + w;
        }
        if (entry.kind === "season") return "Cette saison va être supprimée " + w;
        if (entry.kind === "episode") return "Cet épisode va être supprimé " + w;
        if (entry.kind === "show") return "Cette série va être supprimée " + w;
        return "Ce film va être supprimé " + w;
      },
      hint: "Personne ne l'a regardé depuis longtemps. Lancez-le pour le garder : Maintainerr le retire de la liste au prochain passage.",
      collection: "Règle",
      size: "Taille",
      gb: "Go",
      mb: "Mo",
    },
    en: {
      locale: undefined,
      badge: function (d) {
        return d <= 0 ? "Last day" : "D-" + d;
      },
      when: function (d, date) {
        if (d <= 0) return "today (" + date + ")";
        if (d === 1) return "tomorrow (" + date + ")";
        return "in " + d + " days (on " + date + ")";
      },
      title: function (entry, d, date) {
        var w = STRINGS.en.when(d, date);
        if (entry.kind === "seasons") {
          var nums = entry.seasons.map(seasonLabel).join(", ");
          return entry.seasons.length === 1
            ? "Season " + nums + " is about to be deleted " + w
            : "Seasons " + nums + " are about to be deleted, the first one " + w;
        }
        if (entry.kind === "season") return "This season is about to be deleted " + w;
        if (entry.kind === "episode") return "This episode is about to be deleted " + w;
        if (entry.kind === "show") return "This series is about to be deleted " + w;
        return "This movie is about to be deleted " + w;
      },
      hint: "Nobody has watched it in a long time. Play it to keep it: Maintainerr drops it from the list on its next run.",
      collection: "Rule",
      size: "Size",
      gb: "GB",
      mb: "MB",
    },
  };

  function str() {
    return STRINGS[lang()];
  }

  function seasonLabel(e) {
    return e.SeasonNumber == null ? "?" : String(e.SeasonNumber);
  }

  function now() {
    return Date.now() + state.clockOffset;
  }

  function daysLeft(entry) {
    return Math.ceil((new Date(entry.DeleteAt).getTime() - now()) / 86400000);
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString(str().locale, { day: "numeric", month: "long" });
    } catch (_) {
      return iso.slice(0, 10);
    }
  }

  function fmtSize(bytes) {
    if (!bytes) return "";
    var gb = bytes / 1e9;
    return gb >= 1 ? gb.toFixed(1) + " " + str().gb : Math.round(bytes / 1e6) + " " + str().mb;
  }

  function urgency(entry) {
    return daysLeft(entry) <= state.settings.urgentWithinDays ? "urgent" : "soon";
  }

  // ------------------------------------------------------------------ data
  function apiReady() {
    var c = window.ApiClient;
    return !!(c && typeof c.accessToken === "function" && c.accessToken());
  }

  function apiFetch(path, params) {
    var client = window.ApiClient;
    return fetch(client.getUrl(path, params), {
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
        var items = {};
        var bySeries = {};
        (data.Items || []).forEach(function (it) {
          it.kind = it.MediaType; // movie | show | season | episode
          items[it.Id] = it;
          if (it.SeriesId && (it.kind === "season" || it.kind === "episode")) {
            (bySeries[it.SeriesId] = bySeries[it.SeriesId] || []).push(it);
          }
        });
        state.items = items;
        state.bySeries = bySeries;
        var s = data.Settings || {};
        state.settings = {
          showBanner: s.ShowBanner !== false,
          showBadges: s.ShowBadges !== false,
          warnWithinDays: s.WarnWithinDays || 0,
          urgentWithinDays: s.UrgentWithinDays == null ? 3 : s.UrgentWithinDays,
        };
        state.clockOffset = new Date(data.ServerTime).getTime() - Date.now();
        return true;
      })
      .catch(function (err) {
        console.debug("[leaving-soon] items unavailable", err);
        return false;
      });
  }

  // What an item is and where it belongs (series, season), learned once per id in batches of 50.
  // Returns a promise shared with any lookup already in flight for the same ids.
  function learn(ids) {
    var waits = [];
    var fresh = [];
    ids.forEach(function (id) {
      if (id in state.info) return;
      if (state.pending[id]) waits.push(state.pending[id]);
      else fresh.push(id);
    });
    if (fresh.length && apiReady()) {
      for (var i = 0; i < fresh.length; i += 50) waits.push(learnBatch(fresh.slice(i, i + 50)));
    } else {
      fresh.forEach(function (id) {
        state.info[id] = null;
      });
    }
    return Promise.all(waits);
  }

  function learnBatch(batch) {
    var p = apiFetch("Items", { Ids: batch.join(","), Fields: "SeriesId,SeasonId,ParentId", EnableImages: false })
      .then(function (data) {
        (data.Items || []).forEach(function (it) {
          state.info[it.Id] = {
            type: it.Type,
            series: it.Type === "Series" ? it.Id : it.SeriesId || null,
            season: it.Type === "Season" ? it.Id : it.SeasonId || (it.Type === "Episode" ? it.ParentId : null) || null,
          };
        });
      })
      .catch(function () {})
      .then(function () {
        batch.forEach(function (id) {
          delete state.pending[id];
          if (!(id in state.info)) state.info[id] = null;
        });
      });
    batch.forEach(function (id) {
      state.pending[id] = p;
    });
    return p;
  }

  // Aggregate shown on a series whose seasons/episodes (not the series itself) are scheduled.
  function seasonsEntry(seriesId) {
    var list = state.bySeries[seriesId];
    if (!list || !list.length) return null;
    var sorted = list.slice().sort(function (a, b) {
      return new Date(a.DeleteAt) - new Date(b.DeleteAt);
    });
    var seen = {};
    var seasons = sorted.filter(function (e) {
      var k = String(e.SeasonNumber);
      if (seen[k]) return false;
      seen[k] = true;
      return true;
    });
    var size = 0;
    list.forEach(function (e) {
      size += e.SizeBytes || 0;
    });
    return {
      Id: seriesId,
      kind: "seasons",
      seasons: seasons,
      DeleteAt: sorted[0].DeleteAt,
      CollectionTitle: sorted[0].CollectionTitle,
      SizeBytes: size || null,
    };
  }

  // The entry to show for an item, if any. `type` is the Jellyfin item type when the DOM knows it.
  function lookup(id, type) {
    if (!id) return null;
    if (state.items[id]) return state.items[id];
    if (type === "Series" || (!type && state.bySeries[id])) {
      var agg = seasonsEntry(id);
      if (agg) return agg;
    }
    var info = state.info[id];
    if (!info) return null;
    if (info.type === "Series") return seasonsEntry(id);
    if (info.season && state.items[info.season]) return state.items[info.season];
    if (info.series && state.items[info.series]) return state.items[info.series];
    return null;
  }

  // Whether a lookup might still change once /Items has answered for this id.
  function needsInfo(id, type) {
    if (state.items[id] || id in state.info) return false;
    if (type === "Movie") return false;
    return true;
  }

  // ------------------------------------------------------------------ badges on cards
  function decorateCards() {
    if (!state.settings.showBadges) return;
    var cards = document.querySelectorAll(".card[data-id]:not([data-ls-seen])");
    if (!cards.length) return;
    var unknown = [];
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var id = card.getAttribute("data-id");
      var type = card.getAttribute("data-type") || "";
      card.setAttribute("data-ls-seen", "1");
      var entry = lookup(id, type);
      if (entry) setBadge(card, entry);
      else if (needsInfo(id, type)) unknown.push(id);
    }
    if (unknown.length) {
      learn(unknown).then(function () {
        unknown.forEach(function (id) {
          var entry = lookup(id, "");
          if (!entry) return;
          var late = document.querySelectorAll('.card[data-id="' + id + '"]');
          for (var k = 0; k < late.length; k++) setBadge(late[k], entry);
        });
      });
    }
  }

  // Pure CSS badge (::after on the poster frame) from data attributes: no DOM insertion.
  function setBadge(card, entry) {
    var host = card.querySelector(".cardScalable") || card.querySelector(".cardImageContainer") || card;
    host.setAttribute("data-ls-badge", str().badge(daysLeft(entry)));
    host.setAttribute("data-ls-level", urgency(entry));
    host.setAttribute("data-ls-id", entry.Id);
    host.title = str().title(entry, daysLeft(entry), fmtDate(entry.DeleteAt));
  }

  function refreshBadges() {
    var hosts = document.querySelectorAll("[data-ls-badge][data-ls-id]");
    for (var i = 0; i < hosts.length; i++) {
      var id = hosts[i].getAttribute("data-ls-id");
      var entry = state.items[id] || seasonsEntry(id);
      if (!entry) {
        hosts[i].removeAttribute("data-ls-badge");
        hosts[i].removeAttribute("data-ls-level");
        hosts[i].removeAttribute("data-ls-id");
        hosts[i].removeAttribute("title");
        continue;
      }
      hosts[i].setAttribute("data-ls-badge", str().badge(daysLeft(entry)));
      hosts[i].setAttribute("data-ls-level", urgency(entry));
    }
  }

  // ------------------------------------------------------------------ banner on the detail page
  function currentDetailId() {
    var hash = window.location.hash || "";
    if (hash.indexOf("details") === -1) return null;
    var m = /(?:^|[?&])id=([^&]+)/.exec(hash.split("?")[1] || "");
    return m ? decodeURIComponent(m[1]) : null;
  }

  function removeBanner() {
    var existing = document.querySelector(".ls-banner");
    if (existing) existing.parentNode.removeChild(existing);
  }

  function decorateDetail() {
    var id = currentDetailId();
    var views = document.querySelectorAll(".itemDetailPage:not(.hide), #itemDetailPage:not(.hide)");
    var view = views.length ? views[views.length - 1] : null;
    if (!id || !view || !state.settings.showBanner) return removeBanner();

    var entry = lookup(id, "");
    if (!entry) {
      if (needsInfo(id, "") && !state.pending[id]) learn([id]).then(decorateDetail);
      return removeBanner();
    }

    var d = daysLeft(entry);
    var key = id + ":" + d + ":" + lang() + ":" + entry.DeleteAt;
    var existing = document.querySelector(".ls-banner");
    if (existing && existing.getAttribute("data-ls-key") === key) return;
    removeBanner();

    // Right under the title/info line, before the Video/Audio rows (validated on Jellyfin 12.3).
    var content = view.querySelector(".detailPagePrimaryContent");
    var section = content ? content.querySelector(".detailSection") || content : null;
    var anchor = section || view.querySelector(".detailPagePrimaryContainer") || view;

    var banner = document.createElement("div");
    banner.className = "ls-banner is-" + urgency(entry);
    banner.setAttribute("data-ls-key", key);
    banner.setAttribute("role", "status");

    var icon = document.createElement("span");
    icon.className = "material-icons ls-banner-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = d <= state.settings.urgentWithinDays ? "warning" : "hourglass_bottom";

    var body = document.createElement("div");
    body.className = "ls-banner-body";
    var title = document.createElement("div");
    title.className = "ls-banner-title";
    title.textContent = str().title(entry, d, fmtDate(entry.DeleteAt));
    var hint = document.createElement("div");
    hint.className = "ls-banner-hint";
    hint.textContent = str().hint;
    var meta = document.createElement("div");
    meta.className = "ls-banner-meta";
    var parts = [str().collection + " : " + entry.CollectionTitle];
    if (entry.SizeBytes) parts.push(str().size + " : " + fmtSize(entry.SizeBytes));
    meta.textContent = parts.join("  ·  ");
    body.appendChild(title);
    body.appendChild(hint);
    body.appendChild(meta);

    var count = document.createElement("div");
    count.className = "ls-banner-count";
    count.textContent = str().badge(d);

    banner.appendChild(icon);
    banner.appendChild(body);
    banner.appendChild(count);
    if (section) section.insertBefore(banner, section.firstChild);
    else anchor.insertAdjacentElement(anchor === view ? "afterbegin" : "afterend", banner);
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
      try {
        decorateCards();
        decorateDetail();
      } catch (err) {
        console.debug("[leaving-soon]", err);
      }
    });
  }

  function start() {
    injectStyle();
    loadItems(true).then(scheduleScan);
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes.length) return scheduleScan();
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
    if (tries > 600) return; // login page: nothing to show
    setTimeout(function () {
      waitForApi(tries + 1);
    }, 500);
  })(0);
})();
