#!/usr/bin/env bash
# Run ONE command on many CloudSim Cumulus switches, via the jump host.
#
#   fanout.sh <jump-ssh-target> '<command>' [name-regex]
#
#   fanout.sh ubuntu@adam-ctl.netris.io "nv show system" 'leaf-pod00'
#   fanout.sh ubuntu@adam-ctl.netris.io "sudo vtysh -c 'show bgp summary'"   # all switches
#
# How it works: a single SSH connection to the jump host runs a small script
# that reads ~/.cloudsim_aliases, keeps only aliases whose SSH user is
# `cumulus` (= switches; GPU servers / mgmt / softgates are root@), and runs
# the command on each switch in parallel (the jump host's own key is already
# trusted by every switch). Output is one block per switch:
#
#   ===== <switch-name> <mgmt-ip> exit=<n> =====
#   <stdout/stderr>
#
# The command is passed base64-encoded so quoting never breaks across the
# three shell layers (laptop -> jump host -> switch).
set -euo pipefail

if [ $# -lt 2 ]; then
  sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
fi

JUMP="$1"
CMD="$2"
FILTER="${3:-.}"
PARALLEL="${FANOUT_PARALLEL:-8}"

CMD_B64=$(printf '%s' "$CMD" | base64 | tr -d '\n')
FILTER_B64=$(printf '%s' "$FILTER" | base64 | tr -d '\n')

ssh -o BatchMode=yes -o ConnectTimeout=10 "$JUMP" \
  "CMD_B64=$CMD_B64 FILTER_B64=$FILTER_B64 PARALLEL=$PARALLEL bash -s" <<'REMOTE'
set -u
CMD=$(printf '%s' "$CMD_B64" | base64 -d)
FILTER=$(printf '%s' "$FILTER_B64" | base64 -d)
export CMD

# "<name> <ip>" for every alias that ssh's in as cumulus@ (i.e. a switch).
sed -nE "s/^[[:space:]]*alias[[:space:]]+([^=[:space:]]+)='.*cumulus@([0-9.]+).*'.*/\1 \2/p" \
    ~/.cloudsim_aliases ~/.bashrc 2>/dev/null \
  | sort -u \
  | grep -E -- "$FILTER" \
  | xargs -r -P "$PARALLEL" -L1 bash -c '
      name=$1; ip=$2
      out=$(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
                -o BatchMode=yes -o ConnectTimeout=8 -o LogLevel=ERROR \
                "cumulus@$ip" "$CMD" 2>&1)
      rc=$?
      printf "===== %s %s exit=%s =====\n%s\n" "$name" "$ip" "$rc" "$out"
    ' _
REMOTE
