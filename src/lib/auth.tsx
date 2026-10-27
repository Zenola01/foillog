import type { User } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from './supabase'

export interface Profile {
  id: string
  display_name: string
}

interface AuthValue {
  /** False until the stored sign-in has been read. */
  ready: boolean
  user: User | null
  profile: Profile | null
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  rename: (name: string) => Promise<void>
}

const Ctx = createContext<AuthValue | null>(null)

/** Supabase and network errors, in words a rider understands. */
export function friendlyError(e: unknown): string {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  if (/invalid login credentials/i.test(msg)) return 'Email o password non corretti.'
  if (/already registered|already exists/i.test(msg)) return 'Esiste già un account con questa email: usa «Entra».'
  if (/password should be at least|weak password/i.test(msg)) return 'La password deve avere almeno 6 caratteri.'
  if (/unable to validate email|invalid email|email address .* is invalid/i.test(msg)) return 'Controlla l’indirizzo email.'
  if (/rate limit|too many/i.test(msg)) return 'Troppi tentativi: riprova tra qualche minuto.'
  if (/failed to fetch|network|load failed|fetch failed/i.test(msg))
    return 'Il server della crew non risponde. Controlla la connessione; se nessuno usa FoilLog da 7 giorni, il progetto Supabase va riattivato dalla sua pagina.'
  return msg || 'Qualcosa non ha funzionato.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      setUser(data.session?.user ?? null)
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = user?.id
  useEffect(() => {
    if (!userId) {
      setProfile(null)
      return
    }
    let alive = true
    supabase
      .from('profiles')
      .select('id, display_name')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive && data) setProfile(data as Profile)
      })
    return () => {
      alive = false
    }
  }, [userId])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(friendlyError(error))
  }, [])

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim() } },
    })
    if (error) throw new Error(friendlyError(error))
    if (!data.session) throw new Error('Account creato, ma serve la conferma via email: chiedi a chi gestisce la crew di disattivarla.')
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const rename = useCallback(
    async (name: string) => {
      if (!userId) return
      const display_name = name.trim().slice(0, 40)
      const { error } = await supabase.from('profiles').update({ display_name }).eq('id', userId)
      if (error) throw new Error(friendlyError(error))
      setProfile({ id: userId, display_name })
    },
    [userId],
  )

  const value = useMemo(() => ({ ready, user, profile, signIn, signUp, signOut, rename }), [ready, user, profile, signIn, signUp, signOut, rename])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
