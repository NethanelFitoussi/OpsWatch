import 'server-only';
import { createHash } from 'node:crypto';
import { HOST_AGENT_VERSION } from '@opswatch/contract';

/**
 * The OpsWatch Linux agent, as a POSIX shell script.
 *
 * **Small enough to read before running.** That is the whole design brief: an operator is about to run
 * this as root on a machine they care about, and a compiled binary from an unknown build would ask them
 * to trust rather than to check. It is a hundred lines of `/proc` reads, one `curl`, and one `openssl`.
 *
 * What it does *not* do, deliberately:
 *
 *   - **No inbound anything.** It opens no port and accepts no commands. It reads, signs, posts, exits.
 *     There is no channel through which OpsWatch could ask a machine to do something, which is why the
 *     secret it holds is safe to hold: it proves identity and authorises nothing.
 *   - **No process environments, no file contents, no secrets.** It reads the kernel's own counters and
 *     the output of `df`. `/proc/<pid>/environ` is where credentials live on a Linux box, and nothing
 *     here goes near it.
 *   - **No `curl | sh` from the internet.** It is served by the operator's own OpsWatch, over their own
 *     URL, and the install command prints its SHA-256 so it can be checked against what this page says
 *     before it is run.
 *
 * Kept as one string rather than a file so the secret, the URL and the interval are substituted on the
 * server and the operator copies one command. The script itself contains no secret: it reads one from
 * its own config file, written with mode 600 by the installer.
 */

export type AgentScriptInput = {
  /** Where this OpsWatch answers, as the operator reaches it. */
  baseUrl: string;
};

/**
 * The agent, with the instance's own URL baked in.
 *
 * The same bytes for every host: the id and the key live in `/etc/opswatch/agent.conf`, not in here.
 * That is what makes the checksum on the page worth printing — one script, one digest, checkable by
 * anybody against what they downloaded.
 */
