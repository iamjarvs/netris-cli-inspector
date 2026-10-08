import Badge from './ui/Badge'

const roleColors = {
  leaf: 'info',
  spine: 'primary',
  'super-spine': 'warning',
  generic: 'gray',
}

export default function RoleBadge({ role }) {
  return <Badge color={roleColors[role] ?? 'gray'}>{role}</Badge>
}
