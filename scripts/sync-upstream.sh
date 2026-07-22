#!/usr/bin/env bash
# sync-upstream.sh — влить свежие обновления автора/комьюнити в твою версию.
#
# Использование:
#   ./scripts/sync-upstream.sh            # по умолчанию merge из upstream/main
#   ./scripts/sync-upstream.sh --rebase   # rebase твоих правок поверх upstream/main
#   ./scripts/sync-upstream.sh --pr 42    # втянуть конкретный PR #42 из upstream
#
# Перед запуском желательно иметь чистую рабочую копию (закоммитьте всё,
# что дорого: `git status`). При конфликтах скрипт не делает ничего деструктивного
# — оставляет вас в состоянии merge/rebase, чтобы разобраться руками.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

ORIGIN=origin          # ваш форк
UPSTREAM=upstream      # репо автора
MAIN=main              # главная ветка
PERSONAL=personal/local-changes   # ветка с вашими правками

mode="merge"
pr=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebase) mode="rebase"; shift;;
    --pr) shift; pr="$1"; shift;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0;;
    *) echo "Неизвестный аргумент: $1" >&2; exit 2;;
  esac
done

echo "==> Проверяю, что рабочая копия чистая"
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "❌ Есть незакоммиченные изменения. Сначала закоммитьте или спрячьте их:" >&2
  echo "    git status" >&2
  echo "    git stash -u" >&2
  exit 1
fi

echo "==> Обновляю remote-ссылки"
git fetch "$UPSTREAM" --tags 2>&1 | tail -5 || \
  { echo "❌ Не удалось fetch upstream. Проверьте git remote -v." >&2; exit 1; }

# Втянуть конкретный PR в локальную ветку
if [[ -n "$pr" ]]; then
  branch="pr-$pr"
  echo "==> Создаю ветку $branch из PR #$PR из $UPSTREAM"
  git fetch "$UPSTREAM" "pull/$pr/head:$branch"
  git checkout "$branch"
  echo "✅ PR #$pr в ветке $branch. Соберите и тестируйте: node bin/cli.js run --port=41847"
  exit 0
fi

echo "==> Перехожу на [$MAIN] и вливаю upstream/main"
git checkout "$MAIN"
git merge --ff-only "$UPSTREAM/$MAIN" 2>&1 | tail -10 || true

echo "==> Пушю обновлённый main в ваш форк ($ORIGIN)"
git push "$ORIGIN" "$MAIN" 2>&1 | tail -5

echo "==> Перехожу на персональную ветку [$PERSONAL] и втягиваю свежий main"
git checkout "$PERSONAL" 2>/dev/null || {
  echo "⚠️  Ветке $PERSONAL не существует — создаю из main."; git checkout -b "$PERSONAL"; }

if [[ "$mode" == "rebase" ]]; then
  echo "==> Rebase $PERSONAL поверх $MAIN"
  if git rebase "$MAIN"; then
    echo "✅ Rebase прошёл чисто. Проверьте, что работает: node bin/cli.js run --port=41847"
  else
    echo "⚠️  Конфликты при rebase. Разберитесь руками:" >&2
    echo "    git status" >&2
    echo "    # правьте файлы, git add, git rebase --continue" >&2
    exit 1
  fi
else
  echo "==> Merge $MAIN в $PERSONAL"
  if git merge "$MAIN"; then
    echo "✅ Merge прошёл чисто. Проверьте, что работает: node bin/cli.js run --port=41847"
  else
    echo "⚠️  Конфликты при merge. Разберитесь руками:" >&2
    echo "    git status" >&2
    echo "    # правьте файлы, git add, git commit" >&2
    exit 1
  fi
fi

echo
echo "Готово. Свои изменения пушим:"
echo "    git push origin $PERSONAL"
