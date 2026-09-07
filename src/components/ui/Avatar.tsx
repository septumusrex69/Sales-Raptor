import { useAppStore } from '../../store/AppStore'
import type { ID } from '../../types'

function initials(name: string) {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

export function Avatar({ name, color, size = 28 }: { name: string; color: string; size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-semibold text-white shrink-0"
      style={{ backgroundColor: color, width: size, height: size, fontSize: size * 0.38 }}
      title={name}
    >
      {initials(name)}
    </span>
  )
}

export function UserAvatar({ userId, size = 28 }: { userId?: ID; size?: number }) {
  const { userById } = useAppStore()
  const user = userById(userId)
  if (!user) return <Avatar name="?" color="var(--c-grey-light)" size={size} />
  return <Avatar name={user.name} color={user.avatarColor} size={size} />
}
