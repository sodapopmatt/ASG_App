import { useState, useEffect } from 'react'

interface Props {
  children: React.ReactNode
}

export default function SplashScreen({ children }: Props) {
  const [visible, setVisible] = useState(true)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 1500)
    const hideTimer = setTimeout(() => setVisible(false), 2000)
    return () => { clearTimeout(fadeTimer); clearTimeout(hideTimer) }
  }, [])

  if (!visible) return <>{children}</>

  return (
    <>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center"
        style={{
          background: 'linear-gradient(135deg, #7f9b6a 0%, #d8a648 30%, #d07b46 55%, #8a7ba0 78%, #3f6f9e 100%)',
          opacity: fading ? 0 : 1,
          transition: 'opacity 0.5s ease',
          pointerEvents: fading ? 'none' : 'auto',
        }}
      >
        <img
          src="/asg-logo.png"
          alt="Aerospace Summer Games"
          className="w-72 h-auto drop-shadow-xl"
          style={{
            opacity: fading ? 0 : 1,
            transform: fading ? 'scale(0.95)' : 'scale(1)',
            transition: 'opacity 0.5s ease, transform 0.5s ease',
          }}
        />
      </div>
      {children}
    </>
  )
}
