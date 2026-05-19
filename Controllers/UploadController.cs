using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using MediaBrowser.Model.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace JellyMusicUploader.Controllers;

/// <summary>
/// /musicup/* — endpoints for the Add-Music drag-drop modal.
///
/// /musicup/frontend/{**path}  serves the embedded modal JS (anonymous so the
///                             Custom-CSS &lt;script&gt; tag can load it).
/// /musicup/config             read-only config snapshot the JS needs to
///                             validate before posting files (auth required).
/// /musicup/upload             receives one file at a time with a relative
///                             path of the form "Artist/Album/song.ext"
///                             (admin only).
/// /musicup/refresh            kicks Jellyfin's library scan after a batch
///                             finishes (admin only).
/// </summary>
[ApiController]
[Route("musicup")]
public class UploadController : ControllerBase
{
    private readonly ITaskManager _taskManager;
    private readonly ILogger<UploadController> _log;

    public UploadController(ITaskManager taskManager, ILogger<UploadController> log)
    {
        _taskManager = taskManager;
        _log = log;
    }

    [HttpGet("frontend/{**path}")]
    [AllowAnonymous]
    public IActionResult Frontend(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Contains("..")) return NotFound();

        var resName = "JellyMusicUploader.Frontend." + path.Replace('/', '.');
        var asm = typeof(Plugin).Assembly;
        using var stream = asm.GetManifestResourceStream(resName);
        if (stream is null) return NotFound();