export function agentScript(input: AgentScriptInput): string {
  const base = input.baseUrl.replace(/\/$/, '');
  return `#!/bin/sh
# OpsWatch host agent ${HOST_AGENT_VERSION}
#
# Reads this machine's own counters, signs one JSON report, posts it, and exits.
# It opens no port, accepts no commands, and reads no process environments or file contents.
#
# Configuration is read from /etc/opswatch/agent.conf (mode 600), which holds only:
#   OPSWATCH_HOST_ID=...      the host this machine is
#   OPSWATCH_HOST_SECRET=...  the key it signs reports with. It authorises nothing else.
set -eu

CONF=\${OPSWATCH_AGENT_CONF:-/etc/opswatch/agent.conf}
[ -r "$CONF" ] || { echo "opswatch-agent: cannot read $CONF" >&2; exit 1; }
. "$CONF"
: "\${OPSWATCH_HOST_ID:?not set in $CONF}"
: "\${OPSWATCH_HOST_SECRET:?not set in $CONF}"

URL="${base}/api/v1/ingest/host"
AGENT_VERSION="${HOST_AGENT_VERSION}"

# --- what this machine is -------------------------------------------------------------------------
HOSTNAME=$(hostname 2>/dev/null || echo unknown)
# Survives a rename; does not survive a re-image. It is what stops one machine becoming two hosts.
MACHINE_ID=$(cat /etc/machine-id 2>/dev/null || cat /var/lib/dbus/machine-id 2>/dev/null || echo "")
KERNEL=$(uname -r 2>/dev/null || echo "")
ARCH=$(uname -m 2>/dev/null || echo "")
OS=$(. /etc/os-release 2>/dev/null && echo "\${PRETTY_NAME:-}" || echo "")

# Which cloud, asked of the machine itself rather than guessed from a hostname. Each is one request to
# a link-local address that only answers inside that provider, with a short timeout so a machine that
# is in none of them costs a second at most.
CLOUD="unknown"; CLOUD_ID=""
if [ -z "$CLOUD_ID" ]; then
  # EC2 requires IMDSv2: a token first, then the read. IMDSv1 is the one that can be reached through a
  # server-side request forgery, and asking for a token is what says this is not one.
  TOKEN=$(curl -fsS -m 1 -X PUT "http://169.254.169.254/latest/api/token" \\
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" 2>/dev/null || echo "")
  if [ -n "$TOKEN" ]; then
    CLOUD_ID=$(curl -fsS -m 1 -H "X-aws-ec2-metadata-token: $TOKEN" \\
      "http://169.254.169.254/latest/meta-data/instance-id" 2>/dev/null || echo "")
    [ -n "$CLOUD_ID" ] && CLOUD="aws"
  fi
fi
if [ -z "$CLOUD_ID" ]; then
  CLOUD_ID=$(curl -fsS -m 1 -H "Metadata-Flavor: Google" \\
    "http://169.254.169.254/computeMetadata/v1/instance/id" 2>/dev/null || echo "")
  [ -n "$CLOUD_ID" ] && CLOUD="gcp"
fi
if [ -z "$CLOUD_ID" ]; then
  CLOUD_ID=$(curl -fsS -m 1 "http://169.254.169.254/metadata/v1/id" 2>/dev/null || echo "")
  [ -n "$CLOUD_ID" ] && CLOUD="digitalocean"
fi

# --- what it measured -----------------------------------------------------------------------------
# CPU as a rate, which needs two readings a second apart. A single reading cannot produce one, and
# reporting the kernel's since-boot average as "now" would be a figure nobody measured.
read_cpu_total() { awk '/^cpu /{idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i; print total, idle}' /proc/stat; }
CPU_PERCENT=null
if [ -r /proc/stat ]; then
  set -- $(read_cpu_total); T1=$1; I1=$2
  sleep 1
  set -- $(read_cpu_total); T2=$1; I2=$2
  CPU_PERCENT=$(awk -v t1="$T1" -v i1="$I1" -v t2="$T2" -v i2="$I2" \\
    'BEGIN{ dt=t2-t1; di=i2-i1; if (dt<=0) print "null"; else printf "%.1f", (1-di/dt)*100 }')
fi

MEM_TOTAL=null; MEM_USED=null
if [ -r /proc/meminfo ]; then
  MEM_TOTAL=$(awk '/^MemTotal:/{print $2*1024}' /proc/meminfo)
  # Available rather than free: the page cache is not memory somebody has lost.
  MEM_AVAIL=$(awk '/^MemAvailable:/{print $2*1024}' /proc/meminfo)
  [ -n "\${MEM_TOTAL:-}" ] && [ -n "\${MEM_AVAIL:-}" ] && MEM_USED=$((MEM_TOTAL - MEM_AVAIL))
  : "\${MEM_TOTAL:=null}"; : "\${MEM_USED:=null}"
fi

L1=null; L5=null; L15=null
if [ -r /proc/loadavg ]; then set -- $(cat /proc/loadavg); L1=$1; L5=$2; L15=$3; fi

UPTIME=null
[ -r /proc/uptime ] && UPTIME=$(awk '{printf "%d", $1}' /proc/uptime)

# Real filesystems only: every tmpfs, overlay and squashfs on a modern box is noise, and a container's
# read-only layers would read as disks that are permanently full.
DISKS=$(df -P -B1 -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null | awk 'NR>1 {
  gsub(/"/,"",$6); printf "%s{\\"mount\\":\\"%s\\",\\"usedBytes\\":%s,\\"totalBytes\\":%s}", (n++?",":""), $6, $3, $2
}')

json_escape() { printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g'; }

BODY=$(cat <<JSON
{"identity":{"hostname":"$(json_escape "$HOSTNAME")","machineId":"$(json_escape "$MACHINE_ID")","os":"$(json_escape "$OS")","kernel":"$(json_escape "$KERNEL")","arch":"$(json_escape "$ARCH")","cloud":"$CLOUD","cloudInstanceId":"$(json_escape "$CLOUD_ID")","agentVersion":"$AGENT_VERSION"},"sample":{"cpuPercent":$CPU_PERCENT,"memoryUsedBytes":\${MEM_USED:-null},"memoryTotalBytes":\${MEM_TOTAL:-null},"load1":$L1,"load5":$L5,"load15":$L15,"uptimeSeconds":\${UPTIME:-null},"disks":[$DISKS]}}
JSON
)

# --- prove who sent it ----------------------------------------------------------------------------
# The same scheme OpsWatch uses everywhere else: v1:<timestamp>:<body>, HMAC-SHA256. The timestamp is
# inside the signed material, so a captured request cannot be replayed once it is a few minutes old.
TS=$(( $(date +%s) * 1000 ))
SIG=$(printf '%s' "v1:$TS:$BODY" | openssl dgst -sha256 -hmac "$OPSWATCH_HOST_SECRET" -r | cut -d' ' -f1)

printf '%s' "$BODY" | curl -fsS -m 30 -X POST "$URL" \\
  -H "content-type: application/json" \\
  -H "x-opswatch-integration: $OPSWATCH_HOST_ID" \\
  -H "x-opswatch-timestamp: $TS" \\
  -H "x-opswatch-signature: v1=$SIG" \\
  --data-binary @-
`;
}

/** The SHA-256 of the script, so an operator can check what they are about to run against this page. */
export function agentScriptDigest(input: AgentScriptInput): string {
  return createHash('sha256').update(agentScript(input)).digest('hex');
}

