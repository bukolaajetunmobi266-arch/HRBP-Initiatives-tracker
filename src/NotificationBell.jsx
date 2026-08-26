import React, { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const ICONS = { overdue: '⚠', due_soon: '⏰', revised: '📅', assigned: '📌' }

export default function NotificationBell({ userId }) {
  const [notifications, setNotifications] = useState([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!userId) return
    load()
    const channel = supabase
      .channel('notifications-' + userId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        (payload) => setNotifications((prev) => [payload.new, ...prev])
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [userId])

  const load = async () => {
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifications(data || [])
  }

  const markRead = async (id) => {
    await supabase.from('notifications').update({ read: true }).eq('id', id)
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
  }

  const unreadCount = notifications.filter((n) => !n.read).length

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative text-white/90 hover:text-white px-2 py-1" aria-label="Notifications">
        🔔
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-brand-orange text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-100 max-h-96 overflow-y-auto z-50 text-gray-800">
          <div className="px-4 py-2 border-b border-gray-100 text-sm font-medium">Notifications</div>
          {notifications.length === 0 && <p className="text-xs text-gray-400 px-4 py-3">Nothing yet.</p>}
          {notifications.map((n) => (
            <div
              key={n.id}
              onClick={() => markRead(n.id)}
              className={`px-4 py-2 text-xs border-b border-gray-50 cursor-pointer ${n.read ? 'text-gray-400' : 'text-gray-800 bg-brand-pale/40'}`}
            >
              <span className="mr-1">{ICONS[n.type] || '•'}</span>
              {n.message}
              <div className="text-[10px] text-gray-400 mt-0.5">{new Date(n.created_at).toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
