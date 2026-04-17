#!/usr/bin/env bash
set -euo pipefail

# Remember where the user ran us from, so relative paths work
ORIG_DIR="$(pwd)"
EXAMPLES_DIR="$(cd "$(dirname "$0")" && pwd)"
SAMEDIFF_PATH="${EXAMPLES_DIR}/../samediff"

# Collect example subdirs (alphabetical) so per-example generation and the
# splash page iterate the same list in the same order.
EXAMPLE_DIRS=()
while IFS= read -r -d '' d; do
    EXAMPLE_DIRS+=("$d")
done < <(find "${EXAMPLES_DIR}" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

set -x
for d in "${EXAMPLE_DIRS[@]}"; do
    "${SAMEDIFF_PATH}" "$d/left.md" "$d/right.md" --html --out "$d/findings.html"
done
set +x

# --- Splash page ------------------------------------------------------------
SPLASH="${EXAMPLES_DIR}/findings.html"

html_escape() {
    printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

{
    cat <<'HEAD'
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SameDiff — Examples</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --surface2: #21262d;
    --border: #30363d; --text: #e6edf3; --text2: #8b949e;
    --green: #3fb950; --red: #f85149; --yellow: #d29922;
    --blue: #58a6ff; --cyan: #39d353;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.55;
    padding: 2rem; max-width: 1100px; margin: 0 auto;
  }
  .header { margin-bottom: 2rem; }
  .header h1 { font-size: 1.75rem; font-weight: 600; margin-bottom: 0.25rem; }
  .header h1 span { color: var(--cyan); }
  .header p { color: var(--text2); font-size: 0.95rem; }
  .grid {
    display: grid; gap: 1rem;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  }
  a.card {
    display: flex; flex-direction: column; gap: 0.5rem;
    text-decoration: none; color: inherit;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 1rem 1.25rem;
    transition: border-color 0.15s ease, transform 0.15s ease;
  }
  a.card:hover { border-color: var(--blue); transform: translateY(-2px); }
  .card-title { font-weight: 600; font-size: 1rem; }
  .card-slug { color: var(--text2); font-size: 0.8rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .card-difficulty { color: var(--text2); font-size: 0.85rem; }
  .card-headline {
    color: var(--text); font-size: 0.9rem; line-height: 1.4;
    padding: 0.5rem 0.65rem; background: var(--surface2);
    border-left: 2px solid var(--yellow); border-radius: 4px;
    margin-top: 0.2rem;
  }
  .card-score {
    display: flex; align-items: baseline; gap: 0.5rem; margin-top: auto; padding-top: 0.5rem;
  }
  .score-num { font-weight: 700; font-size: 1.5rem; font-variant-numeric: tabular-nums; }
  .score-num.low { color: var(--green); }
  .score-num.medium { color: var(--yellow); }
  .score-num.high { color: var(--red); }
  .score-num.critical { color: var(--red); }
  .score-label { color: var(--text2); font-size: 0.85rem; }
  .missing { color: var(--text2); font-style: italic; font-size: 0.85rem; }
</style>
</head>
<body>
<div class="header">
  <h1><span>Δ</span> SameDiff — Examples</h1>
  <p>Each card links to the generated report for that left.md → right.md pair.</p>
</div>
<div class="grid">
HEAD

    for d in "${EXAMPLE_DIRS[@]}"; do
        slug="$(basename "$d")"
        findings="$d/findings.html"
        [[ -f "$findings" ]] || continue

        title="$slug"
        difficulty=""
        if [[ -f "$d/README.md" ]]; then
            t="$(grep -m1 '^# ' "$d/README.md" | sed 's/^# //')" || true
            [[ -n "$t" ]] && title="$t"
            dif="$(grep -m1 '^\*\*Difficulty:\*\*' "$d/README.md" | sed -E 's/^\*\*Difficulty:\*\*[[:space:]]*//')" || true
            [[ -n "$dif" ]] && difficulty="$dif"
        fi

        score_line="$(grep -m1 -oE '<div class="score-num [a-z]+">[0-9.]+</div>' "$findings")" || score_line=""
        score_num=""
        score_level=""
        if [[ -n "$score_line" ]]; then
            score_level="$(printf '%s' "$score_line" | sed -E 's|.*score-num ([a-z]+)".*|\1|')"
            score_num="$(printf '%s' "$score_line" | sed -E 's|.*>([0-9.]+)</div>|\1|')"
        fi
        label_line="$(grep -m1 -oE '<div class="score-label">[^<]*</div>' "$findings")" || label_line=""
        score_label="$(printf '%s' "$label_line" | sed -E 's|<div class="score-label">([^<]*)</div>|\1|')"

        # Narrative headline: the top-issue title that would make an engineer
        # stop scrolling. Extracted verbatim from the generated HTML (so the
        # splash stays in sync with whatever the narrative layer produced).
        headline_line="$(grep -m1 -oE '<div class="headline-title">[^<]*</div>' "$findings")" || headline_line=""
        headline="$(printf '%s' "$headline_line" | sed -E 's|<div class="headline-title">([^<]*)</div>|\1|')"

        esc_title="$(html_escape "$title")"
        esc_slug="$(html_escape "$slug")"
        esc_difficulty="$(html_escape "$difficulty")"
        esc_label="$(html_escape "$score_label")"
        esc_headline="$(html_escape "$headline")"

        printf '  <a class="card" href="./%s/findings.html">\n' "$slug"
        printf '    <div class="card-title">%s</div>\n' "$esc_title"
        printf '    <div class="card-slug">%s</div>\n' "$esc_slug"
        [[ -n "$difficulty" ]] && printf '    <div class="card-difficulty">%s</div>\n' "$esc_difficulty"
        [[ -n "$headline" ]] && printf '    <div class="card-headline">%s</div>\n' "$esc_headline"
        if [[ -n "$score_num" ]]; then
            printf '    <div class="card-score"><span class="score-num %s">%s</span><span class="score-label">%s</span></div>\n' \
                "$score_level" "$score_num" "$esc_label"
        else
            printf '    <div class="missing">no score parsed</div>\n'
        fi
        printf '  </a>\n'
    done

    cat <<'TAIL'
</div>
</body>
</html>
TAIL
} > "$SPLASH"

echo "wrote splash: $SPLASH"
