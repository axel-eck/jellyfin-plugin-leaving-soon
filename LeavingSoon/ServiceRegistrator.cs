using Jellyfin.Plugin.LeavingSoon.Maintainerr;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.LeavingSoon;

/// <summary>Registers the plugin's services with Jellyfin.</summary>
public class ServiceRegistrator : IPluginServiceRegistrator
{
    /// <inheritdoc />
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton<MaintainerrClient>();
        serviceCollection.AddSingleton<CountdownCache>();
        serviceCollection.AddHostedService<CountdownRefreshService>();
    }
}
