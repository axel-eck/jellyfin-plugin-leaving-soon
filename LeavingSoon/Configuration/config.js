// Dashboard page controller for Leaving Soon. Settings live in the plugin configuration object;
// status, refresh and test have their own routes under /LeavingSoon/.
const PLUGIN_ID = "d3149a22-93e6-4ae6-915f-23c652a7f6e4";
const FIELDS = ["MaintainerrUrl", "ApiKey", "RefreshMinutes", "IncludeNonDeletingCollections", "ShowBanner", "ShowBadges", "WarnWithinDays", "UrgentWithinDays"];

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmtDate = (value, withTime) => {
  if (!value) return "never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return withTime ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : date.toLocaleDateString(undefined, { dateStyle: "medium" });
};

const fmtSize = (bytes) => (bytes ? (bytes / 1e9).toFixed(1) + " GB" : "");

const daysLeft = (iso, serverTime) => Math.ceil((new Date(iso).getTime() - new Date(serverTime).getTime()) / 86400000);

const api = {
  json: (url, options = {}) =>
    ApiClient.fetch({
      type: options.type || "GET",
      url: ApiClient.getUrl(url),
      dataType: "json",
      contentType: options.data ? "application/json" : undefined,
      data: options.data ? JSON.stringify(options.data) : undefined,
      headers: { accept: "application/json" },
    }),
};

export default function (view) {
  const $ = (sel) => view.querySelector(sel);

  const load = async () => {
    const config = await ApiClient.getPluginConfiguration(PLUGIN_ID);
    for (const key of FIELDS) {
      const el = $("#" + key);
      if (!el) continue;
      if (el.type === "checkbox") el.checked = Boolean(config[key]);
      else el.value = config[key] ?? "";
    }
  };

  const save = async (event) => {
    event.preventDefault();
    Dashboard.showLoadingMsg();
    try {
      const config = await ApiClient.getPluginConfiguration(PLUGIN_ID);
      for (const key of FIELDS) {
        const el = $("#" + key);
        if (!el) continue;
        if (el.type === "checkbox") config[key] = el.checked;
        else if (el.type === "number") config[key] = Number(el.value || 0);
        else config[key] = el.value.trim();
      }
      const result = await ApiClient.updatePluginConfiguration(PLUGIN_ID, config);
      Dashboard.processPluginConfigurationUpdateResult(result);
      setTimeout(loadStatus, 1500);
    } catch (error) {
      console.error(error);
      Dashboard.alert("Could not save the configuration; check the server log.");
    } finally {
      Dashboard.hideLoadingMsg();
    }
    return false;
  };

  const renderCollections = (collections) => {
    if (!collections.length) {
      $("#ls-collections").innerHTML = "";
      return;
    }
    const rows = collections
      .map(
        (c) => `<tr class="${c.Deletes ? "is-deleting" : "is-review"}${c.IsActive ? "" : " is-off"}">
          <td>${esc(c.Title)}</td><td>${esc(c.Type || "")}</td><td>${esc(c.ActionLabel)}</td>
          <td>${c.DeleteAfterDays} d</td><td>${c.IsActive ? "active" : "inactive"}</td>
          <td>${c.Deletes ? "warns" : "ignored unless enabled above"}</td></tr>`,
      )
      .join("");
    $("#ls-collections").innerHTML = `<table class="ls-table"><thead><tr><th>Collection</th><th>Type</th><th>Action</th><th>Delete after</th><th>State</th><th>Plugin</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const test = async () => {
    const out = $("#ls-test-result");
    out.textContent = "Testing…";
    out.className = "ls-inline-result";
    try {
      const result = await api.json("LeavingSoon/Test", { type: "POST", data: { url: $("#MaintainerrUrl").value.trim(), apiKey: $("#ApiKey").value.trim() } });
      if (result.Ok) {
        out.textContent = `OK, ${result.Collections.length} collection(s)`;
        out.className = "ls-inline-result is-ok";
        renderCollections(result.Collections);
      } else {
        out.textContent = result.Error || "failed";
        out.className = "ls-inline-result is-error";
        renderCollections([]);
      }
    } catch (error) {
      out.textContent = "Request failed: " + (error.statusText || error.message || error);
      out.className = "ls-inline-result is-error";
    }
  };

  const renderStatus = (status) => {
    const parts = [
      `<div><b>Maintainerr</b> ${esc(status.MaintainerrUrl)}</div>`,
      `<div><b>Last refresh</b> ${fmtDate(status.LastRefresh, true)} (${Math.round(status.LastDurationMs)} ms)</div>`,
      `<div><b>Collections</b> ${status.CollectionsTracked} warning / ${status.CollectionsSeen} seen</div>`,
      `<div><b>Items</b> ${status.Items.length}</div>`,
      `<div><b>Plugin</b> ${esc(status.Version)}</div>`,
    ];
    if (status.LastError) parts.push(`<div class="is-error"><b>Error</b> ${esc(status.LastError)}</div>`);
    $("#ls-status").innerHTML = parts.join("");
    if (!status.Items.length) {
      $("#ls-items").innerHTML = '<div class="ls-empty">Nothing is scheduled for deletion.</div>';
      return;
    }
    const rows = status.Items
      .map((it) => {
        const d = daysLeft(it.DeleteAt, status.ServerTime);
        return `<tr class="${d <= 3 ? "is-urgent" : ""}"><td>${esc(it.Title || it.Id)}</td><td>${esc(it.MediaType)}</td>
          <td>${esc(it.CollectionTitle)}</td><td>${fmtDate(it.AddDate)}</td><td>${fmtDate(it.DeleteAt)}</td>
          <td>${d <= 0 ? "today" : d + " d"}</td><td>${fmtSize(it.SizeBytes)}</td></tr>`;
      })
      .join("");
    $("#ls-items").innerHTML = `<table class="ls-table"><thead><tr><th>Title</th><th>Type</th><th>Collection</th><th>Added</th><th>Deleted on</th><th>Left</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table>`;
  };

  const loadStatus = async () => {
    try {
      renderStatus(await api.json("LeavingSoon/Status"));
    } catch (error) {
      console.error(error);
      $("#ls-status").innerHTML = '<div class="is-error">Could not read the plugin status.</div>';
    }
  };

  const refreshNow = async () => {
    $("#ls-status").textContent = "Refreshing…";
    try {
      renderStatus(await api.json("LeavingSoon/Refresh", { type: "POST", data: {} }));
    } catch (error) {
      console.error(error);
      $("#ls-status").innerHTML = '<div class="is-error">Refresh failed.</div>';
    }
  };

  $("#ls-form").addEventListener("submit", save);
  $("#ls-test").addEventListener("click", test);
  $("#ls-refresh").addEventListener("click", refreshNow);

  view.addEventListener("viewshow", () => {
    load().catch((error) => {
      console.error(error);
      Dashboard.alert("Could not load the configuration.");
    });
    loadStatus();
  });
}
