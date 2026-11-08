using System.Diagnostics;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.LeavingSoon.Maintainerr;

/// <summary>One Jellyfin item scheduled for removal by Maintainerr.</summary>
public sealed record LeavingItem(
    string MediaServerId,
    int CollectionId,
    string CollectionTitle,
    string MediaType,
    int Action,
    bool Deletes,
    DateTimeOffset AddDate,
    DateTimeOffset DeleteAt,
    long? SizeBytes,
    string? Title);

/// <summary>Latest snapshot of what Maintainerr is going to remove, refreshed in the background.</summary>
public sealed class CountdownCache
{
    private readonly MaintainerrClient _client;
    private readonly ILogger<CountdownCache> _logger;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private IReadOnlyDictionary<string, LeavingItem> _items = new Dictionary<string, LeavingItem>(StringComparer.OrdinalIgnoreCase);

    public CountdownCache(MaintainerrClient client, ILogger<CountdownCache> logger)
    {
        _client = client;
        _logger = logger;
    }

    public IReadOnlyDictionary<string, LeavingItem> Items => _items;

    public DateTimeOffset? LastRefresh { get; private set; }

    public DateTimeOffset? LastSuccess { get; private set; }

    public string? LastError { get; private set; }

    public TimeSpan LastDuration { get; private set; }

    public int CollectionsTracked { get; private set; }

    public int CollectionsSeen { get; private set; }

    /// <summary>Re-reads every active collection from Maintainerr. Errors are recorded, never thrown.</summary>
    public async Task<bool> RefreshAsync(CancellationToken ct)
    {
        if (!await _refreshLock.WaitAsync(0, ct).ConfigureAwait(false))
        {
            // A refresh is already running; wait for it instead of starting a second one.
            await _refreshLock.WaitAsync(ct).ConfigureAwait(false);
            _refreshLock.Release();
            return LastError is null;
        }

        var watch = Stopwatch.StartNew();
        try
        {
            var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
            var collections = await _client.GetCollectionsAsync(ct).ConfigureAwait(false);
            CollectionsSeen = collections.Count;
            var tracked = collections
                .Where(c => c.IsActive && (config.IncludeNonDeletingCollections || ServarrAction.Deletes(c.ArrAction)))
                .ToList();

            var now = DateTimeOffset.UtcNow;
            var next = new Dictionary<string, LeavingItem>(StringComparer.OrdinalIgnoreCase);
            foreach (var collection in tracked)
            {
                var media = await _client.GetCollectionMediaAsync(collection.Id, ct).ConfigureAwait(false);
                foreach (var item in media)
                {
                    if (string.IsNullOrWhiteSpace(item.MediaServerId))
                    {
                        continue;
                    }

                    var added = item.AddDate ?? now;
                    var deleteAt = added.AddDays(Math.Max(0, collection.DeleteAfterDays));
                    var entry = new LeavingItem(
                        item.MediaServerId,
                        collection.Id,
                        collection.Title,
                        collection.Type ?? "unknown",
                        collection.ArrAction,
                        ServarrAction.Deletes(collection.ArrAction),
                        added,
                        deleteAt,
                        item.SizeBytes,
                        item.MediaData?.Title ?? item.MediaData?.Name);

                    // The same item can sit in several collections: the earliest removal wins.
                    if (!next.TryGetValue(item.MediaServerId, out var existing) || entry.DeleteAt < existing.DeleteAt)
                    {
                        next[item.MediaServerId] = entry;
                    }
                }
            }

            _items = next;
            CollectionsTracked = tracked.Count;
            LastError = null;
            LastSuccess = now;
            _logger.LogInformation(
                "Leaving Soon: {Items} item(s) across {Tracked}/{Seen} Maintainerr collection(s)",
                next.Count,
                tracked.Count,
                collections.Count);
            return true;
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            LastError = ex.Message;
            _logger.LogWarning(ex, "Leaving Soon: Maintainerr refresh failed");
            return false;
        }
        finally
        {
            LastRefresh = DateTimeOffset.UtcNow;
            LastDuration = watch.Elapsed;
            _refreshLock.Release();
        }
    }
}
