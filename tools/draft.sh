#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 2 ]]; then
  echo "用法：bash tools/draft.sh '中文标题' PR说明.md" >&2
  exit 2
fi
repo=cbp0522/lianaihenmang-rea
branch="$(git branch --show-current)"
case "$branch" in
  ""|main|master) echo '请选择开发分支' >&2; exit 2 ;;
esac
case "$(git remote get-url --push origin)" in
  "https://github.com/$repo.git"|"https://github.com/$repo"|"git@github.com:$repo.git") ;;
  *) echo 'origin 与目标仓库不一致' >&2; exit 2 ;;
esac
test -z "$(git status --porcelain)"
test -f "$2"
git fetch origin main
git merge-base origin/main HEAD >/dev/null
test "$(git rev-list --count origin/main..HEAD)" -gt 0
bash tools/check.sh
git -c 'credential.helper=!gh auth git-credential' push -u origin "HEAD:refs/heads/$branch"
number="$(gh pr list -R "$repo" --head "$branch" --base main --json number --jq '.[0].number // empty')"
if [[ -n "$number" ]]; then
  gh pr view "$number" -R "$repo" --json url,isDraft,headRefOid
else
  gh pr create -R "$repo" --base main --head "$branch" --draft --title "$1" --body-file "$2"
fi
