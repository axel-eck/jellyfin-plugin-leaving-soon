using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.LeavingSoon.Maintainerr;

/// <summary>Maintainerr's ServarrAction enum (packages/contracts/src/collections/servarr-action.ts).</summary>
public static class ServarrAction
{
    public const int Delete = 0;
    public const int UnmonitorDeleteAll = 1;
    public const int UnmonitorDeleteExisting = 2;
    public const int Unmonitor = 3;
    public const int DoNothing = 4;
    public const int DeleteShowIfEmpty = 5;
    public const int UnmonitorShowIfEmpty = 6;
    public const int ChangeQualityProfile = 7;

    /// <summary>True when the action removes media files from the library.</summary>
    public static bool Deletes(int action) =>
        action is Delete or UnmonitorDeleteAll or UnmonitorDeleteExisting or DeleteShowIfEmpty;

    public static string Label(int action) => action switch
    {
        Delete => "delete",
        UnmonitorDeleteAll => "unmonitor + delete all",
        UnmonitorDeleteExisting => "unmonitor + delete existing",
        Unmonitor => "unmonitor",
        DoNothing => "do nothing",
        DeleteShowIfEmpty => "delete show if empty",
        UnmonitorShowIfEmpty => "unmonitor show if empty",
        ChangeQualityProfile => "change quality profile",
        _ => "action " + action,
    };
}

/// <summary>GET /api/collections item.</summary>
public sealed class MaintainerrCollection
{
    public int Id { get; set; }

    public string Title { get; set; } = string.Empty;

    /// <summary>"movie" or "show".</summary>
    public string? Type { get; set; }

    public int ArrAction { get; set; }

    public int DeleteAfterDays { get; set; }

    public bool IsActive { get; set; }

    public bool ManualCollection { get; set; }
}

/// <summary>GET /api/collections/media/{id}/content/{page} response.</summary>
public sealed class MaintainerrMediaPage
{
    public int TotalSize { get; set; }

    public List<MaintainerrMediaItem> Items { get; set; } = new();
}

public sealed class MaintainerrMediaItem
{
    public int Id { get; set; }

    public int CollectionId { get; set; }

    /// <summary>The Jellyfin item id (Plex rating key on Plex servers).</summary>
    public string? MediaServerId { get; set; }

    public int? TmdbId { get; set; }

    public int? TvdbId { get; set; }

    public DateTimeOffset? AddDate { get; set; }

    public long? SizeBytes { get; set; }

    public bool IsManual { get; set; }

    public MaintainerrMediaData? MediaData { get; set; }
}

public sealed class MaintainerrMediaData
{
    public string? Id { get; set; }

    public string? Title { get; set; }

    public string? Name { get; set; }

    public int? Year { get; set; }

    [JsonExtensionData]
    public Dictionary<string, System.Text.Json.JsonElement>? Extra { get; set; }
}