        var ms = new MemoryStream();
        stream.CopyTo(ms);
        var mime = path.EndsWith(".js", StringComparison.OrdinalIgnoreCase) ? "application/javascript"
                : path.EndsWith(".css", StringComparison.OrdinalIgnoreCase) ? "text/css"
                : "application/octet-stream";
        Response.Headers["Cache-Control"] = "no-cache";
        return File(ms.ToArray(), mime);
    }

    [HttpGet("config")]
    [Authorize]
    public IActionResult GetConfig()
    {
        var cfg = Plugin.Instance!.Configuration;
        return Ok(new
        {
            configured = !string.IsNullOrWhiteSpace(cfg.LibraryPath) && Directory.Exists(cfg.LibraryPath),
            maxFileSizeMb = cfg.MaxFileSizeMb,
            allowedExtensions = SplitExtensions(cfg.AllowedExtensions),
            allowOverwrite = cfg.AllowOverwrite,
        });
    }

    [HttpPost("upload")]
    [Authorize(Policy = "RequiresElevation")]
    [DisableRequestSizeLimit]
    [RequestFormLimits(MultipartBodyLengthLimit = long.MaxValue, ValueLengthLimit = int.MaxValue)]
    public async Task<IActionResult> Upload([FromForm] IFormFile file, [FromForm] string relativePath)
    {
        var cfg = Plugin.Instance!.Configuration;

        if (string.IsNullOrWhiteSpace(cfg.LibraryPath))
            return StatusCode(503, new { error = "Library path not configured. Set it on the plugin's config page." });
        if (!Directory.Exists(cfg.LibraryPath))
            return StatusCode(503, new { error = $"Library path does not exist: {cfg.LibraryPath}" });
        if (file is null || file.Length == 0)
            return BadRequest(new { error = "Empty file." });
        if (cfg.MaxFileSizeMb > 0 && file.Length > (long)cfg.MaxFileSizeMb * 1024 * 1024)
            return StatusCode(413, new { error = $"File exceeds {cfg.MaxFileSizeMb} MB cap." });

        var rel = SanitizeRelativePath(relativePath);
        if (rel is null) return BadRequest(new { error = "Invalid relative path. Expect Artist/Album/song.ext." });

        var allowed = SplitExtensions(cfg.AllowedExtensions);
        var ext = Path.GetExtension(rel).TrimStart('.').ToLowerInvariant();
        if (allowed.Length > 0 && !allowed.Contains(ext))
            return StatusCode(415, new { error = $"Extension .{ext} is not in the allowed list." });

        var destFull = Path.GetFullPath(Path.Combine(cfg.LibraryPath, rel));
        var rootFull = Path.GetFullPath(cfg.LibraryPath);
        if (!destFull.StartsWith(rootFull + Path.DirectorySeparatorChar, StringComparison.Ordinal)
            && destFull != rootFull)
            return BadRequest(new { error = "Path escapes library root." });

        if (System.IO.File.Exists(destFull) && !cfg.AllowOverwrite)
            return Conflict(new { error = "File already exists.", path = rel });

        Directory.CreateDirectory(Path.GetDirectoryName(destFull)!);

        var tmp = destFull + ".part";
        try
        {
            await using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                await file.CopyToAsync(fs).ConfigureAwait(false);
            }
            if (System.IO.File.Exists(destFull)) System.IO.File.Delete(destFull);
            System.IO.File.Move(tmp, destFull);
        }
        catch (Exception ex)
        {
            if (System.IO.File.Exists(tmp))
            {
                try { System.IO.File.Delete(tmp); } catch { }
            }
            _log.LogError(ex, "[musicup] upload failed for {Rel}", rel);
            return StatusCode(500, new { error = ex.Message });
        }

        _log.LogInformation("[musicup] wrote {Bytes} bytes -> {Path}", file.Length, destFull);

        // Folder is the source of truth: Artist = top-level dir, Album =
        // parent dir, Title = filename. We always overwrite the audio tags
        // because dropped files frequently come from sources (Soulseek,
        // Bandcamp ZIPs, ripped from CDs without DB lookup) that ship with
        // empty or wrong ID3 frames — without this, Jellyfin's tag-driven
        // scanner shows "Unknown Artist".
        if (cfg.NormalizeTagsFromFolder && IsAudioExtension(ext))
        {
            TryNormalizeTags(destFull, rel);
        }

        return Ok(new { path = rel, bytes = file.Length });
    }

    private static readonly HashSet<string> AudioExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        "mp3", "flac", "m4a", "aac", "ogg", "opus", "wav", "wma", "alac", "aiff", "ape", "mp4"
    };

    private static bool IsAudioExtension(string ext) => AudioExtensions.Contains(ext);

    private void TryNormalizeTags(string filePath, string relativePath)
    {
        try
        {
            var parts = relativePath.Split('/');
            // relativePath is already sanitized to >= 2 segments. For the
            // common Artist/Album/song.ext case, parts[0] is the artist
            // and parts[^2] is the album folder. For deeper paths like
            // Artist/Album/Disc 1/song.ext, parts[^2] is "Disc 1" — fall
            // back to parts[1] so the actual album survives.
            var artist = parts[0].Trim();
            var album = (parts.Length >= 3 ? parts[1] : parts[^2]).Trim();
            var fileName = Path.GetFileNameWithoutExtension(parts[^1]);
            var title = DeriveTitleFromFilename(fileName);

            using var tagFile = TagLib.File.Create(filePath);
            tagFile.Tag.Performers = new[] { artist };
            tagFile.Tag.AlbumArtists = new[] { artist };
            tagFile.Tag.Album = album;
            if (string.IsNullOrWhiteSpace(tagFile.Tag.Title) || tagFile.Tag.Title.Trim() == fileName)
                tagFile.Tag.Title = title;
            tagFile.Save();
            _log.LogInformation("[musicup] normalized tags on {Path}: Artist={Artist} Album={Album} Title={Title}",
                relativePath, artist, album, title);
        }
        catch (Exception ex)
        {
            // Non-fatal: the file is already on disk. User can always
            // re-tag with a real editor.
            _log.LogWarning(ex, "[musicup] tag normalization failed for {Path}", relativePath);
        }
    }

    private static string DeriveTitleFromFilename(string filenameNoExt)
    {
        if (string.IsNullOrWhiteSpace(filenameNoExt)) return string.Empty;
        // Strip leading track / disc numbers: "01 ", "1-02. ", "01.", "01_", etc.
        // Repeats so "1-01 " collapses in one pass.
        var s = Regex.Replace(filenameNoExt, @"^(?:[0-9]+[-._ ]+)+", "", RegexOptions.CultureInvariant);
        s = s.Replace('_', ' ');
        s = Regex.Replace(s, @"\s+", " ").Trim();
        return s.Length > 0 ? s : filenameNoExt;
    }

    [HttpPost("refresh")]
    [Authorize(Policy = "RequiresElevation")]
    public IActionResult Refresh()
    {
        if (!Plugin.Instance!.Configuration.RefreshLibraryOnComplete)
            return Ok(new { triggered = false, reason = "disabled in config" });

        try
        {
            var task = _taskManager.ScheduledTasks.FirstOrDefault(t =>
                string.Equals(t.ScheduledTask?.Key, "RefreshLibrary", StringComparison.OrdinalIgnoreCase))
                ?? _taskManager.ScheduledTasks.FirstOrDefault(t =>
                    (t.Name ?? "").IndexOf("Scan", StringComparison.OrdinalIgnoreCase) >= 0
                    && (t.Name ?? "").IndexOf("Librar", StringComparison.OrdinalIgnoreCase) >= 0);

            if (task is null) return Ok(new { triggered = false, reason = "no library-scan task found" });
            _taskManager.Execute(task, new TaskOptions());
            return Ok(new { triggered = true });
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "[musicup] refresh trigger failed");
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // Accept "Artist/Album/song.mp3" or "Artist/Album/Disc 1/song.mp3".
    // Reject absolute paths, "..", null bytes, drive letters, leading slash.
    // Trim each segment and reject reserved Windows names.
    private static string? SanitizeRelativePath(string? rel)
    {
        if (string.IsNullOrWhiteSpace(rel)) return null;
        rel = rel.Replace('\\', '/').Trim();
        if (rel.StartsWith('/') || rel.Contains("..") || rel.Contains('\0')) return null;
        if (rel.Length >= 2 && rel[1] == ':') return null;

        var parts = rel.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) return null;

        var invalid = Path.GetInvalidFileNameChars();
        var cleaned = new string[parts.Length];
        for (var i = 0; i < parts.Length; i++)
        {
            var p = parts[i].Trim();
            if (string.IsNullOrEmpty(p)) return null;
            if (p == "." || p == "..") return null;
            if (p.IndexOfAny(invalid) >= 0) return null;
            cleaned[i] = p;
        }
        return string.Join('/', cleaned);
    }

    private static string[] SplitExtensions(string? csv)
    {
        if (string.IsNullOrWhiteSpace(csv)) return Array.Empty<string>();
        return csv.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(s => s.TrimStart('.').ToLowerInvariant())
            .Where(s => s.Length > 0)
            .ToArray();
    }
}
