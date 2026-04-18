set -euo pipefail

# Check if we are in a git repo
if ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
  echo "Error: You must run this script from inside a git repository."
  exit 1
fi

# Define the folder to scan (Rust RFCs live in 'text/')
TARGET_DIR="text"

if [ ! -d "$TARGET_DIR" ]; then
  echo "Error: Directory '$TARGET_DIR' not found."
  exit 1
fi

echo "Calculating churn for files in '$TARGET_DIR'..."
echo "-----------------------------------------------"
echo "Edits | File Path"
echo "-----------------------------------------------"

# 1. List all files in the target directory
# 2. For each file, count the number of commits in git history
# 3. Sort numerically (highest first)
find "$TARGET_DIR" -type f -name "*.md" | while read -r file; do
    count=$(git rev-list --count HEAD -- "$file")
    printf "%5d | %s\n" "$count" "$file"
done | sort -rn | head -n 20
