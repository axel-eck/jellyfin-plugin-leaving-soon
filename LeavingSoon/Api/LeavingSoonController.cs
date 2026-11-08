using System.Net.Mime;
using System.Reflection;
using Jellyfin.Plugin.LeavingSoon.Maintainerr;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace Jellyfin.Plugin.LeavingSoon.Api;

/// <summary>Endpoints used by the web client script and the dashboard page.</summary>
[ApiController]
[Route("LeavingSoon")]
public class LeavingSoonController : ControllerBase
{
    private readonly CountdownCache _cache;
    private readonly MaintainerrClient _client;

    public LeavingSoonController(CountdownCache cache, MaintainerrClient client)
    {
        _cache = cache;
        _client = client;
    }

    /// <summary>Items Maintainerr is going to remove, for the signed-in viewer.</summary>
    [HttpGet("Items")]
    [Authorize]
    [ProducesResponseType(StatusCodes.Status200OK)]
    public ActionResult<ItemsResponse> GetItems()
    {
        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        var now = DateTimeOffset.UtcNow;
        var items = _cache.Items.Values
            .Where(i => config.WarnWithinDays <= 0 || i.DeleteAt <= now.AddDays(config.WarnWithinDays))
            .OrderBy(i => i.DeleteAt)
            .Select(i => new ItemDto(i.MediaServerId, i.MediaType, i.DeleteAt, i.AddDate, i.CollectionId, i.CollectionTitle, i.Deletes, i.SizeBytes))
            .ToList();

        return new ItemsResponse(
            now,
            _cache.LastSuccess,
            new SettingsDto(config.ShowBanner, config.ShowBadges, config.WarnWithinDays, config.UrgentWithinDays),
            items);
    }

    /// <summary>Cache state and the full tracked list, for the dashboard page.</summary>
    [HttpGet("Status")]
    [Authorize(Policy = "RequiresElevation")]
    public ActionResult<StatusResponse> GetStatus() => BuildStatus();

    /// <summary>Re-reads Maintainerr now.</summary>
    [HttpPost("Refresh")]
    [Authorize(Policy = "RequiresElevation")]
    public async Task<ActionResult<StatusResponse>> Refresh(CancellationToken ct)
    {
        await _cache.RefreshAsync(ct).ConfigureAwait(false);
        return BuildStatus();
    }

    /// <summary>Tries the given Maintainerr settings without saving them.</summary>
    [HttpPost("Test")]
    [Authorize(Policy = "RequiresElevation")]
    public async Task<ActionResult<TestResponse>> Test([FromBody] TestRequest request, CancellationToken ct)
    {
        try
        {
            var collections = await _client.GetCollectionsAsync((request.Url ?? string.Empty, request.ApiKey ?? string.Empty), ct).ConfigureAwait(false);
            return new TestResponse(
                true,
                null,
                collections.Select(c => new CollectionDto(c.Id, c.Title, c.Type, c.ArrAction, ServarrAction.Label(c.ArrAction), ServarrAction.Deletes(c.ArrAction), c.DeleteAfterDays, c.IsActive)).ToList());
        }
        catch (Exception ex)
        {
            return new TestResponse(false, ex.Message, new List<CollectionDto>());
        }
    }

    /// <summary>The script injected into the web client (see contrib/jellyfin-leaving-soon-init.sh).</summary>
    [HttpGet("client.js")]
    [AllowAnonymous]
    public ActionResult GetClientScript() => Resource("Web.client.js", "text/javascript; charset=utf-8");

    /// <summary>Styles for the banner and the badges, loaded by client.js.</summary>
    [HttpGet("client.css")]
    [AllowAnonymous]
    public ActionResult GetClientStyle() => Resource("Web.client.css", "text/css; charset=utf-8");

    private static string Version => typeof(Plugin).Assembly.GetName().Version?.ToString() ?? "0";

    private ActionResult Resource(string name, string contentType)
    {
        var assembly = typeof(Plugin).Assembly;
        var fullName = typeof(Plugin).Namespace + "." + name;
        var stream = assembly.GetManifestResourceStream(fullName);
        if (stream is null)
        {
            return NotFound();
        }

        Response.Headers[HeaderNames.CacheControl] = "public, max-age=300";
        Response.Headers[HeaderNames.ETag] = "\"" + Version + "\"";
        return File(stream, contentType);
    }

    private StatusResponse BuildStatus()
    {
        var config = Plugin.Instance?.Configuration ?? new PluginConfiguration();
        return new StatusResponse(
            DateTimeOffset.UtcNow,
            _cache.LastRefresh,
            _cache.LastSuccess,
            _cache.LastError,
            _cache.LastDuration.TotalMilliseconds,
            _cache.CollectionsTracked,
            _cache.CollectionsSeen,
            config.MaintainerrUrl,
            Version,
            _cache.Items.Values
                .OrderBy(i => i.DeleteAt)
                .Select(i => new StatusItemDto(i.MediaServerId, i.Title, i.MediaType, i.CollectionTitle, ServarrAction.Label(i.Action), i.Deletes, i.AddDate, i.DeleteAt, i.SizeBytes))
                .ToList());
    }

    public sealed record ItemsResponse(DateTimeOffset ServerTime, DateTimeOffset? LastRefresh, SettingsDto Settings, List<ItemDto> Items);

    public sealed record SettingsDto(bool ShowBanner, bool ShowBadges, int WarnWithinDays, int UrgentWithinDays);

    public sealed record ItemDto(string Id, string MediaType, DateTimeOffset DeleteAt, DateTimeOffset AddDate, int CollectionId, string CollectionTitle, bool Deletes, long? SizeBytes);

    public sealed record StatusResponse(DateTimeOffset ServerTime, DateTimeOffset? LastRefresh, DateTimeOffset? LastSuccess, string? LastError, double LastDurationMs, int CollectionsTracked, int CollectionsSeen, string MaintainerrUrl, string Version, List<StatusItemDto> Items);

    public sealed record StatusItemDto(string Id, string? Title, string MediaType, string CollectionTitle, string Action, bool Deletes, DateTimeOffset AddDate, DateTimeOffset DeleteAt, long? SizeBytes);

    public sealed record TestRequest(string? Url, string? ApiKey);

    public sealed record TestResponse(bool Ok, string? Error, List<CollectionDto> Collections);

    public sealed record CollectionDto(int Id, string Title, string? Type, int ArrAction, string ActionLabel, bool Deletes, int DeleteAfterDays, bool IsActive);
}
