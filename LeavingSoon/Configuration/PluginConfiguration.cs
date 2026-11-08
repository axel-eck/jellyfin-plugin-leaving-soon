using MediaBrowser.Model.Plugins;

namespace Jellyfin.Plugin.LeavingSoon;

/// <summary>Plugin settings, edited from the dashboard page.</summary>
public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>Base URL of Maintainerr, e.g. http://maintainerr:6246.</summary>
    public string MaintainerrUrl { get; set; } = "http://maintainerr:6246";

    /// <summary>Optional Maintainerr API key, sent as X-Api-Key when set.</summary>
    public string ApiKey { get; set; } = string.Empty;

    /// <summary>How often the Maintainerr collections are re-read, in minutes.</summary>
    public int RefreshMinutes { get; set; } = 10;

    /// <summary>
    /// Also warn for collections whose action does not delete anything (review-only collections,
    /// "unmonitor", quality-profile changes). Off by default: only real deletions are shown.
    /// </summary>
    public bool IncludeNonDeletingCollections { get; set; }

    /// <summary>Show the countdown banner on item detail pages.</summary>
    public bool ShowBanner { get; set; } = true;

    /// <summary>Show the day-count badge on posters.</summary>
    public bool ShowBadges { get; set; } = true;

    /// <summary>Only warn when the deletion is within this many days (0 = always).</summary>
    public int WarnWithinDays { get; set; }

    /// <summary>Switch to the urgent style when the deletion is within this many days.</summary>
    public int UrgentWithinDays { get; set; } = 3;
}
