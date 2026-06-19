import { Link } from 'react-router-dom'

interface Props {
  to: string
  label: string
}

export default function BackLink({ to, label }: Props) {
  return (
    <Link to={to} className="flex items-center gap-1 text-blue-600 text-base font-normal w-fit">
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      {label}
    </Link>
  )
}
