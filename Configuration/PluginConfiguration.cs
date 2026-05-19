using MediaBrowser.Model.Plugins;

namespace JellyMusicUploader.Configuration;

public class PluginConfiguration : BasePluginConfiguration
{
    /// <summary>Absolute path on the server where uploaded Artist/Album/Songs folders are written.</summary>
    public string LibraryPath { get; set; } = string.Empty;

    /// <summary>Per-file upload cap in megabytes. 0 disables the cap.</summary>
    public int MaxFileSizeMb { get; set; } = 200;

    /// <summary>Comma-separated lowercase extensions accepted by the uploader. Files with other extensions are rejected.</summary>
    public string AllowedExtensions { get; set; } = "mp3,flac,m4a,aac,ogg,opus,wav,wma,alac,aiff,jpg,jpeg,png,webp";

    /// <summary>Trigger a library refresh after a batch finishes. Off if your library already watches the folder for changes.</summary>
    public bool RefreshLibraryOnComplete { get; set; } = true;

    /// <summary>If true, overwrite an existing destination file. If false, second upload of the same path returns 409.</summary>
    public bool AllowOverwrite { get; set; } = false;

    /// <summary>If true, after writing each audio file the plugin opens it with TagLibSharp and sets Artist, AlbumArtist, and Album from the folder structure (Artist/Album/song.ext) and Title from the filename. Always overwrites whatever was in the tag — folder is the source of truth.</summary>
    public bool NormalizeTagsFromFolder { get; set; } = true;
}
