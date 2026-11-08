using MediaBrowser.Model.Plugins;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.LeavingSoon.Maintainerr;

/// <summary>Refreshes the cache on a timer, and right away when the configuration changes.</summary>
public sealed class CountdownRefreshService : BackgroundService
{
    private readonly CountdownCache _cache;
    private readonly ILogger<CountdownRefreshService> _logger;
    private readonly SemaphoreSlim _wake = new(0, int.MaxValue);

    public CountdownRefreshService(CountdownCache cache, ILogger<CountdownRefreshService> logger)
    {
        _cache = cache;
        _logger = logger;
    }

    /// <inheritdoc />
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (Plugin.Instance is not null)
        {
            Plugin.Instance.ConfigurationChanged += OnConfigurationChanged;
        }

        try
        {
            // Let Jellyfin finish starting before the first call.
            await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken).ConfigureAwait(false);
            while (!stoppingToken.IsCancellationRequested)
            {
                await _cache.RefreshAsync(stoppingToken).ConfigureAwait(false);
                var minutes = Math.Clamp(Plugin.Instance?.Configuration.RefreshMinutes ?? 10, 1, 24 * 60);
                var delay = _cache.LastError is null ? TimeSpan.FromMinutes(minutes) : TimeSpan.FromMinutes(Math.Min(minutes, 2));
                await _wake.WaitAsync(delay, stoppingToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // shutting down
        }
        finally
        {
            if (Plugin.Instance is not null)
            {
                Plugin.Instance.ConfigurationChanged -= OnConfigurationChanged;
            }
        }
    }

    private void OnConfigurationChanged(object? sender, BasePluginConfiguration e)
    {
        _logger.LogDebug("Leaving Soon: configuration changed, refreshing");
        _wake.Release();
    }
}
