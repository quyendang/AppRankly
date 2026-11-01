# AppRankly prototype directions

The user selected Spectrum’s layout and requested a warm palette. Pulse and Focus remain as comparison references. Spectrum’s layout and warm accents are approved; the current prototype includes the requested stronger, more readable typography.

## Shared product behavior

Operate mode. Portfolio comes first. Five screens: portfolio, app detail, ASO, journal (notes/releases), settings. One mock dataset, honest missing metrics, separate original currencies, local-only preferences and synthetic note persistence. No production imports, network APIs, credentials, paid AI, or deployment.

## Pulse

Blue #2563EB, coral accent, white surfaces on #F7F9FC. Plus Jakarta Sans headings, Be Vietnam Pro text. Sidebar navigation, large portfolio chart, app table and a shared release timeline. Keep open space around the chart; prioritize chronological context. Main risk: the chart pushes some app rows below the first viewport.

## Spectrum

Selected layout. Accent-only revision: terracotta #B84F2B replaces violet, amber #926018 replaces turquoise, and red-brown #8F422E replaces the cooler secondary chart tone. Dark equivalents are #F3A77C, #E8BF70 and #D98C72. The user clarified that neutral backgrounds, text, app marks and all structure must remain exactly as in the original Spectrum prototype. Sora headings at 700, Be Vietnam Pro text at 500; navigation, controls and table headings at 600. Tighter body tracking (-0.012em), 13px table/body copy, 11–12px labels and readable mobile overrides. Horizontal navigation and app rows with charts using one shared vertical scale. Detail opens in a drawer before a full screen. Main risk: more horizontal content requires deliberate reduction on mobile.

## Focus

Teal #008578 (darkened from the brief's #008F83 for accessible button contrast), orange and blue accents. Be Vietnam Pro, IBM Plex Mono for measurements. Narrow navigation rail, persistent app list, dense comparison table and a selected-app panel. App switching preserves range/platform context. On mobile, the app list becomes a horizontal strip. Main risk: the rail uses icons; titles and accessible names remain available.

## Themes and language

Semantic CSS properties drive light/dark/system. Vietnamese is the default. All interface copy has a matching English key. User-authored note text is kept verbatim rather than pretending to translate it. Number/date/currency output uses Intl. Fonts are self-hosted, with licenses beside the files. No gradients, glow, glass or external media.

## Interaction and accessibility

120–200ms feedback only; reduced motion removes animation. Native form controls, visible focus, keyboard navigation for tabs, focus-trapped dialogs, Escape dismissal, mobile menu inert when closed. AI payload changes reset consent. Settings contain no credential inputs. Scenario control exposes normal/loading/empty/error/stale states. Reset sample data restores the shared initial content.

## Provenance and review

UI, SVG charts, icons and fixtures were authored afresh for this folder. Existing app UI code was not imported. Font sources: Google Fonts CSS API and google/fonts OFL licenses. Screenshots are rendered browser captures, not generated design images. The skill concept seed was run; the user's explicitly pinned three directions take priority over random assignments. The user approved Spectrum and its warm accents. The latest follow-up refines typography without changing the approved layout or palette.
