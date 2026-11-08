using System.Net.Http.Json;
using System.Text.Json;
using MediaBrowser.Common.Net;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.LeavingSoon.Maintainerr;

/// <summary>Thin client for the Maintainerr REST API.</summary>
public sealed class MaintainerrClient
{
    private const int PageSize = 100;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = System.Text.Json.Serialization.JsonNumberHandling.AllowReadingFromString,
    };

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<MaintainerrClient> _logger;

    public MaintainerrClient(IHttpClientFactory httpClientFactory, ILogger<MaintainerrClient> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public Task<List<MaintainerrCollection>> GetCollectionsAsync(CancellationToken ct) =>
        GetCollectionsAsync(Settings(), ct);

    /// <summary>Lists the collections with explicit settings (used by the "test connection" button).</summary>
    public async Task<List<MaintainerrCollection>> GetCollectionsAsync((string Url, string ApiKey) settings, CancellationToken ct)
    {
        using var client = CreateClient(settings);
        var result = await client.GetFromJsonAsync<List<MaintainerrCollection>>("api/collections", JsonOptions, ct).ConfigureAwait(false);
        return result ?? new List<MaintainerrCollection>();
    }

    /// <summary>Every media item of a collection, following Maintainerr's pagination.</summary>
    public async Task<List<MaintainerrMediaItem>> GetCollectionMediaAsync(int collectionId, CancellationToken ct)
    {
        using var client = CreateClient(Settings());
        var items = new List<MaintainerrMediaItem>();
        for (var page = 1; page <= 200; page++)
        {
            var url = $"api/collections/media/{collectionId}/content/{page}?size={PageSize}";
            var result = await client.GetFromJsonAsync<MaintainerrMediaPage>(url, JsonOptions, ct).ConfigureAwait(false);
            if (result is null || result.Items.Count == 0)
            {
                break;
            }

            items.AddRange(result.Items);
            if (items.Count >= result.TotalSize || result.Items.Count < PageSize)
            {
                break;
            }
        }

        _logger.LogDebug("Maintainerr collection {Id}: {Count} items", collectionId, items.Count);
        return items;
    }

    private static (string Url, string ApiKey) Settings()
    {
        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        return (config.MaintainerrUrl, config.ApiKey);
    }

    private HttpClient CreateClient((string Url, string ApiKey) settings)
    {
        var url = settings.Url.Trim();
        if (string.IsNullOrEmpty(url))
        {
            throw new InvalidOperationException("Maintainerr URL is not configured");
        }

        var client = _httpClientFactory.CreateClient(NamedClient.Default);
        client.BaseAddress = new Uri(url.EndsWith('/') ? url : url + "/");
        client.Timeout = TimeSpan.FromSeconds(30);
        if (!string.IsNullOrWhiteSpace(settings.ApiKey))
        {
            client.DefaultRequestHeaders.Remove("X-Api-Key");
            client.DefaultRequestHeaders.Add("X-Api-Key", settings.ApiKey.Trim());
        }

        return client;
    }
}
