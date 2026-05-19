using System;
using System.Collections.Generic;
using JellyMusicUploader.Configuration;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;

namespace JellyMusicUploader;

public class Plugin : BasePlugin<PluginConfiguration>, IHasWebPages
{
    public Plugin(IApplicationPaths appPaths, IXmlSerializer xmlSerializer)
        : base(appPaths, xmlSerializer)
    {
        Instance = this;
    }

    public static Plugin? Instance { get; private set; }

    public override string Name => "JellyMusicUploader";

    public override Guid Id => Guid.Parse("3c8f5e21-7d4a-4f9b-bc18-a02e6f1d4c95");

    public override string Description =>
        "Upload music to the library from the Jellyfin web UI.";

    public IEnumerable<PluginPageInfo> GetPages()
    {
        var prefix = GetType().Namespace;
        yield return new PluginPageInfo
        {
            Name = "MusicUploaderConfig",
            EnableInMainMenu = true,
            DisplayName = "Music Uploader",
            EmbeddedResourcePath = $"{prefix}.Configuration.configPage.html",
        };
    }
}
