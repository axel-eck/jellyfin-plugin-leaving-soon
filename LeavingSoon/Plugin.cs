using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace Jellyfin.Plugin.LeavingSoon;

/// <summary>
/// Shows, inside Jellyfin, which movies and series Maintainerr is about to delete and when.
/// </summary>
public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    /// <summary>Name used for the dashboard page resources (__plugin/LeavingSoon.js etc.).</summary>
    public const string ResourceName = "LeavingSoon";

    public Plugin(IApplicationPaths applicationPaths, IXmlSerializer xmlSerializer)
        : base(applicationPaths, xmlSerializer)
    {
        Instance = this;
    }

    public static Plugin? Instance { get; private set; }

    /// <inheritdoc />
    public override string Name => "Leaving Soon";

    /// <inheritdoc />
    public override Guid Id => Guid.Parse("d3149a22-93e6-4ae6-915f-23c652a7f6e4");

    /// <inheritdoc />
    public override string Description =>
        "Warns viewers about media Maintainerr is about to delete: a countdown banner on the item page and a badge on posters.";

    /// <inheritdoc />
    public IEnumerable<PluginPageInfo> GetPages()
    {
        var ns = GetType().Namespace;
        return new[]
        {
            new PluginPageInfo
            {
                Name = ResourceName,
                DisplayName = "Leaving Soon",
                EmbeddedResourcePath = ns + ".Configuration.configPage.html",
                EnableInMainMenu = true,
                MenuIcon = "hourglass_bottom",
            },
            new PluginPageInfo
            {
                Name = ResourceName + ".js",
                EmbeddedResourcePath = ns + ".Configuration.config.js",
            },
            new PluginPageInfo
            {
                Name = ResourceName + ".css",
                EmbeddedResourcePath = ns + ".Configuration.style.css",
            },
        };
    }
}
