# Sourced by every git hook that lefthook generates, before lefthook starts
# (the `rc` setting in lefthook.yml). At that point `$1` is still the argument
# git gave the hook, untouched by any shell parsing.
#
# lefthook pastes hook arguments into the commands it runs without escaping
# them, so a path with shell syntax in it would be executed. Exporting the
# argument here lets a recipe read it from the environment instead.
#
# For commit-msg, `$1` is the path of the commit message file.
HOOK_ARG_1="${1:-}"
export HOOK_ARG_1
