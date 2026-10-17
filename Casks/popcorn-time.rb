cask "popcorn-time" do
  arch arm: "arm64", intel: "64"
  os macos: "osx", linux: "linux"
  ext = on_system_conditional macos: ".zip", linux: ".AppImage"

  version "0.5.1"
  sha256 arm:          "51f11fb0483983dd6c4baddf12938d8a85b8320e3499dbe12cbcf5e4146e7f74",
         intel:        "da6d993651e57cc88296f93f928ffedac3027313af0eb447ff8ca7a12a60e06a",
         x86_64_linux: "3d6559d8e8590d721c36b80c609493d59185d56901d026c3cfc68b5dad3afd79"

  repo = "github.com/#{token}-ru/popcorn-desktop"
  app_name = "Popcorn-Time"
  artifact = "#{app_name}-#{version}-#{os + arch + ext}"

  on_macos do
    app "#{app_name}.app", target: "#{app_name.tr "-", " "}.app"

    bundle_id = "com.nw-builder.#{token}"
    uninstall quit: bundle_id

    zap trash: %W[
      ~/Library/Application Support/#{app_name}
      ~/Library/Application Support/CrashReporter/nwjs_*.plist
      ~/Library/Caches/#{app_name}
      ~/Library/Preferences/#{bundle_id}.plist
      ~/Library/Saved Application State/#{bundle_id}.savedState
    ]
  end
  on_linux { app_image artifact, target: name.first + ext }

  url "https://#{repo}/releases/download/v#{version}/#{artifact}"
  name "Popcorn Time"
  desc "BitTorrent client that includes an integrated media player"
  homepage "https://#{repo}#readme"

  livecheck do
    url :url
    strategy :github_latest
  end

  postflight_steps do
    run "/usr/bin/xattr",
        args:         ["-dr", "com.apple.quarantine", "{{appdir}}/Popcorn Time.app"],
        must_succeed: false,
        sudo:         true
  end
end
