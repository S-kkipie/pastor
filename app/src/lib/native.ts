import { App as CapApp } from '@capacitor/app'
import { registerPlugin } from '@capacitor/core'

import { api, auth, isNative } from './api'

// The Android app's own pieces: the alerts service (native, runs with the app
// closed) and the update check against the APK the bridge serves.
type NotifyStatus = { active: boolean; granted?: boolean }
interface PastorNotifyPlugin {
  start(o: { server: string; token: string }): Promise<NotifyStatus>
  stop(): Promise<NotifyStatus>
  status(): Promise<NotifyStatus>
  takeSession(): Promise<{ session: string | null }>
  batterySettings(): Promise<void>
}
export const PastorNotify = registerPlugin<PastorNotifyPlugin>('PastorNotify')

export async function startAlerts(): Promise<NotifyStatus | null> {
  if (!isNative() || !auth.token || !auth.server) return null
  try { return await PastorNotify.start({ server: auth.server, token: auth.token }) } catch { return null }
}

// A notification tapped while the app was closed or in the background.
export async function takeTappedSession(): Promise<string | null> {
  if (!isNative()) return null
  try { return (await PastorNotify.takeSession()).session } catch { return null }
}

export type ApkInfo = { versionCode: number; versionName: string; size: number }
export type UpdateCheck = { current: { code: number; name: string }; latest: ApkInfo } | null

// Is the bridge's APK newer than this one?
export async function checkUpdate(): Promise<UpdateCheck> {
  if (!isNative() || !auth.token) return null
  try {
    const [info, latest] = await Promise.all([CapApp.getInfo(), api<ApkInfo>('/api/apk')])
    const code = Number(info.build) || 0
    return latest.versionCode > code ? { current: { code, name: info.version }, latest } : null
  } catch { return null }
}

// Android hands the download to the browser, which then offers to install it.
export function downloadUpdate() {
  window.open(`${auth.server}/pastor.apk`, '_system')
}
