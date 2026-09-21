import Badge from './ui/Badge'

const upPattern = /up|online|ok|healthy|reachable/i
const downPattern = /down|offline|fail|error|unreachable/i

export default function StatusBadge({ status }) {
  if (!status) return <Badge color="gray">unknown</Badge>
  if (upPattern.test(status)) return <Badge color="success">{status}</Badge>
  if (downPattern.test(status)) return <Badge color="error">{status}</Badge>
  return <Badge color="gray">{status}</Badge>
}
