# App Store screenshots

**Empty, deliberately.**

This is where the real App Store assets go, and they can only be produced on a Mac. This app has never run on iOS —
it was developed on Linux — so generating them here would mean shipping browser renders labelled as iOS screenshots,
which is exactly the kind of thing that should not be in a repository.

The layout previews in `../preview-web/` are at the right pixel sizes and are useful for spotting clipped text and bad
spacing, but they have no iOS status bar, no Dynamic Island and no native chrome. They are not submittable.

The exact procedure — simulator, pinned clock, status bar override, capture loop, validation — is in
[docs/mobile/store-assets.md](../../../docs/mobile/store-assets.md#generating-the-apple-set-macos-only).
